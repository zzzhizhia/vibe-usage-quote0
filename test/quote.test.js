import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { aggregateUsage } from '../src/aggregate.js';
import { buildCanvasPayload, validateCanvasPayload } from '../src/canvas.js';
import {
  canvasTaskKey,
  findCanvasTasks,
  pushCanvasAndWait,
  renderChanged,
  selectCanvasTask,
  snapshotCanvasTask,
} from '../src/quote.js';
import { fetchUsage } from '../src/vibe.js';
import { todayUsage, weekUsage } from './fixtures/usage.js';

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address())));
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

test('找到唯一 CANVAS_API 画板', () => {
  const response = { data: { items: [{ taskKey: 'text-1', type: 'TEXT_API' }, { taskKey: 'canvas-1', type: 'CANVAS_API' }] } };
  assert.equal(findCanvasTasks(response).length, 1);
  assert.equal(canvasTaskKey(selectCanvasTask(response)), 'canvas-1');
});

test('多个画板且未给 taskKey 时拒绝猜测', () => {
  const response = { tasks: [{ taskKey: 'a', type: 'CANVAS_API' }, { taskKey: 'b', type: 'CANVAS_API' }] };
  assert.throws(() => selectCanvasTask(response), /必须设置 QUOTE0_TASK_KEY/);
});

test('多个画板按 taskKey 精确选择', () => {
  const response = { tasks: [{ taskKey: 'a', type: 'CANVAS_API' }, { taskKey: 'b', type: 'CANVAS_API' }] };
  assert.equal(canvasTaskKey(selectCanvasTask(response, 'b')), 'b');
  assert.throws(() => selectCanvasTask(response, 'B'), /精确匹配/);
});

test('缺少画板时失败', () => {
  assert.throws(() => selectCanvasTask({ tasks: [{ taskKey: 'x', type: 'TEXT_API' }] }), /没有 CANVAS_API/);
});

test('renderInfo.last 变化可证明新渲染', () => {
  const before = snapshotCanvasTask({ renderInfo: { last: 'old' } });
  const after = snapshotCanvasTask({ renderInfo: { last: 'new' } });
  assert.equal(renderChanged(before, after), true);
});

test('当前渲染图 URL 变化也可证明新渲染', () => {
  const before = snapshotCanvasTask({ renderInfo: { last: 'same', currentImageUrl: 'https://local.test/old.png' } });
  const after = snapshotCanvasTask({ renderInfo: { last: 'same', currentImageUrl: 'https://local.test/new.png' } });
  assert.equal(renderChanged(before, after), true);
});

test('本地 mock 证明鉴权隔离、Payload 防泄漏与渲染变化', async () => {
  const seen = [];
  let pushed = false;
  const server = createServer(async (request, response) => {
    const bodyChunks = [];
    for await (const chunk of request) bodyChunks.push(chunk);
    const body = bodyChunks.length ? JSON.parse(Buffer.concat(bodyChunks).toString('utf8')) : null;
    seen.push({ path: request.url, authorization: request.headers.authorization, body });
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
      response.end(JSON.stringify({ renderInfo: { last: pushed ? 'new' : 'old', current: { image: null } } }));
      return;
    }
    if (request.url.endsWith('/canvas')) {
      pushed = true;
      response.statusCode = 201;
      response.end(JSON.stringify({ message: 'ok' }));
      return;
    }
    response.statusCode = 404;
    response.end('{}');
  });
  const address = await listen(server);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const [today, week] = await Promise.all([
      fetchUsage({ apiUrl: baseUrl, apiKey: 'vibe-test-key', days: 1, retryOptions: { baseDelayMs: 1 } }),
      fetchUsage({ apiUrl: baseUrl, apiKey: 'vibe-test-key', days: 7, retryOptions: { baseDelayMs: 1 } }),
    ]);
    const payload = buildCanvasPayload(aggregateUsage(today, week), new Date('2026-07-28T04:00:00Z'));
    const info = validateCanvasPayload(payload, ['vibe-test-key', 'quote-test-key']);
    const result = await pushCanvasAndWait(
      { apiUrl: baseUrl, apiKey: 'quote-test-key', deviceId: 'DEVICE-1234' },
      payload,
      { timeoutMs: 500, pollIntervalMs: 1, retryOptions: { baseDelayMs: 1 } },
    );
    assert.equal(result.postStatus, 201);
    assert.equal(result.changed, true);
    assert.deepEqual(info.elementTypes, ['div', 'span']);
    const vibeRequests = seen.filter((entry) => entry.path.startsWith('/api/usage'));
    const quoteRequests = seen.filter((entry) => entry.path.includes('/api/authV2/open/device/'));
    assert.ok(vibeRequests.every((entry) => entry.authorization === 'Bearer vibe-test-key'));
    assert.ok(quoteRequests.every((entry) => entry.authorization === 'Bearer quote-test-key'));
    assert.ok(vibeRequests.every((entry) => entry.authorization !== 'Bearer quote-test-key'));
    assert.ok(quoteRequests.every((entry) => entry.authorization !== 'Bearer vibe-test-key'));
    const posted = quoteRequests.find((entry) => entry.path.endsWith('/canvas')).body;
    const serialized = JSON.stringify(posted);
    assert.doesNotMatch(serialized, /private-alpha|private-beta|project/i);
    assert.doesNotMatch(serialized, /vibe-test-key|quote-test-key/);
  } finally {
    await close(server);
  }
});
