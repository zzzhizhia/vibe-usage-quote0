import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { aggregateUsage } from '../src/aggregate.js';
import { buildCanvasPayload, validateCanvasPayload } from '../src/canvas.js';
import {
  canvasTaskKey,
  findCanvasTasks,
  getCanvasStatus,
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

test('渲染图 URL 不变但图片内容变化也可证明新渲染', async () => {
  let pushed = false;
  let imageGets = 0;
  const imageAuthorizations = [];
  let baseUrl;
  const server = createServer((request, response) => {
    if (request.url.endsWith('/loop/list')) {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ tasks: [{ taskKey: 'canvas-1', type: 'CANVAS_API' }] }));
      return;
    }
    if (request.url.endsWith('/status')) {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        status: { current: 'Power Active', description: 'The device is power active and ready to use' },
        renderInfo: { last: 'same', current: { image: [`${baseUrl}/render.png`] } },
      }));
      return;
    }
    if (request.url.endsWith('/canvas')) {
      pushed = true;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ message: 'ok' }));
      return;
    }
    if (request.url.endsWith('/render.png')) {
      imageGets += 1;
      imageAuthorizations.push(request.headers.authorization);
      response.setHeader('content-type', 'image/png');
      response.end(pushed ? 'new-render-bytes' : 'old-render-bytes');
      return;
    }
    response.statusCode = 404;
    response.end('{}');
  });
  const address = await listen(server);
  baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const result = await pushCanvasAndWait(
      { apiUrl: baseUrl, apiKey: 'quote-test-key', deviceId: 'DEVICE-1234' },
      { taskAlias: 'Vibe Usage', data: {}, windowData: { default: [] } },
      { timeoutMs: 50, pollIntervalMs: 1, retryOptions: { baseDelayMs: 1 } },
    );
    assert.equal(result.changed, true);
    assert.equal(result.renderImageUrl, `${baseUrl}/render.png`);
    assert.ok(imageGets >= 2);
    assert.ok(imageAuthorizations.every((value) => value === undefined));
  } finally {
    await close(server);
  }
});

test('渲染图指纹网络错误会退避重试且不携带 Quote 鉴权', async () => {
  let pushed = false;
  let baseUrl;
  let renderFetchAttempts = 0;
  const renderAuthorizations = [];
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url.endsWith('/loop/list')) {
      response.end(JSON.stringify({ tasks: [{ taskKey: 'canvas-1', type: 'CANVAS_API' }] }));
      return;
    }
    if (request.url.endsWith('/status')) {
      response.end(JSON.stringify({
        status: { current: 'Power Active', description: 'The device is power active and ready to use' },
        renderInfo: { last: pushed ? 'new' : 'old', current: { image: [`${baseUrl}/render.png`] } },
      }));
      return;
    }
    if (request.url.endsWith('/canvas')) {
      pushed = true;
      response.end(JSON.stringify({ message: 'ok' }));
      return;
    }
    if (request.url.endsWith('/render.png')) {
      renderAuthorizations.push(request.headers.authorization);
      response.setHeader('content-type', 'image/png');
      response.end('render-bytes');
      return;
    }
    response.statusCode = 404;
    response.end('{}');
  });
  const address = await listen(server);
  baseUrl = `http://127.0.0.1:${address.port}`;
  const fetchImpl = async (url, options) => {
    if (String(url).endsWith('/render.png')) {
      renderFetchAttempts += 1;
      if (renderFetchAttempts === 1) throw new TypeError('simulated render network failure');
    }
    return fetch(url, options);
  };
  try {
    const result = await pushCanvasAndWait(
      { apiUrl: baseUrl, apiKey: 'quote-test-key', deviceId: 'DEVICE-1234' },
      { taskAlias: 'Vibe Usage', data: {}, windowData: { default: [] } },
      {
        fetchImpl,
        timeoutMs: 50,
        pollIntervalMs: 1,
        retryOptions: { baseDelayMs: 1 },
      },
    );
    assert.equal(result.changed, true);
    assert.ok(renderFetchAttempts >= 3);
    assert.ok(renderAuthorizations.every((value) => value === undefined));
  } finally {
    await close(server);
  }
});

test('新渲染图 URL 暂时 404 时继续轮询直到图片可用', async () => {
  let pushed = false;
  let newImageGets = 0;
  let baseUrl;
  const server = createServer((request, response) => {
    if (request.url.endsWith('/loop/list')) {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ tasks: [{ taskKey: 'canvas-1', type: 'CANVAS_API' }] }));
      return;
    }
    if (request.url.endsWith('/status')) {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        status: { current: 'Power Active', description: 'The device is power active and ready to use' },
        renderInfo: {
          last: 'same',
          current: { image: [`${baseUrl}/${pushed ? 'new' : 'old'}.png`] },
        },
      }));
      return;
    }
    if (request.url.endsWith('/canvas')) {
      pushed = true;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ message: 'ok' }));
      return;
    }
    if (request.url.endsWith('/old.png')) {
      response.setHeader('content-type', 'image/png');
      response.end('old-render');
      return;
    }
    if (request.url.endsWith('/new.png')) {
      newImageGets += 1;
      if (newImageGets < 3) {
        response.statusCode = 404;
        response.end('pending');
      } else {
        response.setHeader('content-type', 'image/png');
        response.end('new-render');
      }
      return;
    }
    response.statusCode = 404;
    response.end('{}');
  });
  const address = await listen(server);
  baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const result = await pushCanvasAndWait(
      { apiUrl: baseUrl, apiKey: 'quote-test-key', deviceId: 'DEVICE-1234' },
      { taskAlias: 'Vibe Usage', data: {}, windowData: { default: [] } },
      { timeoutMs: 100, pollIntervalMs: 1, retryOptions: { baseDelayMs: 1 } },
    );
    assert.equal(result.changed, true);
    assert.equal(result.renderImageUrl, `${baseUrl}/new.png`);
    assert.equal(newImageGets, 3);
  } finally {
    await close(server);
  }
});

test('Quote 状态明确为休眠时拒绝误报设备可用', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(JSON.stringify({
      status: {
        current: '休眠中',
        description: '设备休眠中以节省电量',
      },
      renderInfo: { last: 'old', current: { image: null } },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  await assert.rejects(
    getCanvasStatus(
      { apiUrl: 'https://quote.local', apiKey: 'quote-test-key', deviceId: 'DEVICE-1234' },
      { fetchImpl, retryOptions: { baseDelayMs: 1 } },
    ),
    /设备休眠/,
  );
  assert.equal(calls, 1);
});

test('Quote 返回未知设备状态时 fail-closed', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    status: {
      current: 'Firmware Transition',
      description: 'State is changing',
    },
    renderInfo: { last: 'old', current: { image: null } },
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

  await assert.rejects(
    getCanvasStatus(
      { apiUrl: 'https://quote.local', apiKey: 'quote-test-key', deviceId: 'DEVICE-1234' },
      { fetchImpl, retryOptions: { baseDelayMs: 1 } },
    ),
    /无法确认可用/,
  );
});

test('Quote 明确不可用时不会被 ready to use 子串误放行', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    status: {
      current: 'Power Inactive',
      description: 'The device is not ready to use',
    },
    renderInfo: { last: 'old', current: { image: null } },
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

  await assert.rejects(
    getCanvasStatus(
      { apiUrl: 'https://quote.local', apiKey: 'quote-test-key', deviceId: 'DEVICE-1234' },
      { fetchImpl, retryOptions: { baseDelayMs: 1 } },
    ),
    /设备不可用/,
  );
});

test('休眠设备在 Canvas POST 前失败', async () => {
  let canvasPosts = 0;
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
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
    if (request.url.endsWith('/canvas')) {
      canvasPosts += 1;
      response.end(JSON.stringify({ message: 'unexpected' }));
      return;
    }
    response.statusCode = 404;
    response.end('{}');
  });
  const address = await listen(server);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await assert.rejects(
      pushCanvasAndWait(
        { apiUrl: baseUrl, apiKey: 'quote-test-key', deviceId: 'DEVICE-1234' },
        { taskAlias: 'Vibe Usage', data: {}, windowData: { default: [] } },
        { timeoutMs: 10, pollIntervalMs: 1, retryOptions: { baseDelayMs: 1 } },
      ),
      /设备休眠/,
    );
    assert.equal(canvasPosts, 0);
  } finally {
    await close(server);
  }
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
      response.end(JSON.stringify(request.url.includes('days=7') ? weekUsage : todayUsage));
      return;
    }
    if (request.url.endsWith('/loop/list')) {
      response.end(JSON.stringify({ tasks: [{ taskKey: 'canvas-1', type: 'CANVAS_API' }] }));
      return;
    }
    if (request.url.endsWith('/status')) {
      response.end(JSON.stringify({
        status: { current: 'Power Active', description: 'The device is power active and ready to use' },
        renderInfo: { last: pushed ? 'new' : 'old', current: { image: null } },
      }));
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
