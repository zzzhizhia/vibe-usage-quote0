import test from 'node:test';
import assert from 'node:assert/strict';
import { join, win32 } from 'node:path';
import {
  assertQuoteConfigMode,
  dataDirectory,
  isVibeConfigModeInsecure,
  quoteConfigPath,
} from '../src/config.js';

test('渲染图目录遵循 XDG_DATA_HOME', () => {
  assert.equal(
    dataDirectory({ XDG_DATA_HOME: '/tmp/vibe-data' }),
    join('/tmp/vibe-data', 'vibe-usage-quote0'),
  );
});

test('macOS/Linux 默认目录保持 XDG 之前的行为', () => {
  const options = { platform: 'darwin', home: '/Users/alice' };

  assert.equal(
    quoteConfigPath({}, options),
    join('/Users/alice', '.config', 'vibe-usage-quote0', 'config.json'),
  );
  assert.equal(
    dataDirectory({}, options),
    join('/Users/alice', '.local', 'share', 'vibe-usage-quote0'),
  );
});

test('Windows 默认使用 APPDATA 配置和 LOCALAPPDATA 数据目录', () => {
  const env = {
    APPDATA: 'C:\\Users\\alice\\AppData\\Roaming',
    LOCALAPPDATA: 'C:\\Users\\alice\\AppData\\Local',
    USERPROFILE: 'C:\\Users\\alice',
  };
  const options = { platform: 'win32' };

  assert.equal(
    quoteConfigPath(env, options),
    win32.join(env.APPDATA, 'vibe-usage-quote0', 'config.json'),
  );
  assert.equal(
    dataDirectory(env, options),
    win32.join(env.LOCALAPPDATA, 'vibe-usage-quote0'),
  );
});

test('Windows 显式 XDG 覆盖默认目录', () => {
  const env = {
    XDG_CONFIG_HOME: 'D:\\xdg-config',
    XDG_DATA_HOME: 'D:\\xdg-data',
  };
  const options = { platform: 'win32' };

  assert.equal(
    quoteConfigPath(env, options),
    win32.join(env.XDG_CONFIG_HOME, 'vibe-usage-quote0', 'config.json'),
  );
  assert.equal(
    dataDirectory(env, options),
    win32.join(env.XDG_DATA_HOME, 'vibe-usage-quote0'),
  );
});

test('Windows 缺少 APPDATA 或 LOCALAPPDATA 时使用 USERPROFILE 回退', () => {
  const env = { USERPROFILE: 'C:\\Users\\alice' };
  const options = { platform: 'win32' };

  assert.equal(
    quoteConfigPath(env, options),
    win32.join(env.USERPROFILE, 'AppData', 'Roaming', 'vibe-usage-quote0', 'config.json'),
  );
  assert.equal(
    dataDirectory(env, options),
    win32.join(env.USERPROFILE, 'AppData', 'Local', 'vibe-usage-quote0'),
  );
});

test('Windows 无 XDG、USERPROFILE 和系统目录变量时明确失败', () => {
  const options = { platform: 'win32' };

  assert.throws(() => quoteConfigPath({}, options), /APPDATA.*USERPROFILE/);
  assert.throws(() => dataDirectory({}, options), /LOCALAPPDATA.*USERPROFILE/);
});

test('Unix 严格要求 0600，Windows 不使用无意义的 Unix mode', () => {
  assert.doesNotThrow(() => assertQuoteConfigMode('/tmp/config.json', 0o600, 'linux'));
  assert.throws(
    () => assertQuoteConfigMode('/tmp/config.json', 0o640, 'linux'),
    /0600/,
  );
  assert.doesNotThrow(() => assertQuoteConfigMode('C:\\config.json', 0o666, 'win32'));
});

test('Vibe 配置只在 Unix mode 有安全意义时警告', () => {
  assert.equal(isVibeConfigModeInsecure(0o600, 'darwin'), false);
  assert.equal(isVibeConfigModeInsecure(0o644, 'darwin'), true);
  assert.equal(isVibeConfigModeInsecure(0o666, 'win32'), false);
  assert.equal(isVibeConfigModeInsecure(null, 'win32'), false);
});
