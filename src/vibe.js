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
    for (const field of ['source', 'model', 'totalTokens', 'cachedInputTokens', 'estimatedCost']) {
      if (!(field in bucket)) throw new InvalidResponseError(`bucket[${index}] 缺少 ${field}`);
    }
  }
  for (const [index, session] of value.sessions.entries()) {
    if (!isRecord(session)) throw new InvalidResponseError(`session[${index}] 必须是对象`);
    if (!('activeSeconds' in session)) throw new InvalidResponseError(`session[${index}] 缺少 activeSeconds`);
  }
  return value;
}

export async function fetchUsage({ apiUrl, apiKey, days, fetchImpl, logger, retryOptions = {} }) {
  const url = new URL('/api/usage', apiUrl);
  url.searchParams.set('days', String(days));
  const result = await requestJson(url, {
    apiKey,
    fetchImpl,
    validate: validateUsageResponse,
    logger,
    stage: `Vibe ${days}日用量`,
    identifier: `days-${days}`,
    ...retryOptions,
  });
  return result.data;
}
