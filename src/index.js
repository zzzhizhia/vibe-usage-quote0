#!/usr/bin/env node
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregateUsage } from './aggregate.js';
import { buildCanvasPayload, validateCanvasPayload } from './canvas.js';
import { dataDirectory, loadQuoteConfig, loadVibeConfig } from './config.js';
import { formatRequestLog, maskIdentifier } from './http.js';
import { configureInterval } from './interval.js';
import { inspectPng } from './png.js';
import { getCanvasStatus, listDeviceTasks, pushCanvasAndWait, selectCanvasTask } from './quote.js';
import { runSetup } from './setup.js';
import { fetchUsage } from './vibe.js';

const HELP = `vibe-usage-quote0

用法：
  vibe-usage-quote0 setup    交互式安全配置、真实推送并安装 Windows 定时刷新
  vibe-usage-quote0 doctor   检查 Vibe 与 Quote/0 前提
  vibe-usage-quote0 dry-run  获取 Vibe 用量并输出脱敏摘要
  vibe-usage-quote0 push     推送画板并等待渲染状态变化
  vibe-usage-quote0 interval <minutes>  配置推送刷新间隔（默认 30 分钟）
`;

function defaultLogger(event) {
  process.stderr.write(`${formatRequestLog(event)}\n`);
}

async function collectUsage(vibe, options) {
  const [todayResponse, weekResponse] = await Promise.all([
    fetchUsage({ ...vibe, days: 1, fetchImpl: options.fetchImpl, logger: options.logger, retryOptions: options.retryOptions }),
    fetchUsage({ ...vibe, days: 7, fetchImpl: options.fetchImpl, logger: options.logger, retryOptions: options.retryOptions }),
  ]);
  return aggregateUsage(todayResponse, weekResponse);
}

function dryRunSummary(summary, payload, payloadInfo) {
  return {
    today: {
      tokens: summary.today.totalTokens,
      cost: Number(summary.today.estimatedCost.toFixed(6)),
      sessions: summary.today.sessionCount,
      activeSeconds: summary.today.activeSeconds,
    },
    last7Days: {
      tokens: summary.week.totalTokens,
      cost: Number(summary.week.estimatedCost.toFixed(6)),
    },
    topTools: summary.week.topTools,
    topModels: summary.week.topModels,
    payload: {
      taskAlias: payload.taskAlias,
      refreshNow: payload.refreshNow,
      border: payload.border,
      bytes: payloadInfo.bytes,
      elementTypes: payloadInfo.elementTypes,
      containsProject: false,
      containsSecrets: false,
    },
  };
}

async function downloadRender(url, options) {
  if (!/^https?:\/\//i.test(url)) throw new Error('渲染图 URL 非 http(s)');
  options.logger({ phase: 'request', stage: 'Quote 渲染图下载', attempt: 1, identifier: maskIdentifier('render') });
  const response = await (options.fetchImpl ?? globalThis.fetch)(url, { signal: AbortSignal.timeout(15_000) });
  options.logger({ phase: 'status', stage: 'Quote 渲染图下载', status: response.status, identifier: maskIdentifier('render') });
  if (!response.ok) throw new Error(`Quote 渲染图下载返回 HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const inspection = inspectPng(buffer);
  mkdirSync(options.dataDirectory, { recursive: true });
  const path = join(options.dataDirectory, 'quote0-render.png');
  writeFileSync(path, buffer, { mode: 0o600 });
  return { path, inspection };
}

export async function runCli(argv = process.argv.slice(2), options = {}) {
  const command = argv[0] ?? 'help';
  const env = options.env ?? process.env;
  const stdout = options.stdout ?? ((line) => process.stdout.write(`${line}\n`));
  const logger = options.logger ?? defaultLogger;
  if (command === 'help' || command === '--help' || command === '-h') {
    stdout(HELP.trimEnd());
    return { command: 'help' };
  }
  if (command === 'setup') {
    if (argv.length !== 1) throw new Error('setup 不接受命令行参数；凭据只能在交互式隐藏输入中提供');
    let setupOptions = {
      env,
      logger,
      fetchImpl: options.fetchImpl,
      retryOptions: options.retryOptions,
      ...(options.setupOptions ?? {}),
    };
    if (env.NODE_ENV === 'test' && env.VIBE_USAGE_QUOTE0_SETUP_FIXTURE) {
      const { createSetupFixtureOptions } = await import('./setup/fixture.js');
      setupOptions = createSetupFixtureOptions(env, setupOptions);
    }
    const setupRunner = options.setupRunner ?? runSetup;
    return setupRunner(setupOptions);
  }
  if (command === 'interval') {
    if (argv.length !== 2) throw new Error('用法：vibe-usage-quote0 interval <minutes>');
    const configure = options.intervalRunner ?? configureInterval;
    const result = await configure(argv[1], {
      env,
      platform: options.platform,
      home: options.home,
      fileSystem: options.fileSystem,
      protectFile: options.protectFile,
      spawnSyncImpl: options.spawnSyncImpl,
      scheduleUpdater: options.scheduleUpdater,
      plistPath: options.plistPath,
      uid: options.uid,
    });
    stdout(`推送刷新间隔已设置为 ${result.intervalMinutes} 分钟。`);
    if (result.schedule?.updated) {
      stdout('已同步更新当前平台的已安装调度任务。');
    } else if (result.schedule?.unsupported) {
      stdout('当前平台没有内置调度器；配置将在支持的安装流程中生效。');
    } else {
      stdout('未检测到已安装调度任务；配置将在后续安装时生效。');
    }
    return { command, ...result };
  }
  if (!['doctor', 'dry-run', 'push'].includes(command)) {
    throw new Error(`未知命令：${command}`);
  }

  const runtime = {
    env,
    stdout,
    logger,
    fetchImpl: options.fetchImpl,
    retryOptions: options.retryOptions,
    cwd: options.cwd ?? process.cwd(),
    dataDirectory: options.dataDirectory ?? dataDirectory(env),
  };

  const vibe = loadVibeConfig(env);
  const summary = await collectUsage(vibe, runtime);

  if (command === 'dry-run') {
    const payload = buildCanvasPayload(summary, options.now ?? new Date());
    const payloadInfo = validateCanvasPayload(payload, [vibe.apiKey]);
    stdout(JSON.stringify(dryRunSummary(summary, payload, payloadInfo), null, 2));
    return { command, summary, payload };
  }

  const quote = loadQuoteConfig(env);
  if (command === 'doctor') {
    const tasks = await listDeviceTasks(quote, runtime);
    const task = selectCanvasTask(tasks.data, quote.taskKey);
    await getCanvasStatus(quote, runtime);
    stdout('Vibe 1 日与 7 日用量响应校验通过。');
    stdout(`Quote CANVAS_API 已找到：${maskIdentifier(task.taskKey ?? task.key ?? task.id)}`);
    stdout('Quote 设备状态与 renderInfo 响应校验通过。');
    return { command, summary, task };
  }

  const payload = buildCanvasPayload(summary, options.now ?? new Date());
  validateCanvasPayload(payload, [vibe.apiKey, quote.apiKey]);
  const result = await pushCanvasAndWait(quote, payload, {
    ...runtime,
    timeoutMs: options.timeoutMs,
    pollIntervalMs: options.pollIntervalMs,
    delay: options.delay,
  });
  stdout(`Canvas POST HTTP ${result.postStatus}；渲染状态已变化。`);
  let render = null;
  if (result.renderImageUrl) {
    render = await downloadRender(result.renderImageUrl, runtime);
    stdout(`渲染图已保存：${render.path}`);
    stdout(`渲染图检查：${render.inspection.width}×${render.inspection.height}，黑白=${render.inspection.blackAndWhite}`);
    stdout(`画面墨点：覆盖=${(render.inspection.inkCoverage * 100).toFixed(1)}%，边缘=${render.inspection.edgeInkPixels}`);
  } else {
    stdout('API 已确认，视觉未确认：状态未返回渲染图 URL。');
  }
  return { command, summary, payload, result, render };
}

const currentFile = fileURLToPath(import.meta.url);
const isDirectRun =
  process.argv[1] != null &&
  resolve(realpathSync(process.argv[1])) === currentFile;

if (isDirectRun) {
  runCli().catch((error) => {
    process.stderr.write(`失败：${error?.message || String(error)}\n`);
    process.exitCode = 1;
  });
}
