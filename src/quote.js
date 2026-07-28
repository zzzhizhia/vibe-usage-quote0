import { InvalidResponseError, requestJson } from './http.js';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function taskKeyOf(task) {
  return task?.taskKey ?? task?.key ?? task?.id ?? task?.task?.taskKey ?? task?.task?.key;
}

function taskTypeOf(task) {
  return task?.taskType ?? task?.contentType ?? task?.type ?? task?.task?.type ?? task?.content?.type;
}

function collectTaskLikeObjects(value, output, seen, depth = 0) {
  if (depth > 8 || value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) collectTaskLikeObjects(item, output, seen, depth + 1);
    return;
  }
  const key = taskKeyOf(value);
  const type = taskTypeOf(value);
  if (key && type && !seen.has(String(key))) {
    seen.add(String(key));
    output.push(value);
  }
  for (const child of Object.values(value)) collectTaskLikeObjects(child, output, seen, depth + 1);
}

export function extractTasks(response) {
  const tasks = [];
  collectTaskLikeObjects(response, tasks, new Set());
  return tasks;
}

export function findCanvasTasks(response) {
  return extractTasks(response).filter((task) => String(taskTypeOf(task)).toUpperCase() === 'CANVAS_API');
}

export function selectCanvasTask(response, requestedTaskKey) {
  const canvases = findCanvasTasks(response);
  if (canvases.length === 0) throw new Error('设备循环任务中没有 CANVAS_API 画板');
  if (requestedTaskKey) {
    const selected = canvases.find((task) => String(taskKeyOf(task)) === String(requestedTaskKey));
    if (!selected) throw new Error('未找到与 QUOTE0_TASK_KEY 精确匹配的 CANVAS_API 画板');
    return selected;
  }
  if (canvases.length > 1) throw new Error('检测到多个 CANVAS_API 画板，必须设置 QUOTE0_TASK_KEY');
  return canvases[0];
}

export function canvasTaskKey(task) {
  const key = taskKeyOf(task);
  if (!key) throw new Error('CANVAS_API 画板缺少 taskKey');
  return String(key);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function collectImageUrls(value, output, depth = 0, parentKey = '') {
  if (depth > 8 || value === null || value === undefined) return;
  if (typeof value === 'string') {
    if (/^(https?):\/\//i.test(value) && /(render|image|img|preview|url|src)/i.test(parentKey)) output.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectImageUrls(item, output, depth + 1, parentKey);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) collectImageUrls(child, output, depth + 1, key);
}

export function snapshotCanvasTask(task) {
  const last = task?.renderInfo?.last ?? task?.renderInfo?.current?.last ?? task?.last ?? null;
  const imageUrls = new Set();
  collectImageUrls(task?.renderInfo ?? task, imageUrls);
  return {
    last: JSON.stringify(stableValue(last)),
    imageUrls: [...imageUrls].sort(),
  };
}

export function renderChanged(before, after) {
  if (after.last !== JSON.stringify(null) && after.last !== before.last) return true;
  return JSON.stringify(after.imageUrls) !== JSON.stringify(before.imageUrls);
}

function endpoint(apiUrl, deviceId, suffix) {
  return new URL(`/api/authV2/open/device/${encodeURIComponent(deviceId)}/${suffix}`, apiUrl);
}

export async function listDeviceTasks(config, options = {}) {
  const result = await requestJson(endpoint(config.apiUrl, config.deviceId, 'loop/list'), {
    apiKey: config.apiKey,
    fetchImpl: options.fetchImpl,
    logger: options.logger,
    stage: 'Quote 任务列表',
    identifier: config.deviceId,
    ...options.retryOptions,
  });
  return result;
}

export async function getCanvasStatus(config, options = {}) {
  const result = await requestJson(endpoint(config.apiUrl, config.deviceId, 'status'), {
    apiKey: config.apiKey,
    fetchImpl: options.fetchImpl,
    logger: options.logger,
    stage: 'Quote 设备状态',
    identifier: config.deviceId,
    validate: (data) => {
      if (!isRecord(data)) throw new InvalidResponseError('Quote 设备状态必须是对象');
      if (!isRecord(data.renderInfo)) throw new InvalidResponseError('Quote 设备状态缺少 renderInfo');
      if (!('last' in data.renderInfo)) throw new InvalidResponseError('Quote 设备状态缺少 renderInfo.last');
      if (!isRecord(data.renderInfo.current)) throw new InvalidResponseError('Quote 设备状态缺少 renderInfo.current');
    },
    ...options.retryOptions,
  });
  return { ...result, snapshot: snapshotCanvasTask(result.data) };
}

export async function postCanvas(config, payload, taskKey, options = {}) {
  return requestJson(endpoint(config.apiUrl, config.deviceId, 'canvas'), {
    method: 'POST',
    apiKey: config.apiKey,
    body: { ...payload, taskKey },
    fetchImpl: options.fetchImpl,
    logger: options.logger,
    stage: 'Quote Canvas 推送',
    identifier: config.deviceId,
    ...options.retryOptions,
  });
}

function defaultDelay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function pushCanvasAndWait(config, payload, options = {}) {
  const timeoutMs = options.timeoutMs ?? 90_000;
  const pollIntervalMs = options.pollIntervalMs ?? 3_000;
  const delay = options.delay ?? defaultDelay;
  const tasks = await listDeviceTasks(config, options);
  const task = selectCanvasTask(tasks.data, config.taskKey);
  const taskKey = canvasTaskKey(task);
  const initial = await getCanvasStatus(config, options);
  const posted = await postCanvas(config, payload, taskKey, options);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await delay(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
    const current = await getCanvasStatus(config, options);
    if (renderChanged(initial.snapshot, current.snapshot)) {
      const newImage = current.snapshot.imageUrls.find((url) => !initial.snapshot.imageUrls.includes(url));
      return {
        taskKey,
        postStatus: posted.status,
        changed: true,
        snapshot: current.snapshot,
        renderImageUrl: newImage ?? current.snapshot.imageUrls[0] ?? null,
      };
    }
  }
  throw new Error(`Quote 渲染状态在 ${Math.round(timeoutMs / 1000)} 秒内未变化`);
}
