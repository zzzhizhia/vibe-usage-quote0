import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import {
  DEFAULT_INTERVAL_MINUTES,
  assertQuoteConfigMode,
  dataDirectory,
  hardenVibeConfigMode,
  isVibeConfigModeInsecure,
  loadDisplaySettings,
  loadQuoteConfig,
  loadVibeConfig,
  normalizeIntervalMinutes,
  quoteConfigPath,
} from '../src/config.js';
import { createChmodTracker, hasPrivateChmod } from './helpers/file-mode.js';

const CONFIG_TEST_PLATFORM = process.platform === 'win32' ? 'win32' : 'linux';

test('刷新间隔默认 30 分钟且只接受受支持的整数分钟', () => {
  assert.equal(normalizeIntervalMinutes(), DEFAULT_INTERVAL_MINUTES);
  assert.equal(normalizeIntervalMinutes('45'), 45);
  for (const value of ['0', '-1', '1.5', 'abc', 0, 44_641]) {
    assert.throws(() => normalizeIntervalMinutes(value), /整数分钟/);
  }
});

test('Quote 运行配置在旧配置缺少新字段时保留默认间隔与显示档位', () => {
  const config = loadQuoteConfig({
    QUOTE0_API_KEY: 'quote-key',
    QUOTE0_DEVICE_ID: 'device-id',
  }, { platform: 'darwin', home: '/path/that/does/not/exist' });

  assert.equal(config.intervalMinutes, 30);
  assert.deepEqual(config.display, { main: 'today', secondary: '7d' });
});

test('显示配置可独立读取且不要求 Quote 凭据', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'vibe-display-settings-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, 'vibe-usage-quote0');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'config.json'), JSON.stringify({
    display: { main: '24H', secondary: '30D' },
  }), { mode: 0o600 });

  const result = loadDisplaySettings(
    { XDG_CONFIG_HOME: root },
    { platform: CONFIG_TEST_PLATFORM },
  );
  assert.deepEqual(result.display, { main: '24h', secondary: '30d' });
});

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

test('Vibe 配置只在 Unix mode 有安全意义时判定权限过宽', () => {
  assert.equal(isVibeConfigModeInsecure(0o600, 'darwin'), false);
  assert.equal(isVibeConfigModeInsecure(0o644, 'darwin'), true);
  assert.equal(isVibeConfigModeInsecure(0o666, 'win32'), false);
  assert.equal(isVibeConfigModeInsecure(null, 'win32'), false);
});

test('macOS/Linux 加载现有 Vibe 配置时静默收紧到 0600', (t) => {
  const home = mkdtempSync(join(tmpdir(), 'vibe-config-mode-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const path = join(home, '.vibe-usage', 'config.json');
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, '{"apiKey":"fixture-vibe-mode-key"}\n', { mode: 0o644 });
  const tracker = createChmodTracker();

  const config = loadVibeConfig({}, {
    platform: 'darwin',
    home,
    chmodSyncImpl: tracker.chmodSyncImpl,
    fileModeImpl: process.platform === 'win32' ? () => 0o600 : undefined,
  });

  assert.equal(config.permissionHardened, true);
  assert.equal(config.insecureMode, false);
  assert.equal(hasPrivateChmod(tracker.calls, path), true);
  if (process.platform !== 'win32') assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.match(readFileSync(path, 'utf8'), /fixture-vibe-mode-key/);
});

test('Vibe 配置权限无法收紧时拒绝继续加载凭据', () => {
  assert.throws(() => hardenVibeConfigMode('/private/config.json', 0o644, 'darwin', {
    chmodSyncImpl() { throw new Error('simulated permission denied'); },
  }), /无法将 Vibe 配置权限收紧.*permission denied/);
});

test('Windows Vibe 配置不执行 Unix chmod', () => {
  let chmodCalls = 0;
  const result = hardenVibeConfigMode('C:\\config.json', 0o666, 'win32', {
    chmodSyncImpl() { chmodCalls += 1; },
  });

  assert.equal(chmodCalls, 0);
  assert.equal(result.hardened, false);
});
