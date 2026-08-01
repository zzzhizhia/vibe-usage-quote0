import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildUsageRequest,
  filterUsageResponse,
  normalizeDisplaySettings,
  parseDisplayRange,
  startOfToday,
} from '../src/display.js';
import { collectDisplayUsage } from '../src/usage.js';

test('六类显示档位使用稳定的规范值与画板标签', () => {
  assert.deepEqual(
    ['today', '24H', '7D', '30d', '90D', '14d', '20260701-20260731']
      .map((value) => {
        const range = parseDisplayRange(value);
        return [range.value, range.label];
      }),
    [
      ['today', '今天'],
      ['24h', '24H'],
      ['7d', '近 7 日'],
      ['30d', '近 30 日'],
      ['90d', '近 90 日'],
      ['14d', '近 14 日'],
      ['20260701-20260731', '自定义'],
    ],
  );
  assert.equal(parseDisplayRange('1d').value, '24h');
  assert.deepEqual(normalizeDisplaySettings(), { main: 'today', secondary: '7d' });
});

test('显示档位严格拒绝无效日数与日期范围', () => {
  for (const value of ['0d', '-7d', '3651d', '7days', '20260230-20260301', '20260731-20260701']) {
    assert.throws(() => parseDisplayRange(value), /显示档位|滚动日数|日期无效|开始日期/);
  }
});

test('今天按指定时区从本地零点开始，24H 保持滚动一天', () => {
  const now = new Date('2026-08-01T11:36:00.000Z');
  assert.equal(startOfToday(now, 'Asia/Shanghai').toISOString(), '2026-07-31T16:00:00.000Z');

  const today = buildUsageRequest('today', { now, timeZone: 'Asia/Shanghai' });
  const oneDay = buildUsageRequest('24h', { now, timeZone: 'Asia/Shanghai' });
  assert.deepEqual(today.query, { from: '2026-07-31T16:00:00.000Z' });
  assert.equal(today.cutoff.toISOString(), '2026-07-31T16:00:00.000Z');
  assert.deepEqual(oneDay.query, { days: 1 });
  assert.equal(oneDay.cutoff, null);
  assert.equal(today.timeZone, 'Asia/Shanghai');
});

test('自定义日期范围原样映射为含首尾日期的 API 查询', () => {
  const request = buildUsageRequest('20260701-20260731', { timeZone: 'Asia/Shanghai' });
  assert.deepEqual(request.query, { from: '2026-07-01', to: '2026-07-31' });
  assert.equal(request.range.description, '2026-07-01 至 2026-07-31');
});

test('今天在客户端再次裁剪本地零点之前的 bucket 与 session', () => {
  const request = buildUsageRequest('today', {
    now: new Date('2026-08-01T11:36:00.000Z'),
    timeZone: 'Asia/Shanghai',
  });
  const response = filterUsageResponse({
    hasAnyData: true,
    buckets: [
      { bucketStart: '2026-07-31T15:00:00.000Z', totalTokens: 100 },
      { bucketStart: '2026-07-31T16:00:00.000Z', totalTokens: 200 },
    ],
    sessions: [
      { firstMessageAt: '2026-07-31T15:59:59.000Z', activeSeconds: 10 },
      { firstMessageAt: '2026-07-31T16:00:00.000Z', activeSeconds: 20 },
    ],
  }, request);
  assert.deepEqual(response.buckets.map((bucket) => bucket.totalTokens), [200]);
  assert.deepEqual(response.sessions.map((session) => session.activeSeconds), [20]);
});

test('主要与次要使用独立请求，相同档位只请求一次', async () => {
  const requests = [];
  const response = {
    hasAnyData: true,
    buckets: [{
      bucketStart: '2026-08-01T00:00:00.000Z',
      source: 'Codex',
      model: 'gpt-5.6-sol',
      totalTokens: 1_000,
      cachedInputTokens: 2_000,
      estimatedCost: 0.1,
    }],
    sessions: [{ firstMessageAt: '2026-08-01T00:00:00.000Z', activeSeconds: 60 }],
  };
  const fetchUsageImpl = async (vibe, request) => {
    requests.push(request.range.value);
    return response;
  };
  const options = {
    now: new Date('2026-08-01T11:36:00.000Z'),
    timeZone: 'Asia/Shanghai',
    fetchUsageImpl,
  };

  const independent = await collectDisplayUsage({}, { main: 'today', secondary: '24h' }, options);
  assert.deepEqual(requests.sort(), ['24h', 'today']);
  assert.equal(independent.main.totalTokens, 3_000);
  assert.equal(independent.secondary.totalTokens, 3_000);

  requests.length = 0;
  await collectDisplayUsage({}, { main: '30d', secondary: '30d' }, options);
  assert.deepEqual(requests, ['30d']);
});
