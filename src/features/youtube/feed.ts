/** Feed bookkeeping. Pure, so it's unit-tested. */
import type { Video } from './types';

/** Upper bound on cached feed items. */
export const FEED_LIMIT = 400;

/**
 * Combines a fresh feed with the cached one:
 *  - channels that loaded replace their cached videos,
 *  - channels that failed keep their cached videos,
 *  - unsubscribed channels drop out,
 * newest first, without duplicates.
 */
export function mergeFeed(cached: Video[], fresh: Video[], subscribedIds: string[], failedIds: string[]): Video[] {
  const subscribed = new Set(subscribedIds);
  const failed = new Set(failedIds);
  const kept = cached.filter((v) => v.channelId && subscribed.has(v.channelId) && failed.has(v.channelId));
  const seen = new Set<string>();
  return [...fresh, ...kept]
    .filter((v) => (seen.has(v.id) ? false : (seen.add(v.id), true)))
    .sort((a, b) => (b.uploadedAt ?? 0) - (a.uploadedAt ?? 0))
    .slice(0, FEED_LIMIT);
}
