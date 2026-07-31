import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadQuoteSettings,
  normalizeIntervalMinutes,
} from './config.js';
import { windowsPowerShellEnvironment, writeConfigsAtomically } from './setup.js';

const LAUNCHD_LABEL = 'com.vibeusage.vibe-usage-quote0';
const WINDOWS_UPDATE_SCRIPT = fileURLToPath(new URL('../windows/update-interval.ps1', import.meta.url));

function runProcess(command, args, options, failureMessage) {
  const spawn = options.spawnSyncImpl ?? spawnSync;
  const result = spawn(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    env: options.env ?? process.env,
  });
  if (result.error) throw new Error(`${failureMessage}：${result.error.message}`);
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim().replace(/\s+/g, ' ');
    throw new Error(`${failureMessage}${detail ? `：${detail}` : ''}`);
  }
  return result;
}

export function launchAgentPath(options = {}) {
  return options.plistPath
    ?? join(options.home ?? homedir(), 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);
}

export function updateInstalledSchedule(intervalMinutes, options = {}) {
  const minutes = normalizeIntervalMinutes(intervalMinutes);
  const platform = options.platform ?? process.platform;

  if (platform === 'win32') {
    const processOptions = {
      ...options,
      env: windowsPowerShellEnvironment(options.env),
    };
    const result = runProcess('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      options.windowsScriptPath ?? WINDOWS_UPDATE_SCRIPT,
      '-IntervalMinutes',
      String(minutes),
    ], processOptions, '无法更新 Windows 计划任务刷新间隔');
    return {
      platform,
      installed: /schedule_updated=true/i.test(String(result.stdout)),
      updated: /schedule_updated=true/i.test(String(result.stdout)),
    };
  }

  if (platform === 'darwin') {
    const plistPath = launchAgentPath(options);
    const fileExists = options.existsSyncImpl ?? existsSync;
    if (!fileExists(plistPath)) return { platform, installed: false, updated: false, plistPath };

    runProcess('plutil', [
      '-replace',
      'StartInterval',
      '-integer',
      String(minutes * 60),
      plistPath,
    ], options, '无法更新 launchd plist 刷新间隔');

    const spawn = options.spawnSyncImpl ?? spawnSync;
    const uid = options.uid ?? process.getuid?.();
    if (!Number.isInteger(uid)) {
      return { platform, installed: true, updated: true, loaded: false, plistPath };
    }
    const domain = `gui/${uid}`;
    const printResult = spawn('launchctl', ['print', `${domain}/${LAUNCHD_LABEL}`], {
      encoding: 'utf8',
      env: options.env ?? process.env,
    });
    if (printResult.error || printResult.status !== 0) {
      return { platform, installed: true, updated: true, loaded: false, plistPath };
    }
    runProcess('launchctl', ['bootout', `${domain}/${LAUNCHD_LABEL}`], options, '无法卸载旧的 launchd 任务');
    runProcess('launchctl', ['bootstrap', domain, plistPath], options, 'plist 已更新，但无法重新加载 launchd 任务');
    return { platform, installed: true, updated: true, loaded: true, plistPath };
  }

  return { platform, installed: false, updated: false, unsupported: true };
}

export async function configureInterval(value, options = {}) {
  const intervalMinutes = normalizeIntervalMinutes(value);
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const pathOptions = { platform, home: options.home };
  const { path, value: existing } = loadQuoteSettings(env, pathOptions);
  const next = { ...existing, intervalMinutes };

  writeConfigsAtomically([{ path, value: next }], {
    fileSystem: options.fileSystem,
    platform,
    protectFile: options.protectFile,
    spawnSyncImpl: options.spawnSyncImpl,
    scriptPath: options.aclScriptPath,
  });

  const updateSchedule = options.scheduleUpdater ?? updateInstalledSchedule;
  let schedule;
  try {
    schedule = await updateSchedule(intervalMinutes, {
      ...options,
      env,
      platform,
    });
  } catch (error) {
    throw new Error(`刷新间隔已保存为 ${intervalMinutes} 分钟，但调度任务更新失败：${error?.message || String(error)}`);
  }
  return { intervalMinutes, path, schedule };
}
