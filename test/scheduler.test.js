import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  disableSchedule,
  installScheduledTask,
  installLinuxSystemdTimer,
  updateInstalledSchedule,
} from '../src/scheduler.js';
import { createChmodTracker, hasPrivateChmod } from './helpers/file-mode.js';

function temporaryRoot(t, label) {
  const root = mkdtempSync(join(tmpdir(), `vibe-quote0-${label}-`));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('macOS enable 生成无秘密 launchd 任务并加载当前用户服务', (t) => {
  const root = temporaryRoot(t, 'launchd-install');
  const plistPath = join(root, 'Library', 'LaunchAgents', 'agent.plist');
  const templatePath = join(root, 'launchd-template.plist');
  const template = readFileSync(
    join(import.meta.dirname, '..', 'launchd', 'com.vibeusage.vibe-usage-quote0.plist'),
    'utf8',
  ).replaceAll('\r\n', '\n').replaceAll('\n', '\r\n');
  writeFileSync(templatePath, template);
  const calls = [];
  const tracker = createChmodTracker();
  const result = installScheduledTask({
    platform: 'darwin',
    intervalMinutes: 45,
    home: root,
    plistPath,
    templatePath,
    uid: 501,
    nodePath: '/opt/node & tools/bin/node',
    cliPath: '/opt/vibe usage/src/index.js',
    env: {
      XDG_CONFIG_HOME: join(root, 'config & private'),
      XDG_DATA_HOME: join(root, 'data'),
      VIBE_USAGE_API_KEY: 'must-not-enter-launchd',
    },
    fileSystem: tracker.fileSystem,
    spawnSyncImpl(command, args) {
      calls.push([command, args]);
      if (command === 'launchctl' && args[0] === 'print') {
        return { status: 113, stdout: '', stderr: 'not found' };
      }
      return { status: 0, stdout: '', stderr: '' };
    },
  });

  const plist = readFileSync(plistPath, 'utf8');
  assert.equal(result.installed, true);
  assert.equal(hasPrivateChmod(tracker.calls, plistPath), true);
  if (process.platform !== 'win32') assert.equal(statSync(plistPath).mode & 0o777, 0o600);
  assert.match(plist, /<integer>2700<\/integer>/);
  assert.match(plist, /\/opt\/node &amp; tools\/bin\/node/);
  assert.match(plist, /XDG_CONFIG_HOME/);
  assert.match(plist, /config &amp; private/);
  assert.doesNotMatch(plist, /must-not-enter-launchd|__[A-Z_]+__/);
  assert.deepEqual(calls.map(([command]) => command), ['plutil', 'launchctl', 'launchctl']);
  assert.deepEqual(calls.at(-1)[1], ['bootstrap', 'gui/501', plistPath]);
});

test('Linux enable 安装无秘密 systemd 用户 timer，interval 与 disable 可管理它', (t) => {
  const root = temporaryRoot(t, 'systemd-install');
  const systemdDirectory = join(root, 'config', 'systemd', 'user');
  const calls = [];
  const tracker = createChmodTracker();
  const options = {
    platform: 'linux',
    intervalMinutes: 30,
    home: join(root, 'home with space'),
    systemdDirectory,
    nodePath: '/opt/node%20/bin/node',
    cliPath: '/opt/vibe usage/src/index.js',
    env: {
      XDG_CONFIG_HOME: join(root, 'config'),
      XDG_DATA_HOME: join(root, 'data'),
      QUOTE0_API_KEY: 'must-not-enter-systemd',
    },
    fileSystem: tracker.fileSystem,
    spawnSyncImpl(command, args) {
      calls.push([command, args]);
      return { status: 0, stdout: '', stderr: '' };
    },
  };

  const installed = installScheduledTask(options);
  const service = readFileSync(installed.servicePath, 'utf8');
  const firstTimer = readFileSync(installed.timerPath, 'utf8');
  assert.equal(hasPrivateChmod(tracker.calls, installed.servicePath), true);
  assert.equal(hasPrivateChmod(tracker.calls, installed.timerPath), true);
  if (process.platform !== 'win32') {
    assert.equal(statSync(installed.servicePath).mode & 0o777, 0o600);
    assert.equal(statSync(installed.timerPath).mode & 0o777, 0o600);
  }
  assert.match(service, /ExecStart="\/opt\/node%%20\/bin\/node" "\/opt\/vibe usage\/src\/index\.js" push/);
  assert.match(service, /XDG_CONFIG_HOME=/);
  assert.doesNotMatch(service, /must-not-enter-systemd|apiKey|deviceId/i);
  assert.match(firstTimer, /OnUnitActiveSec=30min/);
  assert.deepEqual(calls.slice(0, 2), [
    ['systemctl', ['--user', 'daemon-reload']],
    ['systemctl', ['--user', 'enable', '--now', 'vibe-usage-quote0.timer']],
  ]);

  const updated = updateInstalledSchedule(75, { ...options, intervalMinutes: undefined });
  assert.equal(updated.updated, true);
  assert.match(readFileSync(installed.timerPath, 'utf8'), /OnUnitActiveSec=75min/);
  assert.deepEqual(calls.slice(2, 4), [
    ['systemctl', ['--user', 'daemon-reload']],
    ['systemctl', ['--user', 'restart', 'vibe-usage-quote0.timer']],
  ]);

  const disabled = disableSchedule(options);
  assert.equal(disabled.disabled, true);
  assert.equal(existsSync(installed.servicePath), false);
  assert.equal(existsSync(installed.timerPath), false);
  assert.deepEqual(calls.slice(4), [
    ['systemctl', ['--user', 'disable', '--now', 'vibe-usage-quote0.timer']],
    ['systemctl', ['--user', 'daemon-reload']],
  ]);

  let extraCalls = 0;
  const absent = disableSchedule({
    ...options,
    spawnSyncImpl() { extraCalls += 1; },
  });
  assert.equal(absent.absent, true);
  assert.equal(extraCalls, 0);
});

test('Linux systemd 用户服务不可用时保留已生成任务供修复后重试', (t) => {
  const root = temporaryRoot(t, 'systemd-failure');
  const systemdDirectory = join(root, 'systemd');
  assert.throws(() => installLinuxSystemdTimer({
    intervalMinutes: 30,
    home: root,
    systemdDirectory,
    spawnSyncImpl() {
      return { status: 1, stdout: '', stderr: 'Failed to connect to bus' };
    },
  }), /无法重载 systemd 用户配置.*Failed to connect to bus/);
  assert.equal(existsSync(join(systemdDirectory, 'vibe-usage-quote0.service')), true);
  assert.equal(existsSync(join(systemdDirectory, 'vibe-usage-quote0.timer')), true);
});
