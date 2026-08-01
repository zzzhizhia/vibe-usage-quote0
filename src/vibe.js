import { InvalidResponseError, requestJson } from './http.js';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateUsageResponse(value) {
  if (!isRecord(value)) throw new InvalidResponseError('Vibe 响应必须是对象');
  if (!Array.isArray(value.buckets)) throw new InvalidResponseError('Vibe 响应缺少 buckets 数组');
  if (!Array.isArray(value.sessions)) throw new InvalidResponseError('Vibe 响应缺少 sessions 数组');
  if (typeof value.hasAnyData !== 'boolean') throw new InvalidResponseError('Vibe 响应缺少 hasAnyData 布尔值');

  for (const [index, bucket] of value.buckets.entries()) {
    if (!isRecord(bucket)) throw new InvalidResponseError(`bucket[${index}] 必须是对象`);
    for (const field of ['bucketStart', 'source', 'model', 'totalTokens', 'cachedInputTokens', 'estimatedCost']) {
      if (!(field in bucket)) throw new InvalidResponseError(`bucket[${index}] 缺少 ${field}`);
    }
    if (typeof bucket.bucketStart !== 'string' || !Number.isFinite(Date.parse(bucket.bucketStart))) {
      throw new InvalidResponseError(`bucket[${index}].bucketStart 必须是有效时间`);
    }
  }
  for (const [index, session] of value.sessions.entries()) {
    if (!isRecord(session)) throw new InvalidResponseError(`session[${index}] 必须是对象`);
    for (const field of ['firstMessageAt', 'activeSeconds']) {
      if (!(field in session)) throw new InvalidResponseError(`session[${index}] 缺少 ${field}`);
    }
    if (typeof session.firstMessageAt !== 'string' || !Number.isFinite(Date.parse(session.firstMessageAt))) {
      throw new InvalidResponseError(`session[${index}].firstMessageAt 必须是有效时间`);
    }
  }
  return value;
}

function normalizeUsageQuery(query, days) {
  if (query === undefined) {
    if (!Number.isSafeInteger(days) || days < 1) throw new Error('Vibe 用量查询缺少有效时间范围');
    return { days };
  }
  if (!isRecord(query)) throw new Error('Vibe 用量查询必须是对象');
  if (Number.isSafeInteger(query.days) && query.days >= 1 && Object.keys(query).length === 1) {
    return { days: query.days };
  }
  if (typeof query.from === 'string' && query.from && query.to === undefined && Object.keys(query).length === 1) {
    return { from: query.from };
  }
  if (
    typeof query.from === 'string'
    && query.from
    && typeof query.to === 'string'
    && query.to
    && Object.keys(query).length === 2
  ) {
    return { from: query.from, to: query.to };
  }
  throw new Error('Vibe 用量查询必须是 days、from 或 from/to');
}

function queryLabel(query) {
  if (query.days) return `${query.days}日`;
  if (query.to) return `${query.from}..${query.to}`;
  return `from ${query.from}`;
}

export async function fetchUsage({
  apiUrl,
  apiKey,
  days,
  query,
  timeZone,
  fetchImpl,
  logger,
  retryOptions = {},
}) {
  const normalizedQuery = normalizeUsageQuery(query, days);
  const url = new URL('/api/usage', apiUrl);
  for (const [key, value] of Object.entries(normalizedQuery)) {
    url.searchParams.set(key, String(value));
  }
  if (timeZone) url.searchParams.set('tz', timeZone);
  const label = queryLabel(normalizedQuery);
  const result = await requestJson(url, {
    apiKey,
    fetchImpl,
    validate: validateUsageResponse,
    logger,
    stage: `Vibe ${label}用量`,
    identifier: normalizedQuery.days ? `days-${normalizedQuery.days}` : 'date-range',
    ...retryOptions,
  });
  return result.data;
}
