#!/usr/bin/env node
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCanvasPayload, validateCanvasPayload } from './canvas.js';
import {
  dataDirectory,
  loadDisplaySettings,
  loadQuoteConfig,
  loadVibeConfig,
} from './config.js';
import { configureDisplay } from './display-config.js';
import { formatRequestLog, maskIdentifier } from './http.js';
import { configureInterval, disableSchedule } from './interval.js';
import { inspectPng } from './png.js';
import { getCanvasStatus, listDeviceTasks, pushCanvasAndWait, selectCanvasTask } from './quote.js';
import { runSetup } from './setup.js';
import { updateSelf } from './update.js';
import { collectDisplayUsage } from './usage.js';

const HELP = `vibe-usage-quote0 / vuq

用法：
  vibe-usage-quote0 enable   交互式安全配置、真实推送并安装当前平台定时刷新
  vibe-usage-quote0 disable  解除本工具的定时刷新任务（保留配置与数据）
  vibe-usage-quote0 update   通过 npm 更新至最新版
  vibe-usage-quote0 doctor   检查 Vibe 与 Quote/0 前提
  vibe-usage-quote0 dry-run  获取 Vibe 用量并输出脱敏摘要
  vibe-usage-quote0 push     推送画板并等待渲染状态变化
  vibe-usage-quote0 interval <minutes>  配置推送刷新间隔（默认 30 分钟）
  vibe-usage-quote0 display <main|secondary> <today|24h|Nd|yyyyMMdd-yyyyMMdd>
                             配置主要或次要数据的显示档位

以上命令均可将 vibe-usage-quote0 简写为 vuq。
`;

function defaultLogger(event) {
  process.stderr.write(`${formatRequestLog(event)}\n`);
}

function dryRunSummary(summary, payload, payloadInfo) {
  return {
    main: {
      range: summary.ranges.main.value,
      description: summary.ranges.main.description,
      tokens: summary.main.totalTokens,
      cost: Number(summary.main.estimatedCost.toFixed(6)),
      sessions: summary.main.sessionCount,
      activeSeconds: summary.main.activeSeconds,
      topTools: summary.main.topTools,
      topModels: summary.main.topModels,
    },
    secondary: {
      range: summary.ranges.secondary.value,
      description: summary.ranges.secondary.description,
      tokens: summary.secondary.totalTokens,
      cost: Number(summary.secondary.estimatedCost.toFixed(6)),
    },
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
  if (command === 'enable') {
    if (argv.length !== 1) throw new Error('enable 不接受命令行参数；凭据只能在交互式隐藏输入中提供');
    let enableOptions = {
      env,
      platform: options.platform,
      home: options.home,
      logger,
      fetchImpl: options.fetchImpl,
      retryOptions: options.retryOptions,
      ...(options.enableOptions ?? {}),
    };
    if (env.NODE_ENV === 'test' && env.VIBE_USAGE_QUOTE0_SETUP_FIXTURE) {
      const { createSetupFixtureOptions } = await import('./setup/fixture.js');
      enableOptions = createSetupFixtureOptions(env, enableOptions);
    }
    const enableRunner = options.enableRunner ?? runSetup;
    return enableRunner(enableOptions);
  }
  if (command === 'disable') {
    if (argv.length !== 1) throw new Error('用法：vibe-usage-quote0 disable');
    const disable = options.disableRunner ?? disableSchedule;
    const result = await disable({
      env,
      platform: options.platform,
      home: options.home,
      spawnSyncImpl: options.spawnSyncImpl,
      windowsScriptPath: options.windowsScriptPath,
      plistPath: options.plistPath,
      uid: options.uid,
      existsSyncImpl: options.existsSyncImpl,
      unlinkSyncImpl: options.unlinkSyncImpl,
    });
    if (result.disabled) {
      stdout('已解除本工具的定时刷新任务；配置、日志和渲染图均已保留。');
    } else if (result.unsupported) {
      stdout('当前平台没有本工具内置的定时任务；未修改任何文件。');
    } else {
      stdout('未检测到本工具的定时刷新任务；无需处理。');
    }
    return { command, ...result };
  }
  if (command === 'update') {
    if (argv.length !== 1) throw new Error('用法：vibe-usage-quote0 update');
    stdout('正在通过 npm 更新 vibe-usage-quote0...');
    const updater = options.updateRunner ?? updateSelf;
    const result = await updater({
      env,
      platform: options.platform,
      spawnSyncImpl: options.spawnSyncImpl,
      npmCommand: options.npmCommand,
    });
    stdout('vibe-usage-quote0 已更新至 npm 最新版。');
    return { command, ...result };
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
  if (command === 'display') {
    if (argv.length !== 3) {
      throw new Error('用法：vibe-usage-quote0 display <main|secondary> <today|24h|Nd|yyyyMMdd-yyyyMMdd>');
    }
    const configure = options.displayRunner ?? configureDisplay;
    const result = await configure(argv[1], argv[2], {
      env,
      platform: options.platform,
      home: options.home,
      fileSystem: options.fileSystem,
      protectFile: options.protectFile,
      spawnSyncImpl: options.spawnSyncImpl,
      aclScriptPath: options.aclScriptPath,
    });
    const targetLabel = result.target === 'main' ? '主要数据' : '次要数据';
    stdout(`${targetLabel}显示档位已设置为：${result.range.description}。`);
    stdout('将在下次 push 或定时刷新时生效。');
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

  const now = options.now ?? new Date();
  const vibe = loadVibeConfig(env, { platform: options.platform, home: options.home });
  let quote = null;
  let display;
  if (command === 'dry-run') {
    display = loadDisplaySettings(env, { platform: options.platform, home: options.home }).display;
  } else {
    quote = loadQuoteConfig(env, { platform: options.platform, home: options.home });
    display = quote.display;
  }
  const summary = await collectDisplayUsage(vibe, display, {
    ...runtime,
    now,
    timeZone: options.timeZone,
    fetchUsageImpl: options.fetchUsageImpl,
  });

  if (command === 'dry-run') {
    const payload = buildCanvasPayload(summary, now);
    const payloadInfo = validateCanvasPayload(payload, [vibe.apiKey]);
    stdout(JSON.stringify(dryRunSummary(summary, payload, payloadInfo), null, 2));
    return { command, summary, payload };
  }

  if (command === 'doctor') {
    const tasks = await listDeviceTasks(quote, runtime);
    const task = selectCanvasTask(tasks.data, quote.taskKey);
    await getCanvasStatus(quote, runtime);
    stdout(`Vibe ${summary.ranges.main.description}与${summary.ranges.secondary.description}用量响应校验通过。`);
    stdout(`Quote CANVAS_API 已找到：${maskIdentifier(task.taskKey ?? task.key ?? task.id)}`);
    stdout('Quote 设备状态与 renderInfo 响应校验通过。');
    return { command, summary, task };
  }

  const payload = buildCanvasPayload(summary, now);
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
