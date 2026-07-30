import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateUsage,
  aggregateWindow,
  formatActiveTime,
  formatCost,
  formatCount,
  formatTokens,
  truncateText,
} from '../src/aggregate.js';
import { buildCanvasPayload, validateCanvasPayload } from '../src/canvas.js';
import { emptyUsage, todayUsage, weekUsage } from './fixtures/usage.js';

test('精确聚合今日与近 7 日六项总览', () => {
  const summary = aggregateUsage(todayUsage, weekUsage);
  assert.deepEqual(
    {
      todayTokens: summary.today.totalTokens,
      todayCost: summary.today.estimatedCost,
      todaySessions: summary.today.sessionCount,
      todayActiveSeconds: summary.today.activeSeconds,
      weekTokens: summary.week.totalTokens,
      weekCost: summary.week.estimatedCost,
    },
    {
      todayTokens: 13_000,
      todayCost: 0.35,
      todaySessions: 2,
      todayActiveSeconds: 2_700,
      weekTokens: 51_000,
      weekCost: 3.01,
    },
  );
});

test('Top 3 工具按 Token 降序且同工具合并', () => {
  const summary = aggregateUsage(todayUsage, weekUsage);
  assert.deepEqual(summary.week.topTools, [
    { name: 'Copilot', tokens: 23_000 },
    { name: 'Claude Code', tokens: 11_000 },
    { name: 'Cursor', tokens: 9_000 },
  ]);
});

test('Top 3 模型按 Token 降序且同模型合并', () => {
  const summary = aggregateUsage(todayUsage, weekUsage);
  assert.deepEqual(summary.week.topModels, [
    { name: 'gpt', tokens: 23_000 },
    { name: 'sonnet', tokens: 14_000 },
    { name: 'deepseek', tokens: 7_000 },
  ]);
});

test('空数据生成明确的暂无数据画面', () => {
  const summary = aggregateUsage(emptyUsage, emptyUsage);
  const payload = buildCanvasPayload(summary, new Date('2026-07-28T04:00:00Z'));
  assert.equal(summary.today.hasAnyData, false);
  assert.equal(summary.week.hasAnyData, false);
  assert.equal(payload.data.todayTokens, '暂无数据');
  assert.equal(payload.data.weekTokens, '暂无数据');
  assert.equal(payload.data.primaryUsage, '暂无使用记录');
});

test('畸形数值不会产生 NaN、负数或 Infinity', () => {
  const malformed = {
    buckets: [
      { source: 'X', model: 'A', totalTokens: NaN, cachedInputTokens: Infinity, estimatedCost: Infinity },
      { source: 'Y', model: 'B', totalTokens: -9, cachedInputTokens: -5, estimatedCost: -3 },
      null,
    ],
    sessions: [{ activeSeconds: -1 }, { activeSeconds: 'not-a-number' }, null],
  };
  const aggregate = aggregateWindow(malformed);
  const serialized = JSON.stringify(aggregate);
  assert.equal(aggregate.totalTokens, 0);
  assert.equal(aggregate.estimatedCost, 0);
  assert.equal(aggregate.activeSeconds, 0);
  assert.equal(aggregate.sessionCount, 2);
  assert.doesNotMatch(serialized, /NaN|Infinity/);
});

test('总 Token 与缓存 Token 的极端累加保持有限', () => {
  const aggregate = aggregateWindow({
    buckets: [
      {
        source: 'X',
        model: 'A',
        totalTokens: Number.MAX_VALUE,
        cachedInputTokens: Number.MAX_VALUE,
        estimatedCost: 0,
      },
    ],
    sessions: [],
  });
  assert.equal(aggregate.totalTokens, Number.MAX_VALUE);
  assert.equal(Number.isFinite(aggregate.totalTokens), true);
});

test('Canvas 合同固定且只含白名单元素', () => {
  const summary = aggregateUsage(todayUsage, weekUsage);
  const payload = buildCanvasPayload(summary, new Date('2026-07-28T04:00:00Z'));
  const info = validateCanvasPayload(payload, ['vibe-test-secret', 'quote-test-secret']);
  assert.equal(payload.taskAlias, 'Vibe Usage');
  assert.equal(payload.refreshNow, true);
  assert.equal(payload.border, 0);
  assert.deepEqual(info.elementTypes, ['div', 'span']);
  assert.doesNotMatch(JSON.stringify(payload), /private-alpha|private-beta|project/i);
  assert.doesNotMatch(payload.windowData.default[0].props.tw, /(^|\s)p(?:x|y)?-/);
  assert.equal(payload.windowData.default[0].props.style?.padding, undefined);
  assert.equal('tool1' in payload.data, false);
  assert.equal('model1' in payload.data, false);
  assert.ok(info.bytes < 4_000);
  const serialized = JSON.stringify(payload.windowData);
  assert.match(serialized, /VIBE USAGE/);
  assert.match(serialized, /主力/);
  assert.doesNotMatch(serialized, /bg-black text-white/);
  assert.doesNotMatch(serialized, /今日 TOKEN/);
});

test('精简画面只保留一个主力工具与模型', () => {
  const payload = buildCanvasPayload(aggregateUsage(todayUsage, weekUsage), new Date('2026-07-28T04:00:00Z'));
  assert.equal(payload.data.primaryUsage, 'Copilot · gpt');
  assert.equal(Object.keys(payload.data).filter((key) => /^tool|^model/.test(key)).length, 0);
});

test('主力工具与模型使用平衡宽度预算且两者都可见', () => {
  const summary = aggregateUsage(todayUsage, weekUsage);
  summary.week.topTools[0].name = '超长工具名称超长工具名称超长工具名称';
  summary.week.topModels[0].name = '超长模型名称超长模型名称超长模型名称';
  const payload = buildCanvasPayload(summary, new Date('2026-07-28T04:00:00Z'));
  assert.match(payload.data.primaryUsage, /工具/);
  assert.match(payload.data.primaryUsage, /模型/);
  assert.match(payload.data.primaryUsage, /… · .*…/);
  assert.ok([...payload.data.primaryUsage].length <= 24);
});

test('Token 按中文单位显示且至多保留四位有效数字', () => {
  assert.deepEqual(
    [
      0,
      9_999,
      12_345,
      123_456,
      1_234_567,
      12_345_678,
      99_999_999,
      123_456_789,
      999_999_999_999,
      1_234_567_890_123,
    ].map(formatTokens),
    ['0', '9,999', '1.235万', '12.35万', '123.5万', '1235万', '1亿', '1.235亿', '1万亿', '1.235万亿'],
  );
});

test('今日与近 7 日 Token 共用四位有效数字格式', () => {
  const summary = aggregateUsage(todayUsage, weekUsage);
  summary.today.totalTokens = 12_345;
  summary.week.totalTokens = 1_234_567;
  const payload = buildCanvasPayload(summary, new Date('2026-07-28T04:00:00Z'));
  assert.equal(payload.data.todayTokens, '1.235万');
  assert.equal(payload.data.weekTokens, '123.5万');
});

test('极端有限数值使用有界格式而不是指数或无穷文本', () => {
  assert.equal(formatTokens(Number.MAX_VALUE), '9999万亿+');
  assert.equal(formatCost(Number.MAX_VALUE), '$9999亿+');
  assert.equal(formatCount(Number.MAX_VALUE), '9999万+');
  assert.equal(formatActiveTime(Number.MAX_VALUE), '100年+');
  const serialized = [
    formatTokens(Number.MAX_VALUE),
    formatCost(Number.MAX_VALUE),
    formatCount(Number.MAX_VALUE),
    formatActiveTime(Number.MAX_VALUE),
  ].join(' ');
  assert.doesNotMatch(serialized, /e[+-]|NaN|Infinity/i);
});

test('长文本被稳定截断', () => {
  const long = '一个非常非常非常非常非常非常非常非常长的工具名称';
  const result = truncateText(long, 12);
  assert.equal(result.length, 12);
  assert.ok(result.endsWith('…'));
});

test('Canvas 更新时间固定使用 Asia/Shanghai', () => {
  const payload = buildCanvasPayload(aggregateUsage(todayUsage, weekUsage), new Date('2026-07-28T04:34:00Z'));
  assert.match(payload.data.updatedAt, /07-28 12:34/);
});

test('Canvas 最小字号为 10px 且不声明真机无效分隔线', () => {
  const payload = buildCanvasPayload(aggregateUsage(todayUsage, weekUsage), new Date('2026-07-28T04:00:00Z'));
  const serialized = JSON.stringify(payload.windowData);
  assert.doesNotMatch(serialized, /text-9-chillduansans/);
  assert.doesNotMatch(serialized, /borderTopWidth|borderTopStyle/);
  assert.match(serialized, /letterSpacing/);
});
