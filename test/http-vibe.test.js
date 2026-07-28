import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpError, InvalidResponseError, requestJson } from '../src/http.js';
import { validateUsageResponse } from '../src/vibe.js';
import { todayUsage } from './fixtures/usage.js';

test('Vibe 固定 fixture 通过必需字段校验', () => {
  assert.equal(validateUsageResponse(structuredClone(todayUsage)).hasAnyData, true);
});

test('Vibe 顶层必需字段缺失时失败', () => {
  const invalid = structuredClone(todayUsage);
  delete invalid.sessions;
  assert.throws(() => validateUsageResponse(invalid), InvalidResponseError);
});

test('Vibe bucket 必需字段缺失时失败', () => {
  const invalid = structuredClone(todayUsage);
  delete invalid.buckets[0].totalTokens;
  assert.throws(() => validateUsageResponse(invalid), /totalTokens/);
});

test('HTTP 401 不重试', async () => {
  let calls = 0;
  await assert.rejects(
    requestJson('http://local.test', {
      apiKey: 'test-key',
      fetchImpl: async () => {
        calls += 1;
        return new Response('{}', { status: 401, headers: { 'content-type': 'application/json' } });
      },
      delay: async () => {},
    }),
    (error) => error instanceof HttpError && error.statusCode === 401,
  );
  assert.equal(calls, 1);
});

test('HTTP 429 最多退避重试 3 次后成功', async () => {
  let calls = 0;
  const delays = [];
  const result = await requestJson('http://local.test', {
    apiKey: 'test-key',
    fetchImpl: async () => {
      calls += 1;
      if (calls <= 3) return new Response('{}', { status: 429 });
      return Response.json({ ok: true });
    },
    delay: async (milliseconds) => delays.push(milliseconds),
    baseDelayMs: 5,
  });
  assert.equal(result.data.ok, true);
  assert.equal(calls, 4);
  assert.deepEqual(delays, [5, 10, 20]);
});

test('HTTP 500 重试耗尽后仍失败', async () => {
  let calls = 0;
  await assert.rejects(
    requestJson('http://local.test', {
      apiKey: 'test-key',
      fetchImpl: async () => {
        calls += 1;
        return new Response('{}', { status: 500 });
      },
      delay: async () => {},
    }),
    (error) => error instanceof HttpError && error.statusCode === 500,
  );
  assert.equal(calls, 4);
});

test('网络错误最多重试 3 次后成功', async () => {
  let calls = 0;
  const result = await requestJson('http://local.test', {
    apiKey: 'test-key',
    fetchImpl: async () => {
      calls += 1;
      if (calls <= 3) throw new TypeError('socket closed');
      return Response.json({ ok: true });
    },
    delay: async () => {},
  });
  assert.equal(result.data.ok, true);
  assert.equal(calls, 4);
});

test('2xx 非 JSON 响应不重试且失败', async () => {
  let calls = 0;
  await assert.rejects(
    requestJson('http://local.test', {
      apiKey: 'test-key',
      fetchImpl: async () => {
        calls += 1;
        return new Response('not-json', { status: 200 });
      },
      delay: async () => {},
    }),
    InvalidResponseError,
  );
  assert.equal(calls, 1);
});
