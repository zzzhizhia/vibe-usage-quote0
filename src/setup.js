import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import * as nodeFs from 'node:fs';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { aggregateUsage } from './aggregate.js';
import { buildCanvasPayload, validateCanvasPayload } from './canvas.js';
import {
  DEFAULT_QUOTE_URL,
  DEFAULT_VIBE_URL,
  normalizeIntervalMinutes,
  quoteConfigPath,
  vibeConfigPath,
} from './config.js';
import { maskIdentifier } from './http.js';
import {
  DeviceUnavailableError,
  canvasTaskKey,
  findCanvasTasks,
  getCanvasStatus,
  listDeviceTasks,
  pushCanvasAndWait,
} from './quote.js';
import { fetchUsage } from './vibe.js';

const WINDOWS_ACL_SCRIPT = fileURLToPath(new URL('../windows/setup.ps1', import.meta.url));
const WINDOWS_INSTALL_SCRIPT = fileURLToPath(new URL('../windows/install.ps1', import.meta.url));

export class SetupCancelledError extends Error {
  constructor(message = 'enable 已取消；未修改配置。') {
    super(message);
    this.name = 'SetupCancelledError';
  }
}

export class SetupStageError extends Error {
  constructor(stage, message, nextCommand) {
    super(`enable 阶段 ${stage} 失败：${message}${nextCommand ? `\n下一步：${nextCommand}` : ''}`);
    this.name = 'SetupStageError';
    this.stage = stage;
    this.nextCommand = nextCommand;
  }
}

function question(input, output, prompt, hidden) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let muted = false;
    const terminalOutput = hidden
      ? new Writable({
        write(chunk, encoding, callback) {
          if (!muted) output.write(chunk, encoding);
          callback();
        },
      })
      : output;
    const rl = createInterface({ input, output: terminalOutput, terminal: true });
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      rl.close();
      if (hidden) output.write('\n');
      callback();
    };
    rl.once('SIGINT', () => finish(() => reject(new SetupCancelledError())));
    rl.once('close', () => {
      if (!settled) finish(() => reject(new SetupCancelledError()));
    });
    rl.question(prompt, (answer) => finish(() => resolve(answer)));
    muted = hidden;
  });
}

export function createTerminalIo(options = {}) {
  const input = options.stdin ?? process.stdin;
  const output = options.stdout ?? process.stdout;
  return {
    isTTY: Boolean(input.isTTY && output.isTTY),
    write(line) {
      output.write(`${line}\n`);
    },
    prompt(message) {
      return question(input, output, message, false);
    },
    secret(message) {
      return question(input, output, message, true);
    },
    async confirm(message, defaultValue = true) {
      for (;;) {
        const suffix = defaultValue ? ' [Y/n] ' : ' [y/N] ';
        const answer = (await question(input, output, `${message}${suffix}`, false)).trim().toLowerCase();
        if (!answer) return defaultValue;
        if (answer === 'y' || answer === 'yes') return true;
        if (answer === 'n' || answer === 'no') return false;
        output.write('请输入 y 或 n。\n');
      }
    },
    async select(message, choices, defaultIndex = 0) {
      for (;;) {
        const answer = (await question(
          input,
          output,
          `${message} [${defaultIndex + 1}] `,
          false,
        )).trim();
        const index = answer === '' ? defaultIndex : Number(answer) - 1;
        if (Number.isInteger(index) && index >= 0 && index < choices.length) return choices[index].value;
        output.write(`请输入 1-${choices.length}。\n`);
      }
    },
  };
}

function readOptionalConfig(path, fileSystem) {
  if (!fileSystem.existsSync(path)) return null;
  let parsed;
  try {
    parsed = JSON.parse(fileSystem.readFileSync(path, 'utf8'));
  } catch {
    throw new Error(`配置文件不是有效 JSON：${path}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`配置文件必须是 JSON 对象：${path}`);
  }
  return parsed;
}

async function readRequiredSecret(io, prompt, label) {
  for (;;) {
    const normalized = String(await io.secret(prompt) ?? '').trim();
    if (normalized) return normalized;
    io.write(`${label} 不能为空，请重试。`);
  }
}

function redactText(value, secrets) {
  let text = String(value ?? '未知错误');
  for (const secret of secrets) {
    if (secret) text = text.split(secret).join('[已脱敏]');
  }
  return text;
}

function setupTempPath(path, kind) {
  return `${path}.${process.pid}.${randomBytes(6).toString('hex')}.${kind}`;
}

function removeIfPresent(fileSystem, path) {
  if (fileSystem.existsSync(path)) fileSystem.unlinkSync(path);
}

export function windowsPowerShellEnvironment(env = process.env) {
  const childEnv = { ...env };
  for (const name of Object.keys(childEnv)) {
    if (name.toLowerCase() === 'psmodulepath') delete childEnv[name];
  }
  return childEnv;
}

export function protectWindowsConfig(path, options = {}) {
  const spawn = options.spawnSyncImpl ?? spawnSync;
  const result = spawn('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    options.scriptPath ?? WINDOWS_ACL_SCRIPT,
    '-Path',
    path,
  ], {
    encoding: 'utf8',
    windowsHide: true,
    env: windowsPowerShellEnvironment(options.processEnv),
  });
  if (result.error) throw new Error(`无法设置 Windows 配置 ACL：${result.error.message}`);
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim().replace(/\s+/g, ' ');
    throw new Error(`无法设置 Windows 配置 ACL${detail ? `：${detail}` : ''}；配置未替换`);
  }
}

export function writeConfigsAtomically(entries, options = {}) {
  const fileSystem = options.fileSystem ?? nodeFs;
  const platform = options.platform ?? process.platform;
  const protectFile = options.protectFile ?? ((path) => protectWindowsConfig(path, options));
  const prepared = [];
  const replacements = [];

  try {
    for (const entry of entries) {
      fileSystem.mkdirSync(dirname(entry.path), { recursive: true, mode: 0o700 });
      const tempPath = setupTempPath(entry.path, 'tmp');
      const backupPath = setupTempPath(entry.path, 'bak');
      prepared.push({ ...entry, tempPath, backupPath });
      const descriptor = fileSystem.openSync(tempPath, 'wx', 0o600);
      try {
        fileSystem.writeFileSync(descriptor, `${JSON.stringify(entry.value, null, 2)}\n`, 'utf8');
        fileSystem.fsyncSync(descriptor);
      } finally {
        fileSystem.closeSync(descriptor);
      }
      if (platform === 'win32') protectFile(tempPath);
      else fileSystem.chmodSync(tempPath, 0o600);
    }

    for (const item of prepared) {
      const replacement = {
        ...item,
        hadOriginal: fileSystem.existsSync(item.path),
        installed: false,
      };
      replacements.push(replacement);
      if (replacement.hadOriginal) {
        if (platform === 'win32') protectFile(item.path);
        fileSystem.renameSync(item.path, item.backupPath);
      }
      fileSystem.renameSync(item.tempPath, item.path);
      replacement.installed = true;
    }
  } catch (error) {
    let rollbackError = null;
    for (const item of [...replacements].reverse()) {
      try {
        if (item.installed) removeIfPresent(fileSystem, item.path);
        if (item.hadOriginal && fileSystem.existsSync(item.backupPath)) {
          fileSystem.renameSync(item.backupPath, item.path);
        }
      } catch (currentError) {
        rollbackError ??= currentError;
      }
    }
    for (const item of prepared) {
      try {
        removeIfPresent(fileSystem, item.tempPath);
      } catch (currentError) {
        rollbackError ??= currentError;
      }
    }
    const cause = error?.message || String(error);
    const detail = rollbackError
      ? `配置原子写入失败：${cause}；且回滚未能完整完成`
      : `配置原子写入失败：${cause}；原配置已保留`;
    throw new SetupStageError('配置写入', detail, '检查配置目录权限后重新运行 vibe-usage-quote0 enable');
  }

  let cleanupError = null;
  for (const item of replacements) {
    if (!item.hadOriginal) continue;
    try {
      removeIfPresent(fileSystem, item.backupPath);
    } catch (error) {
      cleanupError ??= error;
    }
  }
  if (cleanupError) {
    throw new SetupStageError(
      '配置写入',
      '新配置已写入，但旧配置的受限安全备份未能清理',
      '检查配置目录中的 .bak 文件后重新运行 vibe-usage-quote0 enable',
    );
  }
}

export function installWindowsScheduledTask(options = {}) {
  const intervalMinutes = normalizeIntervalMinutes(options.intervalMinutes);
  const spawn = options.spawnSyncImpl ?? spawnSync;
  const result = spawn('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    options.scriptPath ?? WINDOWS_INSTALL_SCRIPT,
    '-IntervalMinutes',
    String(intervalMinutes),
  ], {
    encoding: 'utf8',
    windowsHide: true,
    env: windowsPowerShellEnvironment(options.processEnv),
  });
  if (result.error) throw new Error(`无法启动 Windows 计划任务安装器：${result.error.message}`);
  if (result.status !== 0) throw new Error('Windows 计划任务安装失败');
}

function existingSummary(io, label, path, config, fields) {
  if (!config) {
    io.write(`${label} 配置未找到；将写入路径：${path}`);
    return;
  }
  const identifiers = fields
    .filter((field) => config[field])
    .map((field) => `${field}=${maskIdentifier(config[field])}`)
    .join('，');
  io.write(`${label} 配置：${path}${identifiers ? `；${identifiers}` : '；标识未设置'}`);
}

async function chooseVibeConfig(existing, io, secrets) {
  const reusable = Boolean(existing?.apiKey);
  if (reusable && await io.confirm('复用现有 Vibe 配置？', true)) {
    return { ...existing, apiUrl: existing.apiUrl || DEFAULT_VIBE_URL };
  }
  if (existing && !await io.confirm('确认替换现有 Vibe 凭据？', false)) {
    throw new SetupCancelledError('已拒绝替换 Vibe 配置；未修改任何配置。');
  }
  const apiKey = await readRequiredSecret(io, 'Vibe API Key（输入不回显）：', 'Vibe API Key');
  secrets.push(apiKey);
  return { ...(existing ?? {}), apiKey, apiUrl: existing?.apiUrl || DEFAULT_VIBE_URL };
}

async function chooseQuoteConfig(existing, io, secrets) {
  const reusable = Boolean(existing?.apiKey && existing?.deviceId);
  if (reusable && await io.confirm('复用现有 Dot/Quote 配置？', true)) {
    return { ...existing, apiUrl: existing.apiUrl || DEFAULT_QUOTE_URL };
  }
  const hasCredentialFields = Boolean(existing?.apiKey || existing?.deviceId);
  if (hasCredentialFields && !await io.confirm('确认替换现有 Dot/Quote 凭据与设备？', false)) {
    throw new SetupCancelledError('已拒绝替换 Dot/Quote 配置；未修改任何配置。');
  }
  const apiKey = await readRequiredSecret(io, 'Dot API Key（输入不回显）：', 'Dot API Key');
  const deviceId = await readRequiredSecret(io, '设备 ID（输入不回显）：', '设备 ID');
  secrets.push(apiKey, deviceId);
  return {
    ...(existing ?? {}),
    apiKey,
    deviceId,
    apiUrl: existing?.apiUrl || DEFAULT_QUOTE_URL,
  };
}

function defaultApiClient(runtime) {
  return {
    fetchUsage(config, days) {
      return fetchUsage({
        ...config,
        days,
        fetchImpl: runtime.fetchImpl,
        logger: runtime.logger,
        retryOptions: runtime.retryOptions,
      });
    },
    listDeviceTasks(config) {
      return listDeviceTasks(config, runtime);
    },
    getCanvasStatus(config) {
      return getCanvasStatus(config, runtime);
    },
    pushCanvas(config, payload) {
      return pushCanvasAndWait(config, payload, runtime);
    },
  };
}

async function selectCanvas(response, existingTaskKey, io) {
  const canvases = findCanvasTasks(response);
  if (canvases.length === 0) {
    throw new Error('设备循环任务中没有 CANVAS_API 画板；请先在 Dot. App 内容工坊添加“画板 API”。');
  }
  if (canvases.length === 1) {
    const key = canvasTaskKey(canvases[0]);
    io.write(`自动选择唯一 CANVAS_API：${maskIdentifier(key)}`);
    return key;
  }

  const choices = canvases.map((task, index) => {
    const value = canvasTaskKey(task);
    return { value, label: `${index + 1}. CANVAS_API ${maskIdentifier(value)}` };
  });
  io.write('检测到多个 CANVAS_API，请按编号确认目标：');
  for (const choice of choices) io.write(choice.label);
  const existingIndex = choices.findIndex((choice) => choice.value === existingTaskKey);
  return io.select('选择画板编号', choices, existingIndex >= 0 ? existingIndex : 0);
}

async function runSetupCore(options, secrets) {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') {
    throw new SetupStageError('平台检查', '第一版 enable 仅支持 Windows 10/11；现有 doctor/dry-run/push 保持可用');
  }
  const io = options.io ?? createTerminalIo();
  if (!io.isTTY) {
    throw new SetupStageError('交互检查', 'enable 需要交互式终端，不能在非 TTY 环境输入凭据');
  }

  const fileSystem = options.fileSystem ?? nodeFs;
  const env = options.env ?? process.env;
  const pathOptions = { platform, home: options.home };
  const paths = options.paths ?? {
    vibe: vibeConfigPath(env, pathOptions),
    quote: quoteConfigPath(env, pathOptions),
  };
  const existingVibe = readOptionalConfig(paths.vibe, fileSystem);
  const existingQuote = readOptionalConfig(paths.quote, fileSystem);
  existingSummary(io, 'Vibe', paths.vibe, existingVibe, ['apiKey']);
  existingSummary(io, 'Dot/Quote', paths.quote, existingQuote, ['apiKey', 'deviceId', 'taskKey']);

  const vibe = await chooseVibeConfig(existingVibe, io, secrets);
  const quote = await chooseQuoteConfig(existingQuote, io, secrets);
  const intervalMinutes = normalizeIntervalMinutes(quote.intervalMinutes);
  quote.intervalMinutes = intervalMinutes;
  secrets.push(vibe.apiKey, quote.apiKey, quote.deviceId);

  const runtime = {
    fetchImpl: options.fetchImpl,
    logger: options.logger ?? (() => {}),
    retryOptions: options.retryOptions,
    timeoutMs: options.timeoutMs,
    pollIntervalMs: options.pollIntervalMs,
    delay: options.delay,
  };
  const api = options.apiClient ?? defaultApiClient(runtime);
  let today;
  let week;
  let tasks;
  try {
    [today, week] = await Promise.all([
      api.fetchUsage(vibe, 1),
      api.fetchUsage(vibe, 7),
    ]);
    tasks = await api.listDeviceTasks(quote);
  } catch (error) {
    throw new SetupStageError('凭据验证', redactText(error?.message, secrets));
  }

  let taskKey;
  try {
    taskKey = await selectCanvas(tasks.data ?? tasks, quote.taskKey, io);
  } catch (error) {
    throw new SetupStageError('画板发现', redactText(error?.message, secrets));
  }
  quote.taskKey = taskKey;

  let availabilityError = null;
  try {
    await api.getCanvasStatus(quote);
  } catch (error) {
    if (error instanceof DeviceUnavailableError || error?.name === 'DeviceUnavailableError') {
      availabilityError = error;
    } else {
      throw new SetupStageError('设备验证', redactText(error?.message, secrets));
    }
  }

  io.write(`目标设备：${maskIdentifier(quote.deviceId)}；CANVAS_API：${maskIdentifier(taskKey)}`);
  const confirmed = await io.confirm(
    availabilityError
      ? '设备当前不可用；确认保存此目标并在唤醒后重试？'
      : '确认目标并立即执行真实 push？',
    true,
  );
  if (!confirmed) throw new SetupCancelledError('未确认设备目标；未修改配置，也未执行 push。');

  writeConfigsAtomically([
    { path: paths.vibe, value: vibe },
    { path: paths.quote, value: quote },
  ], {
    fileSystem,
    platform,
    protectFile: options.protectFile,
    spawnSyncImpl: options.spawnSyncImpl,
    scriptPath: options.aclScriptPath,
  });
  io.write('凭据与目标验证通过，配置已安全保存。');

  if (availabilityError) {
    throw new SetupStageError(
      '真实 push',
      `${redactText(availabilityError.message, secrets)}；有效配置已保留`,
      '唤醒设备后重新运行 vibe-usage-quote0 enable',
    );
  }

  const summary = aggregateUsage(today, week);
  const payload = buildCanvasPayload(summary, options.now ?? new Date());
  validateCanvasPayload(payload, [vibe.apiKey, quote.apiKey, quote.deviceId]);
  let pushResult;
  try {
    pushResult = await api.pushCanvas(quote, payload);
  } catch (error) {
    throw new SetupStageError(
      '真实 push',
      `${redactText(error?.message, secrets)}；有效配置已保留，未安装计划任务`,
      '确认设备已唤醒后重新运行 vibe-usage-quote0 enable',
    );
  }
  if (!pushResult?.changed) {
    throw new SetupStageError(
      '真实 push',
      '未确认渲染变化；有效配置已保留，未安装计划任务',
      '确认设备已唤醒后重新运行 vibe-usage-quote0 enable',
    );
  }
  io.write('真实 push 已确认渲染变化。');

  let installConfirmed;
  try {
    installConfirmed = await io.confirm(`安装或更新每 ${intervalMinutes} 分钟的当前用户计划任务？`, true);
  } catch (error) {
    if (error instanceof SetupCancelledError) {
      throw new SetupCancelledError(
        'enable 在计划任务安装前取消；有效配置与已确认的真实 push 已保留，计划任务未安装。下一步：重新运行 vibe-usage-quote0 enable',
      );
    }
    throw error;
  }
  if (!installConfirmed) {
    io.write('配置与真实 push 已完成；按用户选择未安装计划任务。');
    return { configured: true, pushed: true, scheduled: false, taskKey };
  }

  try {
    if (options.installScheduledTask) await options.installScheduledTask(intervalMinutes);
    else installWindowsScheduledTask({ ...options, intervalMinutes });
  } catch (error) {
    throw new SetupStageError(
      '计划任务安装',
      `${redactText(error?.message, secrets)}；有效配置与已确认的 push 均保留`,
      '修复 Windows 任务计划程序问题后重新运行 vibe-usage-quote0 enable',
    );
  }
  io.write(`配置完成：真实 push 已确认，每 ${intervalMinutes} 分钟的当前用户计划任务已安装。`);
  return { configured: true, pushed: true, scheduled: true, taskKey, intervalMinutes };
}

export async function runSetup(options = {}) {
  const secrets = [];
  try {
    return await runSetupCore(options, secrets);
  } catch (error) {
    if (error instanceof SetupCancelledError) throw error;
    if (error instanceof SetupStageError) {
      error.message = redactText(error.message, secrets);
      throw error;
    }
    throw new SetupStageError('未预期错误', redactText(error?.message, secrets));
  }
}
