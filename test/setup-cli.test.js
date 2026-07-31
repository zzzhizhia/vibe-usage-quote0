import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runCli } from '../src/index.js';
import { createChmodTracker, hasPrivateChmod } from './helpers/file-mode.js';

const projectRoot = resolve(import.meta.dirname, '..');

function runFixture(t, scenario) {
  const root = mkdtempSync(join(tmpdir(), `vibe-usage-quote0-setup-fixture-${scenario}-`));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, ['src/index.js', 'enable'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      VIBE_USAGE_QUOTE0_SETUP_FIXTURE: scenario,
      VIBE_USAGE_QUOTE0_SETUP_FIXTURE_ROOT: root,
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    ...result,
    root,
    vibePath: join(root, 'home', '.vibe-usage', 'config.json'),
    quotePath: join(root, 'appdata', 'vibe-usage-quote0', 'config.json'),
  };
}

test('CLI help 列出 enable、disable、update 与 interval 命令', async () => {
  const output = [];
  await runCli(['--help'], { stdout: (line) => output.push(line) });
  const help = output.join('\n');
  assert.match(help, /vibe-usage-quote0 enable/);
  assert.match(help, /vibe-usage-quote0 disable/);
  assert.match(help, /vibe-usage-quote0 update/);
  assert.match(help, /vibe-usage-quote0 interval <minutes>/);
  assert.match(help, /当前平台定时刷新/);
  assert.doesNotMatch(help, /安装 Windows 定时刷新/);
  assert.doesNotMatch(help, /vibe-usage-quote0 setup/);
});

test('CLI interval 无需凭据即可安全保存并等待 Linux enable 安装调度任务', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'vibe-usage-quote0-interval-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = [];
  const tracker = createChmodTracker();
  const result = await runCli(['interval', '45'], {
    env: { XDG_CONFIG_HOME: root },
    platform: 'linux',
    fileSystem: tracker.fileSystem,
    stdout: (line) => output.push(line),
  });
  const path = join(root, 'vibe-usage-quote0', 'config.json');

  assert.equal(result.intervalMinutes, 45);
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { intervalMinutes: 45 });
  assert.equal(hasPrivateChmod(tracker.calls, path), true);
  if (process.platform !== 'win32') assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.match(output.join('\n'), /45 分钟/);
  assert.match(output.join('\n'), /未检测到已安装调度任务/);
});

test('CLI interval 拒绝缺失、多余与非法分钟参数', async () => {
  for (const argv of [['interval'], ['interval', '30', 'extra'], ['interval', '0'], ['interval', '1.5']]) {
    await assert.rejects(runCli(argv, { env: {}, platform: 'linux' }), /用法|整数分钟/);
  }
});

test('CLI enable 只负责编排并拒绝命令行秘密参数', async () => {
  let calls = 0;
  await assert.rejects(
    runCli(['enable', 'secret-on-argv'], { enableRunner: async () => { calls += 1; } }),
    /不接受命令行参数/,
  );
  assert.equal(calls, 0);

  const result = await runCli(['enable'], {
    env: {},
    enableOptions: { io: { isTTY: true } },
    enableRunner: async (options) => {
      calls += 1;
      assert.equal(options.io.isTTY, true);
      return { configured: true };
    },
  });
  assert.deepEqual(result, { configured: true });
  assert.equal(calls, 1);
});

test('CLI 不再兼容 setup 旧命令', async () => {
  await assert.rejects(runCli(['setup']), /未知命令：setup/);
});

test('CLI disable 与 update 拒绝参数并调用各自执行器', async () => {
  await assert.rejects(runCli(['disable', 'extra']), /用法/);
  await assert.rejects(runCli(['update', 'extra']), /用法/);

  const output = [];
  const disabled = await runCli(['disable'], {
    stdout: (line) => output.push(line),
    disableRunner: async () => ({ platform: 'darwin', disabled: true }),
  });
  const updated = await runCli(['update'], {
    stdout: (line) => output.push(line),
    updateRunner: async () => ({ packageSpec: 'vibe-usage-quote0@latest' }),
  });

  assert.equal(disabled.command, 'disable');
  assert.equal(updated.command, 'update');
  assert.match(output.join('\n'), /已解除本工具的定时刷新任务/);
  assert.match(output.join('\n'), /已更新至 npm 最新版/);
});

test('CLI enable 打包测试入口完成安全配置、push 与安装阶段', (t) => {
  const result = runFixture(t, 'success');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(result.vibePath), true);
  assert.equal(existsSync(result.quotePath), true);
  assert.match(result.stdout, /真实 push 已确认渲染变化/);
  assert.match(result.stdout, /enable_fixture_completed=true/);
  assert.doesNotMatch(
    `${result.stdout}\n${result.stderr}`,
    /fixture-(?:vibe|quote|device)-placeholder/,
  );
});

test('CLI enable 的 401 fixture 非零退出、无配置变化、无秘密输出', (t) => {
  const result = runFixture(t, '401');
  assert.equal(result.status, 1);
  assert.equal(existsSync(result.vibePath), false);
  assert.equal(existsSync(result.quotePath), false);
  assert.match(result.stderr, /阶段 凭据验证 失败.*HTTP 401/);
  assert.doesNotMatch(
    `${result.stdout}\n${result.stderr}`,
    /fixture-(?:vibe|quote|device)-placeholder/,
  );
});
