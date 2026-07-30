import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { todayUsage, weekUsage } from './fixtures/usage.js';

const projectRoot = resolve(import.meta.dirname, '..');

function listen(server) {
  return new Promise((resolveAddress) => server.listen(0, '127.0.0.1', () => resolveAddress(server.address())));
}

function close(server) {
  return new Promise((resolveClose, reject) => server.close((error) => (error ? reject(error) : resolveClose())));
}

function runChild(baseUrl, command = 'push') {
  return new Promise((resolveChild) => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'vibe-quote0-test-'));
    const child = spawn(process.execPath, ['src/index.js', command], {
      cwd: projectRoot,
      env: {
        ...process.env,
        HOME: fakeHome,
        VIBE_USAGE_API_KEY: 'vibe-test-key',
        VIBE_USAGE_API_URL: baseUrl,
        QUOTE0_API_KEY: 'quote-test-key',
        QUOTE0_DEVICE_ID: 'DEVICE-1234',
        QUOTE0_API_URL: baseUrl,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolveChild({ code, stdout, stderr }));
  });
}

async function failureScenario(kind) {
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url.startsWith('/api/usage')) {
      response.end(JSON.stringify(request.url.includes('days=1') ? todayUsage : weekUsage));
      return;
    }
    if (request.url.endsWith('/loop/list')) {
      if (kind === '401') {
        response.statusCode = 401;
        response.end(JSON.stringify({ message: 'unauthorized' }));
      } else if (kind === 'missing-canvas') {
        response.end(JSON.stringify({ tasks: [{ taskKey: 'text-1', type: 'TEXT_API' }] }));
      } else {
        response.end(JSON.stringify({ tasks: [{ taskKey: 'canvas-1', type: 'CANVAS_API', renderInfo: { last: 'old' } }] }));
      }
      return;
    }
    if (request.url.endsWith('/status')) {
      response.end(JSON.stringify({
        status: { current: 'Power Active', description: 'The device is power active and ready to use' },
        renderInfo: { last: 'old', current: { image: null } },
      }));
      return;
    }
    if (request.url.endsWith('/canvas') && kind === '500') {
      response.statusCode = 500;
      response.end(JSON.stringify({ message: 'server error' }));
      return;
    }
    response.statusCode = 500;
    response.end('{}');
  });
  const address = await listen(server);
  try {
    return await runChild(`http://127.0.0.1:${address.port}`);
  } finally {
    await close(server);
  }
}

test('CLI doctor 在设备休眠时非零退出且不误报可用', async () => {
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url.startsWith('/api/usage')) {
      response.end(JSON.stringify(request.url.includes('days=1') ? todayUsage : weekUsage));
      return;
    }
    if (request.url.endsWith('/loop/list')) {
      response.end(JSON.stringify({ tasks: [{ taskKey: 'canvas-1', type: 'CANVAS_API' }] }));
      return;
    }
    if (request.url.endsWith('/status')) {
      response.end(JSON.stringify({
        status: { current: '休眠中', description: '设备休眠中以节省电量' },
        renderInfo: { last: 'old', current: { image: null } },
      }));
      return;
    }
    response.statusCode = 500;
    response.end('{}');
  });
  const address = await listen(server);
  try {
    const result = await runChild(`http://127.0.0.1:${address.port}`, 'doctor');
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /设备休眠/);
    assert.doesNotMatch(result.stdout, /响应校验通过|已找到/);
    assert.doesNotMatch(result.stderr, /vibe-test-key|quote-test-key/);
  } finally {
    await close(server);
  }
});

for (const kind of ['missing-canvas', '401', '500']) {
  test(`CLI push 模拟 ${kind} 时非零退出且不误报成功`, async () => {
    const result = await failureScenario(kind);
    assert.notEqual(result.code, 0);
    assert.doesNotMatch(result.stdout, /渲染状态已变化|成功/);
    assert.doesNotMatch(result.stderr, /vibe-test-key|quote-test-key/);
  });
}

test('Windows 运行器合同保留失败码且不记录子进程输出', () => {
  const runner = readFileSync(join(projectRoot, 'windows', 'run.ps1'), 'utf8');
  const invokeIndex = runner.indexOf('& $resolvedCli $Command');
  const continueIndex = runner.indexOf("$ErrorActionPreference = 'Continue'");
  const restoreIndex = runner.indexOf('$ErrorActionPreference = $previousErrorActionPreference');

  assert.match(runner, /Get-CommandPath/);
  assert.match(runner, /exit \$exitCode/);
  assert.ok(continueIndex >= 0 && continueIndex < invokeIndex);
  assert.ok(restoreIndex > invokeIndex);
  assert.doesNotMatch(runner, /\bnpx\b/i);
  assert.doesNotMatch(runner, /Add-Content[^\n]*(output|stdout|stderr)/i);
});

test('Windows 安装与卸载合同限定当前用户任务', () => {
  const common = readFileSync(join(projectRoot, 'windows', 'common.ps1'), 'utf8');
  const installer = readFileSync(join(projectRoot, 'windows', 'install.ps1'), 'utf8');
  const uninstaller = readFileSync(join(projectRoot, 'windows', 'uninstall.ps1'), 'utf8');

  assert.match(common, /function Assert-PersistentScheduledEnvironment/);
  assert.ok(
    installer.indexOf('Assert-PersistentScheduledEnvironment') < installer.indexOf('& $resolvedCli doctor'),
  );
  assert.ok(installer.indexOf('& $resolvedCli doctor') < installer.indexOf('Register-ScheduledTask'));
  assert.match(installer, /New-TimeSpan -Seconds 1800/);
  assert.match(installer, /-LogonType Interactive/);
  assert.match(installer, /-RunLevel Limited/);
  assert.match(installer, /-NodePath .* -CliPath/);
  assert.doesNotMatch(installer, /\bnpx\b|apiKey|deviceId/i);
  assert.match(uninstaller, /Unregister-ScheduledTask -TaskName \$script:VibeUsageTaskName/);
  assert.doesNotMatch(uninstaller, /Remove-Item|\bnpx\b/i);
});
