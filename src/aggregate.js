function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function addFiniteNonNegative(total, value) {
  const increment = finiteNonNegative(value);
  return total >= Number.MAX_VALUE - increment ? Number.MAX_VALUE : total + increment;
}

function bucketTotalTokens(bucket) {
  return addFiniteNonNegative(finiteNonNegative(bucket?.totalTokens), bucket?.cachedInputTokens);
}

function compactDecimal(value, decimals = 1) {
  return Number(value.toFixed(decimals)).toString();
}

export function truncateText(value, maxLength = 24) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '未知';
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(1, maxLength - 1))}…`;
}

function aggregateRanking(buckets, key) {
  const totals = new Map();
  for (const bucket of buckets) {
    if (!bucket || typeof bucket !== 'object') continue;
    const name = truncateText(bucket[key], 24);
    totals.set(name, addFiniteNonNegative(totals.get(name) ?? 0, bucketTotalTokens(bucket)));
  }
  return [...totals.entries()]
    .map(([name, tokens]) => ({ name, tokens }))
    .sort((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name, 'zh-CN'))
    .slice(0, 3);
}

export function aggregateWindow(response) {
  const buckets = Array.isArray(response?.buckets) ? response.buckets : [];
  const sessions = Array.isArray(response?.sessions) ? response.sessions : [];
  let totalTokens = 0;
  let estimatedCost = 0;
  for (const bucket of buckets) {
    if (!bucket || typeof bucket !== 'object') continue;
    totalTokens = addFiniteNonNegative(totalTokens, bucketTotalTokens(bucket));
    estimatedCost += finiteNonNegative(bucket.estimatedCost);
  }
  let activeSeconds = 0;
  let sessionCount = 0;
  for (const session of sessions) {
    if (!session || typeof session !== 'object') continue;
    sessionCount += 1;
    activeSeconds += finiteNonNegative(session.activeSeconds);
  }
  return {
    totalTokens,
    estimatedCost: Math.round(estimatedCost * 1_000_000_000_000) / 1_000_000_000_000,
    sessionCount,
    activeSeconds,
    topTools: aggregateRanking(buckets, 'source'),
    topModels: aggregateRanking(buckets, 'model'),
    hasAnyData: totalTokens > 0 || estimatedCost > 0 || sessionCount > 0 || activeSeconds > 0,
  };
}

export function aggregateUsage(todayResponse, weekResponse) {
  return {
    today: aggregateWindow(todayResponse),
    week: aggregateWindow(weekResponse),
  };
}

export function formatTokens(value) {
  const number = finiteNonNegative(value);
  if (number >= 10_000_000_000_000_000) return '9999万亿+';
  if (number >= 1_000_000_000_000) {
    const scaled = number / 1_000_000_000_000;
    return `${scaled >= 100 ? Math.round(scaled) : compactDecimal(scaled)}万亿`;
  }
  if (number >= 100_000_000) {
    const scaled = number / 100_000_000;
    return `${scaled >= 100 ? Math.round(scaled) : compactDecimal(scaled)}亿`;
  }
  if (number >= 10_000) return `${(number / 10_000).toFixed(number >= 100_000 ? 0 : 1)}万`;
  return Math.round(number).toLocaleString('zh-CN');
}

export function formatCost(value) {
  const number = finiteNonNegative(value);
  if (number >= 1_000_000_000_000) return '$9999亿+';
  if (number >= 100_000_000) {
    const scaled = number / 100_000_000;
    return `$${scaled >= 100 ? Math.round(scaled) : compactDecimal(scaled)}亿`;
  }
  if (number >= 10_000) {
    const scaled = number / 10_000;
    return `$${scaled >= 100 ? Math.round(scaled) : compactDecimal(scaled)}万`;
  }
  return `$${number.toFixed(2)}`;
}

export function formatCount(value) {
  const number = finiteNonNegative(value);
  if (number >= 100_000_000) return '9999万+';
  if (number >= 10_000) {
    const scaled = number / 10_000;
    return `${scaled >= 100 ? Math.round(scaled) : compactDecimal(scaled)}万`;
  }
  return Math.round(number).toLocaleString('zh-CN');
}

export function formatActiveTime(seconds) {
  const safe = finiteNonNegative(seconds);
  if (safe < 60) return `${Math.round(safe)}秒`;
  if (safe < 3600) return `${Math.round(safe / 60)}分钟`;
  if (safe < 3_600_000) return `${compactDecimal(safe / 3600)}小时`;
  if (safe < 31_557_600) return `${compactDecimal(safe / 86_400)}天`;
  if (safe < 3_155_760_000) return `${compactDecimal(safe / 31_557_600)}年`;
  return '100年+';
}
