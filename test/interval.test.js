import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configureInterval, disableSchedule, updateInstalledSchedule } from '../src/interval.js';

function temporaryConfig(t, value = {}) {
  const root = mkdtempSync(join(tmpdir(), 'vibe-usage-quote0-interval-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'vibe-usage-quote0', 'config.json');
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  return { root, path };
}

test('interval 保留现有凭据和未知配置字段', async (t) => {
  const { root, path } = temporaryConfig(t, {
    apiKey: 'existing-quote-key',
    deviceId: 'existing-device',
    customOption: true,
  });
  let scheduledMinutes;

  const result = await configureInterval('90', {
    env: { XDG_CONFIG_HOME: root },
    platform: 'darwin',
    scheduleUpdater(minutes) {
      scheduledMinutes = minutes;
      return { platform: 'darwin', installed: false, updated: false };
    },
  });

  assert.equal(scheduledMinutes, 90);
  assert.equal(result.intervalMinutes, 90);
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), {
    apiKey: 'existing-quote-key',
    deviceId: 'existing-device',
    customOption: true,
    intervalMinutes: 90,
  });
});

test('调度器更新失败时明确说明配置已经保存', async (t) => {
  const { root, path } = temporaryConfig(t);

  await assert.rejects(configureInterval('60', {
    env: { XDG_CONFIG_HOME: root },
    platform: 'darwin',
    scheduleUpdater() { throw new Error('simulated reload failure'); },
  }), /已保存为 60 分钟.*调度任务更新失败/);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).intervalMinutes, 60);
});

test('Windows 调度更新使用独立脚本并传递分钟数', () => {
  let invocation;
  const result = updateInstalledSchedule(75, {
    platform: 'win32',
    env: { PATH: 'C:\\Windows', PSModulePath: 'C:\\PowerShell7\\Modules' },
    windowsScriptPath: 'C:\\package\\windows\\update-interval.ps1',
    spawnSyncImpl(command, args, options) {
      invocation = { command, args, options };
      return { status: 0, stdout: 'schedule_updated=true\n', stderr: '' };
    },
  });

  assert.equal(result.updated, true);
  assert.equal(invocation.command, 'powershell.exe');
  assert.deepEqual(invocation.args.slice(-2), ['-IntervalMinutes', '75']);
  assert.equal(invocation.options.env.PSModulePath, undefined);
  assert.equal(invocation.options.env.PATH, 'C:\\Windows');
});

test('macOS 已加载 launchd 任务会更新 plist 并重新加载', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'vibe-usage-quote0-launchd-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const plistPath = join(root, 'agent.plist');
  writeFileSync(plistPath, '<plist/>\n');
  const calls = [];

  const result = updateInstalledSchedule(12, {
    platform: 'darwin',
    plistPath,
    uid: 501,
    spawnSyncImpl(command, args) {
      calls.push([command, args]);
      return { status: 0, stdout: '', stderr: '' };
    },
  });

  assert.equal(result.loaded, true);
  assert.deepEqual(calls.map(([command]) => command), ['plutil', 'launchctl', 'launchctl', 'launchctl']);
  assert.deepEqual(calls[0][1].slice(0, 5), ['-replace', 'StartInterval', '-integer', '720', plistPath]);
  assert.deepEqual(calls[2][1], ['bootout', 'gui/501/com.vibeusage.vibe-usage-quote0']);
  assert.deepEqual(calls[3][1], ['bootstrap', 'gui/501', plistPath]);
});

test('macOS 未安装 launchd plist 时不执行外部命令', () => {
  let calls = 0;
  const result = updateInstalledSchedule(30, {
    platform: 'darwin',
    plistPath: '/definitely/missing/agent.plist',
    existsSyncImpl: () => false,
    spawnSyncImpl() { calls += 1; },
  });

  assert.equal(result.installed, false);
  assert.equal(calls, 0);
});

test('Windows disable 使用定向卸载脚本且可重复执行', () => {
  const invocations = [];
  const installed = disableSchedule({
    platform: 'win32',
    env: { PATH: 'C:\\Windows', PSModulePath: 'C:\\PowerShell7\\Modules' },
    windowsScriptPath: 'C:\\package\\windows\\uninstall.ps1',
    spawnSyncImpl(command, args, options) {
      invocations.push({ command, args, options });
      return { status: 0, stdout: 'uninstalled_task=VibeUsageQuote0\n', stderr: '' };
    },
  });
  const absent = disableSchedule({
    platform: 'win32',
    windowsScriptPath: 'C:\\package\\windows\\uninstall.ps1',
    spawnSyncImpl() {
      return { status: 0, stdout: 'task_absent=VibeUsageQuote0\n', stderr: '' };
    },
  });

  assert.equal(installed.disabled, true);
  assert.equal(absent.disabled, false);
  assert.equal(absent.absent, true);
  assert.equal(invocations[0].command, 'powershell.exe');
  assert.match(invocations[0].args.join(' '), /uninstall\.ps1/);
  assert.equal(invocations[0].options.env.PSModulePath, undefined);
});

test('macOS disable 卸载服务并只删除固定 plist', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'vibe-usage-quote0-disable-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const plistPath = join(root, 'agent.plist');
  writeFileSync(plistPath, '<plist/>\n');
  const calls = [];

  const result = disableSchedule({
    platform: 'darwin',
    plistPath,
    uid: 501,
    spawnSyncImpl(command, args) {
      calls.push([command, args]);
      return { status: 0, stdout: '', stderr: '' };
    },
  });

  assert.equal(result.disabled, true);
  assert.equal(result.loaded, true);
  assert.equal(result.removed, true);
  assert.equal(result.plistPath, plistPath);
  assert.deepEqual(calls, [
    ['launchctl', ['print', 'gui/501/com.vibeusage.vibe-usage-quote0']],
    ['launchctl', ['bootout', 'gui/501/com.vibeusage.vibe-usage-quote0']],
  ]);
  assert.throws(() => readFileSync(plistPath, 'utf8'), { code: 'ENOENT' });
});

test('macOS disable 在任务不存在时不删除其他文件', () => {
  let removed = false;
  const result = disableSchedule({
    platform: 'darwin',
    plistPath: '/definitely/missing/agent.plist',
    uid: 501,
    existsSyncImpl: () => false,
    unlinkSyncImpl() { removed = true; },
    spawnSyncImpl() {
      return { status: 113, stdout: '', stderr: 'service not found' };
    },
  });

  assert.equal(result.disabled, false);
  assert.equal(result.absent, true);
  assert.equal(removed, false);
});
