export const DEFAULT_DISPLAY_SETTINGS = Object.freeze({
  main: 'today',
  secondary: '7d',
});

export const MAX_ROLLING_DAYS = 3_650;

const DISPLAY_TARGETS = new Set(['main', 'secondary']);
const CUSTOM_RANGE_PATTERN = /^(\d{8})-(\d{8})$/;
const ROLLING_RANGE_PATTERN = /^([1-9]\d*)d$/;

function parseDateToken(token) {
  const year = Number(token.slice(0, 4));
  const month = Number(token.slice(4, 6));
  const day = Number(token.slice(6, 8));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (year < 1_000 || month < 1 || month > 12 || day < 1 || day > daysInMonth) {
    throw new Error(`自定义日期无效：${token}`);
  }
  return {
    compact: token,
    dashed: `${token.slice(0, 4)}-${token.slice(4, 6)}-${token.slice(6, 8)}`,
  };
}

export function normalizeDisplayTarget(value) {
  const target = String(value ?? '').trim().toLowerCase();
  if (!DISPLAY_TARGETS.has(target)) {
    throw new Error('显示区域必须是 main 或 secondary');
  }
  return target;
}

export function parseDisplayRange(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'today') {
    return {
      value: 'today',
      kind: 'today',
      label: '今天',
      description: '今天（本地零点至现在）',
    };
  }
  if (normalized === '24h') {
    return {
      value: '24h',
      kind: 'days',
      days: 1,
      label: '24H',
      description: '滚动 24 小时',
    };
  }

  const rollingMatch = normalized.match(ROLLING_RANGE_PATTERN);
  if (rollingMatch) {
    const days = Number(rollingMatch[1]);
    if (!Number.isSafeInteger(days) || days > MAX_ROLLING_DAYS) {
      throw new Error(`滚动日数必须是 1-${MAX_ROLLING_DAYS} 的整数`);
    }
    if (days === 1) return parseDisplayRange('24h');
    return {
      value: `${days}d`,
      kind: 'days',
      days,
      label: `近 ${days} 日`,
      description: `近 ${days} 日`,
    };
  }

  const customMatch = normalized.match(CUSTOM_RANGE_PATTERN);
  if (customMatch) {
    const from = parseDateToken(customMatch[1]);
    const to = parseDateToken(customMatch[2]);
    if (from.compact > to.compact) {
      throw new Error('自定义日期范围的开始日期不能晚于结束日期');
    }
    return {
      value: `${from.compact}-${to.compact}`,
      kind: 'custom',
      from: from.dashed,
      to: to.dashed,
      label: '自定义',
      description: `${from.dashed} 至 ${to.dashed}`,
    };
  }

  throw new Error('显示档位必须是 today、24h、Nd（如 14d）或 yyyyMMdd-yyyyMMdd');
}

export function normalizeDisplaySettings(value) {
  if (value !== undefined && (value === null || typeof value !== 'object' || Array.isArray(value))) {
    throw new Error('Quote 配置 display 必须是 JSON 对象');
  }
  const display = value ?? {};
  return {
    main: parseDisplayRange(display.main ?? DEFAULT_DISPLAY_SETTINGS.main).value,
    secondary: parseDisplayRange(display.secondary ?? DEFAULT_DISPLAY_SETTINGS.secondary).value,
  };
}

export function resolveDisplaySettings(value) {
  const normalized = normalizeDisplaySettings(value);
  return {
    main: parseDisplayRange(normalized.main),
    secondary: parseDisplayRange(normalized.secondary),
  };
}

export function currentTimeZone() {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
  } catch {
    return 'UTC';
  }
  return timeZone;
}

function zonedDateParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
}

function timeZoneOffsetMilliseconds(date, timeZone) {
  const parts = zonedDateParts(date, timeZone);
  const representedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return representedAsUtc - Math.floor(date.getTime() / 1_000) * 1_000;
}

export function startOfToday(now = new Date(), timeZone = currentTimeZone()) {
  const parts = zonedDateParts(now, timeZone);
  const utcMidnight = Date.UTC(parts.year, parts.month - 1, parts.day);
  let result = utcMidnight - timeZoneOffsetMilliseconds(new Date(utcMidnight), timeZone);
  result = utcMidnight - timeZoneOffsetMilliseconds(new Date(result), timeZone);
  return new Date(result);
}

export function buildUsageRequest(rangeValue, options = {}) {
  const range = typeof rangeValue === 'string' ? parseDisplayRange(rangeValue) : rangeValue;
  const now = options.now ?? new Date();
  const timeZone = options.timeZone ?? currentTimeZone();
  let query;
  let cutoff = null;

  if (range.kind === 'today') {
    cutoff = startOfToday(now, timeZone);
    query = { from: cutoff.toISOString() };
  } else if (range.kind === 'custom') {
    query = { from: range.from, to: range.to };
  } else {
    query = { days: range.days };
  }

  return {
    range,
    query,
    timeZone,
    cutoff,
    key: JSON.stringify({ query, timeZone }),
  };
}

function atOrAfter(value, cutoff) {
  const timestamp = Date.parse(value);
  return !Number.isFinite(timestamp) || timestamp >= cutoff.getTime();
}

export function filterUsageResponse(response, request) {
  if (!request.cutoff) return response;
  return {
    ...response,
    buckets: response.buckets.filter((bucket) => atOrAfter(bucket.bucketStart, request.cutoff)),
    sessions: response.sessions.filter((session) => atOrAfter(session.firstMessageAt, request.cutoff)),
  };
}
