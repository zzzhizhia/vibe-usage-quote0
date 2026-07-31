import test from 'node:test';
import assert from 'node:assert/strict';
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

test('update 在 Windows 使用 npm.cmd 并保留失败码语义', () => {
  assert.throws(() => updateSelf({
    platform: 'win32',
    spawnSyncImpl(command) {
      assert.equal(command, 'npm.cmd');
      return { status: 1, stdout: '', stderr: 'permission denied\n' };
    },
  }), /npm 全局更新失败.*permission denied/);
});
