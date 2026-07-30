import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, win32 } from 'node:path';

export const DEFAULT_VIBE_URL = 'https://vibecafe.ai';
export const DEFAULT_QUOTE_URL = 'https://dot.mindreset.tech';

function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(`配置文件不是有效 JSON：${path}`);
  }
}

export function vibeConfigPath(env = process.env, options = {}) {
  const platform = options.platform ?? process.platform;
  const joinPath = pathJoin(platform);
  let home = options.home;
  if (!home && platform === 'win32') home = env.USERPROFILE;
  if (!home) home = homedir();
  return joinPath(home, '.vibe-usage', 'config.json');
}

function pathJoin(platform) {
  return platform === 'win32' ? win32.join : join;
}

function windowsRoot(env, variable, fallbackParts) {
  if (env[variable]) return env[variable];
  if (env.USERPROFILE) return win32.join(env.USERPROFILE, ...fallbackParts);
  throw new Error(`Windows 目录无法确定：缺少 ${variable} 和 USERPROFILE`);
}

export function quoteConfigPath(env = process.env, options = {}) {
  const platform = options.platform ?? process.platform;
  const joinPath = pathJoin(platform);
  let root = env.XDG_CONFIG_HOME;
  if (!root && platform === 'win32') {
    root = windowsRoot(env, 'APPDATA', ['AppData', 'Roaming']);
  }
  if (!root) root = joinPath(options.home ?? homedir(), '.config');
  return joinPath(root, 'vibe-usage-quote0', 'config.json');
}

export function dataDirectory(env = process.env, options = {}) {
  const platform = options.platform ?? process.platform;
  const joinPath = pathJoin(platform);
  let root = env.XDG_DATA_HOME;
  if (!root && platform === 'win32') {
    root = windowsRoot(env, 'LOCALAPPDATA', ['AppData', 'Local']);
  }
  if (!root) root = joinPath(options.home ?? homedir(), '.local', 'share');
  return joinPath(root, 'vibe-usage-quote0');
}

export function fileMode(path) {
  if (!existsSync(path)) return null;
  return statSync(path).mode & 0o777;
}

export function assertQuoteConfigMode(path, mode, platform = process.platform) {
  if (platform === 'win32' || mode === null || mode === 0o600) return;
  throw new Error(`Quote 配置权限必须为 0600：${path}`);
}

export function isVibeConfigModeInsecure(mode, platform = process.platform) {
  return platform !== 'win32' && mode !== null && (mode & 0o077) !== 0;
}

export function loadVibeConfig(env = process.env, options = {}) {
  const path = vibeConfigPath(env, options);
  const file = readJson(path) ?? {};
  const mode = fileMode(path);
  const apiKey = env.VIBE_USAGE_API_KEY || file.apiKey;
  const apiUrl = env.VIBE_USAGE_API_URL || file.apiUrl || DEFAULT_VIBE_URL;
  if (!apiKey) throw new Error('缺少 Vibe API key');
  return {
    apiKey,
    apiUrl,
    path,
    insecureMode: isVibeConfigModeInsecure(mode, options.platform ?? process.platform),
  };
}

export function loadQuoteConfig(env = process.env, options = {}) {
  const path = quoteConfigPath(env, options);
  const mode = fileMode(path);
  assertQuoteConfigMode(path, mode, options.platform ?? process.platform);
  const file = readJson(path) ?? {};
  const apiKey = env.QUOTE0_API_KEY || file.apiKey;
  const deviceId = env.QUOTE0_DEVICE_ID || file.deviceId;
  const taskKey = env.QUOTE0_TASK_KEY || file.taskKey;
  const apiUrl = env.QUOTE0_API_URL || file.apiUrl || DEFAULT_QUOTE_URL;
  if (!apiKey) throw new Error('缺少 QUOTE0_API_KEY 或 Quote 配置 apiKey');
  if (!deviceId) throw new Error('缺少 QUOTE0_DEVICE_ID 或 Quote 配置 deviceId');
  return { apiKey, deviceId, taskKey, apiUrl, path };
}
