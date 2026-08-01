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

const TOKEN_UNITS = [
  { divisor: 1, suffix: '' },
  { divisor: 10_000, suffix: '万' },
  { divisor: 100_000_000, suffix: '亿' },
  { divisor: 1_000_000_000_000, suffix: '万亿' },
];

function formatTokenUnit(number, initialUnitIndex) {
  let unitIndex = initialUnitIndex;
  while (unitIndex < TOKEN_UNITS.length) {
    const unit = TOKEN_UNITS[unitIndex];
    const scaled = number / unit.divisor;
    const integerDigits = Math.max(1, Math.floor(Math.log10(scaled)) + 1);
    const decimals = Math.max(0, 4 - integerDigits);
    const decimalFactor = 10 ** decimals;
    const rounded = Math.round(number / (unit.divisor / decimalFactor)) / decimalFactor;

    if (rounded < 10_000) {
      const value = unitIndex === 0 ? rounded.toLocaleString('zh-CN') : rounded.toString();
      return `${value}${unit.suffix}`;
    }
    unitIndex += 1;
  }
  return '9999万亿+';
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

const DEFAULT_RANGES = {
  main: { value: 'today', label: '今天', description: '今天（本地零点至现在）' },
  secondary: { value: '7d', label: '近 7 日', description: '近 7 日' },
};

export function aggregateUsage(mainResponse, secondaryResponse, ranges = DEFAULT_RANGES) {
  return {
    main: aggregateWindow(mainResponse),
    secondary: aggregateWindow(secondaryResponse),
    ranges,
  };
}

export function formatTokens(value) {
  const number = finiteNonNegative(value);
  const unitIndex = TOKEN_UNITS.findLastIndex(({ divisor }) => number >= divisor);
  return formatTokenUnit(number, Math.max(0, unitIndex));
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
