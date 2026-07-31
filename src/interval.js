import {
  loadQuoteSettings,
  normalizeIntervalMinutes,
} from './config.js';
import { writeConfigsAtomically } from './setup.js';
import { disableSchedule, updateInstalledSchedule } from './scheduler.js';

export { disableSchedule, launchAgentPath, updateInstalledSchedule } from './scheduler.js';

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
