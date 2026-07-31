import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { updateSelf } from '../src/update.js';

test('update 通过 npm 参数数组全局安装 latest', () => {
  let invocation;
  const result = updateSelf({
    platform: 'linux',
    env: { PATH: '/usr/bin' },
    spawnSyncImpl(command, args, options) {
      invocation = { command, args, options };
      return { status: 0, stdout: 'updated\n', stderr: '' };
    },
  });

  assert.equal(result.packageSpec, 'vibe-usage-quote0@latest');
  assert.equal(invocation.command, 'npm');
  assert.deepEqual(invocation.args, [
    'install',
    '--global',
    '--no-audit',
    '--no-fund',
    'vibe-usage-quote0@latest',
  ]);
  assert.equal(invocation.options.env.PATH, '/usr/bin');
});

test('update 在 Windows 通过命令解释器执行 npm.cmd 并保留失败码语义', () => {
  assert.throws(() => updateSelf({
    platform: 'win32',
    env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
    spawnSyncImpl(command, args) {
      assert.equal(command, 'C:\\Windows\\System32\\cmd.exe');
      assert.deepEqual(args, [
        '/d',
        '/s',
        '/c',
        'npm.cmd',
        'install',
        '--global',
        '--no-audit',
        '--no-fund',
        'vibe-usage-quote0@latest',
      ]);
      return { status: 1, stdout: '', stderr: 'permission denied\n' };
    },
  }), /npm 全局更新失败.*permission denied/);
});

test('Windows update 可真实启动 cmd shim', (t) => {
  if (process.platform !== 'win32') return;
  const root = mkdtempSync(join(tmpdir(), 'vibe-usage-quote0-update-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const npmCommand = join(root, 'npm-fixture.cmd');
  writeFileSync(npmCommand, '@echo off\r\nexit /b 0\r\n', 'ascii');

  const result = updateSelf({ platform: 'win32', npmCommand });

  assert.equal(result.packageSpec, 'vibe-usage-quote0@latest');
});
