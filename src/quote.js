import { createHash } from 'node:crypto';
import { InvalidResponseError, requestJson } from './http.js';

export class DeviceUnavailableError extends InvalidResponseError {
  constructor(message) {
    super(message);
    this.name = 'DeviceUnavailableError';
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const unavailableStates = [
  { pattern: /休眠|睡眠|\bsleep(?:ing)?\b/i, label: '设备休眠中' },
  { pattern: /离线|断开|未连接|\boffline\b|\bdisconnected\b/i, label: '设备离线' },
  { pattern: /关机|已关闭|\bpower(?:ed)?\s*off\b|\bshut(?:ting)?\s*down\b/i, label: '设备已关机' },
  { pattern: /不可用|\bunavailable\b|\bnot\s+ready\b/i, label: '设备不可用' },
];

const availableStatePattern = /^(?:(?:power|battery)\s+active|active|ready|在线|运行中|工作中|供电中|电池供电中|电源活跃|电池活跃)$/i;
const availableDescriptionPattern = /ready\s+to\s+use|可用|可以使用|正常运行|已接入电源/i;

export function assertDeviceAvailable(data) {
  if (!isRecord(data.status)) throw new InvalidResponseError('Quote 设备状态缺少 status');
  const current = typeof data.status.current === 'string' ? data.status.current.trim() : '';
  const description = typeof data.status.description === 'string' ? data.status.description.trim() : '';
  if (!current) throw new InvalidResponseError('Quote 设备状态缺少 status.current');
  if (!description) throw new InvalidResponseError('Quote 设备状态缺少 status.description');

  const combined = `${current}\n${description}`;
  const unavailable = unavailableStates.find(({ pattern }) => pattern.test(combined));
  if (unavailable) throw new DeviceUnavailableError(`Quote ${unavailable.label}；请唤醒设备后重试`);

  if (!availableStatePattern.test(current) && !availableDescriptionPattern.test(description)) {
    throw new DeviceUnavailableError('Quote 设备状态无法确认可用；请确认设备已唤醒并接入电源与网络');
  }
  return { current };
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
  if ((after.pendingImageUrls ?? []).length > 0) return false;
  if (after.last !== JSON.stringify(null) && after.last !== before.last) return true;
  if (JSON.stringify(after.imageUrls) !== JSON.stringify(before.imageUrls)) return true;
  return JSON.stringify(after.imageFingerprints ?? []) !== JSON.stringify(before.imageFingerprints ?? []);
}

async function fetchRenderFingerprint(url, options = {}) {
  if (!/^https?:\/\//i.test(url)) throw new InvalidResponseError('Quote 渲染图 URL 非 http(s)');
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const logger = options.logger ?? (() => {});
  const retryOptions = options.retryOptions ?? {};
  const retries = retryOptions.retries ?? 3;
  const baseDelayMs = retryOptions.baseDelayMs ?? 100;
  const delay = retryOptions.delay ?? defaultDelay;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    logger({ phase: 'request', stage: 'Quote 渲染图指纹', attempt: attempt + 1, identifier: '***' });
    try {
      const response = await fetchImpl(url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(options.imageTimeoutMs ?? 15_000),
      });
      logger({ phase: 'status', stage: 'Quote 渲染图指纹', status: response.status, identifier: '***' });
      if (response.status === 404 && options.allowPendingImage) return null;
      if (!response.ok) {
        const error = new Error(`Quote 渲染图指纹返回 HTTP ${response.status}`);
        error.statusCode = response.status;
        throw error;
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 5 * 1024 * 1024) throw new InvalidResponseError('Quote 渲染图超过 5 MiB');
      return createHash('sha256').update(bytes).digest('hex');
    } catch (error) {
      const status = error?.statusCode;
      const retryable =
        !(error instanceof InvalidResponseError) &&
        (status === 429 || (status !== undefined && status >= 500) || status === undefined);
      if (!retryable || attempt >= retries) throw error;
      await delay(baseDelayMs * 2 ** attempt);
    }
  }
  throw new Error('Quote 渲染图指纹请求失败');
}

async function snapshotCanvasStatus(data, options = {}) {
  const snapshot = snapshotCanvasTask(data);
  if (!options.includeImageFingerprints || snapshot.imageUrls.length === 0) return snapshot;
  const fingerprints = await Promise.all(snapshot.imageUrls.map(async (url) => ({
    url,
    sha256: await fetchRenderFingerprint(url, options),
  })));
  return {
    ...snapshot,
    imageFingerprints: fingerprints.filter(({ sha256 }) => sha256 !== null),
    pendingImageUrls: fingerprints.filter(({ sha256 }) => sha256 === null).map(({ url }) => url),
  };
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
      assertDeviceAvailable(data);
      if (!isRecord(data.renderInfo)) throw new InvalidResponseError('Quote 设备状态缺少 renderInfo');
      if (!('last' in data.renderInfo)) throw new InvalidResponseError('Quote 设备状态缺少 renderInfo.last');
      if (!isRecord(data.renderInfo.current)) throw new InvalidResponseError('Quote 设备状态缺少 renderInfo.current');
    },
    ...options.retryOptions,
  });
  return { ...result, snapshot: await snapshotCanvasStatus(result.data, options) };
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
  const statusOptions = { ...options, includeImageFingerprints: true, allowPendingImage: true };
  const initial = await getCanvasStatus(config, statusOptions);
  const posted = await postCanvas(config, payload, taskKey, options);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await delay(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
    const current = await getCanvasStatus(config, statusOptions);
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
