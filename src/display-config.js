import { loadQuoteSettings } from './config.js';
import {
  normalizeDisplaySettings,
  normalizeDisplayTarget,
  parseDisplayRange,
} from './display.js';
import { writeConfigsAtomically } from './setup.js';

export async function configureDisplay(targetValue, rangeValue, options = {}) {
  const target = normalizeDisplayTarget(targetValue);
  const range = parseDisplayRange(rangeValue);
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const pathOptions = { platform, home: options.home };
  const { path, value: existing } = loadQuoteSettings(env, pathOptions);
  const display = normalizeDisplaySettings(existing.display);
  display[target] = range.value;

  writeConfigsAtomically([{
    path,
    value: { ...existing, display },
  }], {
    fileSystem: options.fileSystem,
    platform,
    protectFile: options.protectFile,
    spawnSyncImpl: options.spawnSyncImpl,
    scriptPath: options.aclScriptPath,
  });

  return { target, range, display, path };
}
