export class HttpError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
  }
}

export class InvalidResponseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidResponseError';
  }
}

export function maskIdentifier(value) {
  const text = String(value ?? '');
  if (!text) return '未设置';
  if (text.length <= 4) return '***';
  return `***${text.slice(-4)}`;
}

function defaultDelay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function discardBody(response) {
  try {
    await response.arrayBuffer();
  } catch {
    // The status code is sufficient; response bodies may contain sensitive details.
  }
}

export async function requestJson(url, options = {}) {
  const {
    method = 'GET',
    apiKey,
    body,
    fetchImpl = globalThis.fetch,
    timeoutMs = 15_000,
    retries = 3,
    baseDelayMs = 100,
    delay = defaultDelay,
    validate,
    logger = () => {},
    stage = '请求',
    identifier = '',
  } = options;

  if (typeof fetchImpl !== 'function') throw new TypeError('fetch 不可用');
  if (!apiKey) throw new Error(`${stage}缺少 API key`);

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    logger({ phase: 'request', stage, attempt: attempt + 1, identifier: maskIdentifier(identifier) });
    try {
      const headers = {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      };
      if (body !== undefined) headers['Content-Type'] = 'application/json';

      const response = await fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      logger({ phase: 'status', stage, status: response.status, identifier: maskIdentifier(identifier) });

      if (!response.ok) {
        await discardBody(response);
        throw new HttpError(`${stage}返回 HTTP ${response.status}`, response.status);
      }

      let data;
      try {
        data = await response.json();
      } catch {
        throw new InvalidResponseError(`${stage}返回的不是有效 JSON`);
      }
      if (validate) validate(data);
      return { data, status: response.status };
    } catch (error) {
      lastError = error;
      const status = error instanceof HttpError ? error.statusCode : undefined;
      const retryable =
        !(error instanceof InvalidResponseError) &&
        (status === 429 || (status !== undefined && status >= 500) || status === undefined);
      if (!retryable || status === 401 || attempt >= retries) throw error;
      await delay(baseDelayMs * 2 ** attempt);
    }
  }

  throw lastError;
}

export function formatRequestLog(event) {
  if (event.phase === 'request') {
    return `[请求] ${event.stage} 尝试=${event.attempt} 标识=${event.identifier}`;
  }
  return `[状态] ${event.stage} HTTP=${event.status} 标识=${event.identifier}`;
}
