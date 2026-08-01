import { aggregateUsage } from './aggregate.js';
import {
  buildUsageRequest,
  currentTimeZone,
  filterUsageResponse,
  resolveDisplaySettings,
} from './display.js';
import { fetchUsage } from './vibe.js';

function defaultFetcher(vibe, request, options) {
  return fetchUsage({
    ...vibe,
    query: request.query,
    timeZone: request.timeZone,
    fetchImpl: options.fetchImpl,
    logger: options.logger,
    retryOptions: options.retryOptions,
  });
}

export async function collectDisplayUsage(vibe, display, options = {}) {
  const ranges = resolveDisplaySettings(display);
  const now = options.now ?? new Date();
  const timeZone = options.timeZone ?? currentTimeZone();
  const requests = {
    main: buildUsageRequest(ranges.main, { now, timeZone }),
    secondary: buildUsageRequest(ranges.secondary, { now, timeZone }),
  };
  const fetcher = options.fetchUsageImpl ?? defaultFetcher;
  const responses = new Map();

  await Promise.all(Object.values(requests).map(async (request) => {
    if (responses.has(request.key)) return;
    const promise = Promise.resolve(fetcher(vibe, request, options));
    responses.set(request.key, promise);
    await promise;
  }));

  const mainResponse = filterUsageResponse(await responses.get(requests.main.key), requests.main);
  const secondaryResponse = filterUsageResponse(await responses.get(requests.secondary.key), requests.secondary);
  return aggregateUsage(mainResponse, secondaryResponse, ranges);
}
