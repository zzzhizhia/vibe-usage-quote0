import test from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { vibeConfigPath } from '../src/config.js';
import { DeviceUnavailableError } from '../src/quote.js';
import {
  SetupCancelledError,
  createTerminalIo,
  protectWindowsConfig,
  runSetup,
  writeConfigsAtomically,
} from '../src/setup.js';
import { todayUsage, weekUsage } from './fixtures/usage.js';

function temporaryPaths(t) {
  const root = mkdtempSync(join(tmpdir(), 'vibe-quote0-setup-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return {
    root,
    vibe: join(root, 'home', '.vibe-usage', 'config.json'),
    quote: join(root, 'appdata', 'vibe-usage-quote0', 'config.json'),
  };
}

function writeJson(path, value) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function scriptedIo(options = {}) {
  const secrets = [...(options.secrets ?? [])];
  const confirms = [...(options.confirms ?? [])];
  const selections = [...(options.selections ?? [])];
  const output = [];
  let secretCalls = 0;
  return {
    isTTY: options.isTTY ?? true,
    output,
    get secretCalls() { return secretCalls; },
    write(line) { output.push(String(line)); },
    async secret() {
      secretCalls += 1;
      const value = secrets.shift();
      if (value instanceof Error) throw value;
      if (value === undefined) throw new Error('测试缺少秘密输入');
      return value;
    },
    async confirm() {
      if (confirms.length === 0) throw new Error('测试缺少确认输入');
      const value = confirms.shift();
      if (value instanceof Error) throw value;
      return value;
    },
    async select(message, choices, defaultIndex) {
      return selections.shift() ?? choices[defaultIndex].value;
    },
  };
}

function fakeApi(options = {}) {
  const calls = { days: [], pushes: 0, events: [] };
  const api = {
    async fetchUsage(config, days) {
      calls.days.push(days);
      if (options.usageError) throw options.usageError;
      return days === 1 ? todayUsage : weekUsage;
    },
    async listDeviceTasks() {
      if (options.taskError) throw options.taskError;
      return {
        data: {
          tasks: options.tasks ?? [{ taskKey: 'canvas-target-1001', type: 'CANVAS_API' }],
        },
      };
    },
    async getCanvasStatus() {
      if (options.statusError) throw options.statusError;
      return { data: { status: { current: 'Power Active' }, renderInfo: {} } };
    },
    async pushCanvas() {
      calls.pushes += 1;
      calls.events.push('push');
      if (options.pushError) throw options.pushError;
      return { changed: options.changed ?? true, postStatus: 200 };
    },
  };
  return { api, calls };
}

function setupOptions(paths, io, api, extra = {}) {
  return {
    platform: 'win32',
    paths,
    io,
    apiClient: api,
    protectFile: extra.protectFile ?? (() => {}),
    installScheduledTask: extra.installScheduledTask ?? (() => {}),
    now: new Date('2026-07-30T00:00:00Z'),
    ...extra,
  };
}

test('setup 全新配置验证后原子写入、真实 push 并安装任务', async (t) => {
  const paths = temporaryPaths(t);
  const values = {
    vibe: 'fixture-vibe-secret-1001',
    quote: 'fixture-quote-secret-2002',
    device: 'fixture-device-id-3003',
  };
  const io = scriptedIo({
    secrets: [values.vibe, values.quote, values.device],
    confirms: [true, true],
  });
  const { api, calls } = fakeApi();
  const aclPaths = [];
  let installs = 0;

  const result = await runSetup(setupOptions(paths, io, api, {
    protectFile(path) { aclPaths.push(path); },
    installScheduledTask() {
      installs += 1;
      calls.events.push('install');
    },
  }));

  assert.deepEqual(calls.days.sort(), [1, 7]);
  assert.equal(calls.pushes, 1);
  assert.equal(installs, 1);
  assert.deepEqual(calls.events, ['push', 'install']);
  assert.equal(result.scheduled, true);
  assert.equal(readJson(paths.vibe).apiKey, values.vibe);
  assert.deepEqual(readJson(paths.quote), {
    apiKey: values.quote,
    deviceId: values.device,
    apiUrl: 'https://dot.mindreset.tech',
    taskKey: 'canvas-target-1001',
  });
  assert.equal(aclPaths.length, 2);
  assert.ok(aclPaths.every((path) => path.endsWith('.tmp')));
  const visible = io.output.join('\n');
  assert.doesNotMatch(visible, new RegExp(values.vibe));
  assert.doesNotMatch(visible, new RegExp(values.quote));
  assert.doesNotMatch(visible, new RegExp(values.device));
});

test('setup 默认复用两份现有配置且不重复索要凭据', async (t) => {
  const paths = temporaryPaths(t);
  writeJson(paths.vibe, { apiKey: 'existing-vibe-4004', apiUrl: 'https://vibe.example' });
  writeJson(paths.quote, {
    apiKey: 'existing-quote-5005',
    deviceId: 'existing-device-6006',
    taskKey: 'canvas-target-1001',
    apiUrl: 'https://quote.example',
  });
  const io = scriptedIo({ confirms: [true, true, true, false] });
  const { api, calls } = fakeApi();

  const result = await runSetup(setupOptions(paths, io, api));

  assert.equal(io.secretCalls, 0);
  assert.equal(calls.pushes, 1);
  assert.equal(result.scheduled, false);
  assert.equal(readJson(paths.vibe).apiUrl, 'https://vibe.example');
  assert.equal(readJson(paths.quote).apiUrl, 'https://quote.example');
});

test('setup 复用省略 API URL 的现有配置时补齐默认值', async (t) => {
  const paths = temporaryPaths(t);
  writeJson(paths.vibe, { apiKey: 'existing-vibe-default-4141' });
  writeJson(paths.quote, {
    apiKey: 'existing-quote-default-4242',
    deviceId: 'existing-device-default-4343',
  });
  const io = scriptedIo({ confirms: [true, true, true, false] });
  const { api } = fakeApi();

  await runSetup(setupOptions(paths, io, api));

  assert.equal(readJson(paths.vibe).apiUrl, 'https://vibecafe.ai');
  assert.equal(readJson(paths.quote).apiUrl, 'https://dot.mindreset.tech');
});

test('setup 拒绝覆盖现有配置时保持文件原样', async (t) => {
  const paths = temporaryPaths(t);
  const originalVibe = '{"apiKey":"existing-vibe-7007"}\n';
  const originalQuote = '{"apiKey":"existing-quote-8008","deviceId":"device-9009"}\n';
  mkdirSync(join(paths.vibe, '..'), { recursive: true });
  mkdirSync(join(paths.quote, '..'), { recursive: true });
  writeFileSync(paths.vibe, originalVibe);
  writeFileSync(paths.quote, originalQuote);
  const io = scriptedIo({ confirms: [false, false] });
  const { api } = fakeApi();

  await assert.rejects(runSetup(setupOptions(paths, io, api)), /拒绝替换.*未修改/);
  assert.equal(readFileSync(paths.vibe, 'utf8'), originalVibe);
  assert.equal(readFileSync(paths.quote, 'utf8'), originalQuote);
});

test('setup 遇到 401 时非零失败、配置不变化且错误脱敏', async (t) => {
  const paths = temporaryPaths(t);
  const secret = 'fixture-vibe-secret-4010';
  const io = scriptedIo({
    secrets: [secret, 'fixture-quote-secret-4011', 'fixture-device-4012'],
    confirms: [],
  });
  const { api } = fakeApi({ usageError: new Error(`Vibe 返回 HTTP 401 ${secret}`) });

  let failure;
  try {
    await runSetup(setupOptions(paths, io, api));
  } catch (error) {
    failure = error;
  }

  assert.ok(failure);
  assert.match(failure.message, /HTTP 401/);
  assert.doesNotMatch(failure.message, new RegExp(secret));
  assert.equal(nodeFs.existsSync(paths.vibe), false);
  assert.equal(nodeFs.existsSync(paths.quote), false);
  assert.doesNotMatch(io.output.join('\n'), new RegExp(secret));
});

test('setup 无 Canvas 时提示去 Dot. App 添加且不落盘', async (t) => {
  const paths = temporaryPaths(t);
  const io = scriptedIo({
    secrets: ['fixture-vibe-1010', 'fixture-quote-1111', 'fixture-device-1212'],
  });
  const { api } = fakeApi({ tasks: [{ taskKey: 'text-only-1313', type: 'TEXT_API' }] });

  await assert.rejects(runSetup(setupOptions(paths, io, api)), /Dot\. App.*画板 API/);
  assert.equal(nodeFs.existsSync(paths.vibe), false);
  assert.equal(nodeFs.existsSync(paths.quote), false);
});

test('setup 多个 Canvas 只显示安全标签并保存编号对应的精确 taskKey', async (t) => {
  const paths = temporaryPaths(t);
  const device = 'fixture-private-device-1414';
  const selected = 'canvas-private-beta-1616';
  const io = scriptedIo({
    secrets: ['fixture-vibe-1414', 'fixture-quote-1515', device],
    selections: [selected],
    confirms: [true, false],
  });
  const { api } = fakeApi({
    tasks: [
      { taskKey: 'canvas-private-alpha-1515', type: 'CANVAS_API' },
      { taskKey: selected, type: 'CANVAS_API' },
    ],
  });

  await runSetup(setupOptions(paths, io, api));

  assert.equal(readJson(paths.quote).taskKey, selected);
  const visible = io.output.join('\n');
  assert.doesNotMatch(visible, /canvas-private-alpha-1515|canvas-private-beta-1616/);
  assert.doesNotMatch(visible, new RegExp(device));
  assert.match(visible, /\*\*\*1515|\*\*\*1616/);
});

test('setup Ctrl+C 取消时不创建半份配置', async (t) => {
  const paths = temporaryPaths(t);
  const io = scriptedIo({ secrets: [new SetupCancelledError()] });
  const { api } = fakeApi();

  await assert.rejects(runSetup(setupOptions(paths, io, api)), SetupCancelledError);
  assert.equal(nodeFs.existsSync(paths.vibe), false);
  assert.equal(nodeFs.existsSync(paths.quote), false);
});

test('真实终端适配器的秘密输入不回显', async () => {
  const input = new PassThrough();
  input.isTTY = true;
  let visible = '';
  const output = new Writable({
    write(chunk, encoding, callback) {
      visible += chunk.toString();
      callback();
    },
  });
  output.isTTY = true;
  const io = createTerminalIo({ stdin: input, stdout: output });
  const answer = io.secret('隐藏输入：');
  input.write('terminal-secret-value\n');

  assert.equal(await answer, 'terminal-secret-value');
  assert.match(visible, /隐藏输入/);
  assert.doesNotMatch(visible, /terminal-secret-value/);
});

test('真实终端适配器收到 Ctrl+C 时抛出取消错误', async () => {
  const input = new PassThrough();
  input.isTTY = true;
  const output = new Writable({ write(chunk, encoding, callback) { callback(); } });
  output.isTTY = true;
  const io = createTerminalIo({ stdin: input, stdout: output });
  const answer = io.secret('隐藏输入：');
  input.write('\u0003');

  await assert.rejects(answer, SetupCancelledError);
});

test('setup 非 TTY 环境明确失败且不读取秘密', async (t) => {
  const paths = temporaryPaths(t);
  const io = scriptedIo({ isTTY: false });
  const { api } = fakeApi();

  await assert.rejects(runSetup(setupOptions(paths, io, api)), /非 TTY/);
  assert.equal(io.secretCalls, 0);
});

test('两文件事务第二次替换失败时恢复两份旧内容', (t) => {
  const paths = temporaryPaths(t);
  const oldVibe = '{"apiKey":"old-vibe-1717"}\n';
  const oldQuote = '{"apiKey":"old-quote-1818","deviceId":"old-device-1919"}\n';
  mkdirSync(join(paths.vibe, '..'), { recursive: true });
  mkdirSync(join(paths.quote, '..'), { recursive: true });
  writeFileSync(paths.vibe, oldVibe, { mode: 0o600 });
  writeFileSync(paths.quote, oldQuote, { mode: 0o600 });
  const failingFs = {
    ...nodeFs,
    renameSync(source, destination) {
      if (destination === paths.quote && source.endsWith('.tmp')) {
        throw new Error('simulated rename failure');
      }
      nodeFs.renameSync(source, destination);
    },
  };

  assert.throws(() => writeConfigsAtomically([
    { path: paths.vibe, value: { apiKey: 'new-vibe-2020' } },
    { path: paths.quote, value: { apiKey: 'new-quote-2121', deviceId: 'new-device-2222' } },
  ], { fileSystem: failingFs, platform: 'linux' }), /simulated rename failure.*原配置已保留/);

  assert.equal(readFileSync(paths.vibe, 'utf8'), oldVibe);
  assert.equal(readFileSync(paths.quote, 'utf8'), oldQuote);
});

test('Windows 第二份 ACL 设置失败时清理所有临时文件', (t) => {
  const paths = temporaryPaths(t);
  let aclCalls = 0;

  assert.throws(() => writeConfigsAtomically([
    { path: paths.vibe, value: { apiKey: 'new-vibe-3838' } },
    { path: paths.quote, value: { apiKey: 'new-quote-3939', deviceId: 'new-device-4040' } },
  ], {
    platform: 'win32',
    protectFile() {
      aclCalls += 1;
      if (aclCalls === 2) throw new Error('simulated ACL failure');
    },
  }), /原配置已保留/);

  assert.equal(nodeFs.existsSync(paths.vibe), false);
  assert.equal(nodeFs.existsSync(paths.quote), false);
  assert.deepEqual(readdirSync(join(paths.vibe, '..')), []);
  assert.deepEqual(readdirSync(join(paths.quote, '..')), []);
});

test('Windows ACL 子进程失败时保留 PowerShell 错误细节', () => {
  assert.throws(() => protectWindowsConfig('C:\\config.json', {
    spawnSyncImpl() {
      return { status: 1, stdout: '', stderr: 'Set-Acl access denied' };
    },
  }), /Set-Acl access denied.*配置未替换/);
});

test('Windows PowerShell 5.1 子进程不继承 PowerShell 7 模块路径', () => {
  let childOptions;
  protectWindowsConfig('C:\\config.json', {
    processEnv: { PATH: 'C:\\Windows', PSModulePath: 'C:\\Program Files\\PowerShell\\Modules' },
    spawnSyncImpl(command, args, options) {
      childOptions = options;
      return { status: 0, stdout: '', stderr: '' };
    },
  });

  assert.equal(childOptions.env.PSModulePath, undefined);
  assert.equal(childOptions.env.PATH, 'C:\\Windows');
});

test('Windows Vibe 路径与两份配置 ACL 调用合同', async (t) => {
  assert.equal(
    vibeConfigPath({ USERPROFILE: 'C:\\Users\\alice' }, { platform: 'win32' }),
    win32.join('C:\\Users\\alice', '.vibe-usage', 'config.json'),
  );
  const paths = temporaryPaths(t);
  const io = scriptedIo({
    secrets: ['fixture-vibe-2323', 'fixture-quote-2424', 'fixture-device-2525'],
    confirms: [true, false],
  });
  const { api } = fakeApi();
  const aclPaths = [];

  await runSetup(setupOptions(paths, io, api, {
    protectFile(path) { aclPaths.push(path); },
  }));

  assert.equal(aclPaths.length, 2);
  assert.ok(aclPaths.some((path) => path.startsWith(paths.vibe)));
  assert.ok(aclPaths.some((path) => path.startsWith(paths.quote)));
  const setupScript = readFileSync(join(import.meta.dirname, '..', 'windows', 'setup.ps1'), 'utf8');
  const commonScript = readFileSync(join(import.meta.dirname, '..', 'windows', 'common.ps1'), 'utf8');
  assert.match(setupScript, /Protect-PrivateConfigAcl -Path \$Path/);
  assert.match(setupScript, /Assert-PrivateConfigAcl -Path \$Path/);
  assert.match(commonScript, /SetAccessRuleProtection\(\$true, \$false\)/);
  assert.match(commonScript, /WindowsIdentity\]::GetCurrent\(\)/);
  assert.doesNotMatch(`${setupScript}\n${commonScript}`, /apiKey|deviceId/i);
});

test('设备休眠时保留已验证配置但不 push、不安装、不误报完成', async (t) => {
  const paths = temporaryPaths(t);
  const io = scriptedIo({
    secrets: ['fixture-vibe-2626', 'fixture-quote-2727', 'fixture-device-2828'],
    confirms: [true],
  });
  const { api, calls } = fakeApi({ statusError: new DeviceUnavailableError('Quote 设备休眠中') });
  let installs = 0;

  await assert.rejects(runSetup(setupOptions(paths, io, api, {
    installScheduledTask() { installs += 1; },
  })), /有效配置已保留/);

  assert.equal(nodeFs.existsSync(paths.vibe), true);
  assert.equal(nodeFs.existsSync(paths.quote), true);
  assert.equal(calls.pushes, 0);
  assert.equal(installs, 0);
  assert.doesNotMatch(io.output.join('\n'), /配置完成/);
});

test('push 未确认渲染变化时保留配置但不安装任务', async (t) => {
  const paths = temporaryPaths(t);
  const io = scriptedIo({
    secrets: ['fixture-vibe-2929', 'fixture-quote-3030', 'fixture-device-3131'],
    confirms: [true],
  });
  const { api } = fakeApi({ changed: false });
  let installs = 0;

  await assert.rejects(runSetup(setupOptions(paths, io, api, {
    installScheduledTask() { installs += 1; },
  })), /未确认渲染变化/);

  assert.equal(installs, 0);
  assert.equal(nodeFs.existsSync(paths.quote), true);
  assert.doesNotMatch(io.output.join('\n'), /配置完成/);
});

test('计划任务安装失败时保留有效配置并给出 setup 重跑命令', async (t) => {
  const paths = temporaryPaths(t);
  const io = scriptedIo({
    secrets: ['fixture-vibe-3232', 'fixture-quote-3333', 'fixture-device-3434'],
    confirms: [true, true],
  });
  const { api } = fakeApi();

  await assert.rejects(runSetup(setupOptions(paths, io, api, {
    installScheduledTask() { throw new Error('simulated scheduler failure'); },
  })), (error) => {
    assert.equal(error.stage, '计划任务安装');
    assert.match(error.nextCommand, /重新运行 vibe-usage-quote0 setup/);
    return true;
  });

  assert.equal(nodeFs.existsSync(paths.vibe), true);
  assert.equal(nodeFs.existsSync(paths.quote), true);
  assert.doesNotMatch(io.output.join('\n'), /配置完成/);
});

test('真实 push 后 Ctrl+C 会保留配置并明确计划任务未安装', async (t) => {
  const paths = temporaryPaths(t);
  const io = scriptedIo({
    secrets: ['fixture-vibe-3535', 'fixture-quote-3636', 'fixture-device-3737'],
    confirms: [true, new SetupCancelledError()],
  });
  const { api, calls } = fakeApi();

  await assert.rejects(runSetup(setupOptions(paths, io, api)), (error) => {
    assert.ok(error instanceof SetupCancelledError);
    assert.match(error.message, /有效配置.*push 已保留.*计划任务未安装/);
    return true;
  });

  assert.equal(calls.pushes, 1);
  assert.equal(nodeFs.existsSync(paths.vibe), true);
  assert.equal(nodeFs.existsSync(paths.quote), true);
  assert.doesNotMatch(io.output.join('\n'), /配置完成/);
});
