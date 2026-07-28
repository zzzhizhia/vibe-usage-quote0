import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_VIBE_URL = 'https://vibecafe.ai';
const DEFAULT_QUOTE_URL = 'https://dot.mindreset.tech';

function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(`配置文件不是有效 JSON：${path}`);
  }
}

export function vibeConfigPath() {
  return join(homedir(), '.vibe-usage', 'config.json');
}

export function quoteConfigPath(env = process.env) {
  const root = env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(root, 'vibe-usage-quote0', 'config.json');
}

export function fileMode(path) {
  if (!existsSync(path)) return null;
  return statSync(path).mode & 0o777;
}

export function loadVibeConfig(env = process.env) {
  const path = vibeConfigPath();
  const file = readJson(path) ?? {};
  const apiKey = env.VIBE_USAGE_API_KEY || file.apiKey;
  const apiUrl = env.VIBE_USAGE_API_URL || file.apiUrl || DEFAULT_VIBE_URL;
  if (!apiKey) throw new Error('缺少 Vibe API key');
  return {
    apiKey,
    apiUrl,
    path,
    insecureMode: fileMode(path) !== null && (fileMode(path) & 0o077) !== 0,
  };
}

export function loadQuoteConfig(env = process.env) {
  const path = quoteConfigPath(env);
  const mode = fileMode(path);
  if (mode !== null && mode !== 0o600) {
    throw new Error(`Quote 配置权限必须为 0600：${path}`);
  }
  const file = readJson(path) ?? {};
  const apiKey = env.QUOTE0_API_KEY || file.apiKey;
  const deviceId = env.QUOTE0_DEVICE_ID || file.deviceId;
  const taskKey = env.QUOTE0_TASK_KEY || file.taskKey;
  const apiUrl = env.QUOTE0_API_URL || file.apiUrl || DEFAULT_QUOTE_URL;
  if (!apiKey) throw new Error('缺少 QUOTE0_API_KEY 或 Quote 配置 apiKey');
  if (!deviceId) throw new Error('缺少 QUOTE0_DEVICE_ID 或 Quote 配置 deviceId');
  return { apiKey, deviceId, taskKey, apiUrl, path };
}
