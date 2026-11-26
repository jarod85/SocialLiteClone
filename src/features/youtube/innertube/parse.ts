/**
 * Small readers for YouTube's InnerTube JSON, shared by search, channel and feed.
 * YouTube moves its containers around often; the parsers look for the item
 * renderers wherever they are (walk) instead of following one fixed path.
 */
import type { Video } from '../types';

/** Containers whose videos YouTube adds to results on its own (related shelves, Shorts, ads): never shown. */
const SKIP = new Set([
  'shelfRenderer',
  'reelShelfRenderer',
  'gridShelfViewModel',
  'horizontalCardListRenderer',
  'shortsLockupViewModel',
  'searchPyvRenderer',
  'adSlotRenderer',
]);

/** Calls `visit(key, value)` for every property under `root`, depth first, skipping SKIP containers. */
export function walk(root: unknown, visit: (key: string, value: any) => void): void {
  if (Array.isArray(root)) {
    for (const item of root) walk(item, visit);
  } else if (root && typeof root === 'object') {
    for (const [key, value] of Object.entries(root)) {
      if (SKIP.has(key)) continue;
      visit(key, value);
      walk(value, visit);
    }
  }
}

/** Every value stored under `key`, in document order. */
export function findAll(root: unknown, key: string): any[] {
  const out: any[] = [];
  walk(root, (k, v) => {
    if (k === key) out.push(v);
  });
  return out;
}

/** The token that loads the next page, if any. */
export function continuationToken(root: unknown): string | null {
  const command = findAll(root, 'continuationCommand')[0];
  return typeof command?.token === 'string' ? command.token : null;
}

/** Text from any of YouTube's text shapes ({simpleText}, {runs}, {content}). */
export function text(value: any): string | null {
  if (typeof value === 'string') return value;
  if (!value) return null;
  if (typeof value.simpleText === 'string') return value.simpleText;
  if (typeof value.content === 'string') return value.content;
  if (Array.isArray(value.runs)) return value.runs.map((r: { text?: string }) => r.text ?? '').join('');
  return null;
}

export const absolute = (url: string) => (url.startsWith('//') ? `https:${url}` : url);

/** The largest of a thumbnails list ({thumbnails} or {sources}). */
export function bestImage(value: any): string | null {
  const list = value?.thumbnails ?? value?.sources ?? value?.image?.sources;
  const last = Array.isArray(list) ? list[list.length - 1] : null;
  return typeof last?.url === 'string' ? absolute(last.url) : null;
}

/** "28:04" or "1:05:56" as seconds; null for anything else ("LIVE", "SHORTS"). */
export function parseDuration(value: string | null | undefined): number | null {
  if (!value || !/^\d+(:\d{1,2}){1,2}$/.test(value.trim())) return null;
  return value
    .trim()
    .split(':')
    .reduce((total, part) => total * 60 + Number(part), 0);
}

const SCALE: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9 };

/** "2,981,319 views", "2.9M views", "21.5M subscribers" as a number; null without digits. */
export function parseCount(value: string | null | undefined): number | null {
  const match = value?.match(/([\d.,]+)\s*([KMB])?/i);
  if (!match) return null;
  const base = Number(match[2] ? match[1].replace(/,/g, '') : match[1].replace(/[.,]/g, ''));
  if (!Number.isFinite(base)) return null;
  return Math.round(base * (match[2] ? SCALE[match[2].toUpperCase()] : 1));
}

const UNIT_MS: Record<string, number> = {
  second: 1000,
  minute: 60_000,
  hour: 3600_000,
  day: 86400_000,
  week: 7 * 86400_000,
  month: 30 * 86400_000,
  year: 365 * 86400_000,
};

/** "10 hours ago" as an approximate time (ms), counted back from `now`. */
export function parseAgo(value: string | null | undefined, now = Date.now()): number | null {
  const match = value?.match(/(\d+)\s*(second|minute|hour|day|week|month|year)s?\s+ago/i);
  return match ? now - Number(match[1]) * UNIT_MS[match[2].toLowerCase()] : null;
}

/** What a nextPage token stands for. Opaque to the screens. */
export type PageToken = { kind: 'search'; token: string } | { kind: 'channel'; token: string; id: string; name: string | null };

export const encodeToken = (t: PageToken) => JSON.stringify(t);

export const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;
export const channelUrl = (id: string) => `https://www.youtube.com/channel/${id}`;

/** A video from a search result (videoRenderer), or null for Shorts and anything unreadable. */
export function videoFromRenderer(r: any): Video | null {
  const id = r?.videoId;
  if (typeof id !== 'string') return null;
  const path = r.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url;
  if (typeof path === 'string' && path.startsWith('/shorts/')) return null;
  const owner = r.ownerText ?? r.longBylineText ?? r.shortBylineText;
  const uploadedText = text(r.publishedTimeText);
  const length = text(r.lengthText);
  const live = !length && (r.badges ?? []).some((b: any) => /LIVE/.test(b?.metadataBadgeRenderer?.style ?? ''));
  return {
    type: 'video',
    id,
    url: watchUrl(id),
    title: text(r.title) ?? '',
    channelName: text(owner),
    channelId: owner?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId ?? null,
    thumbnail: bestImage(r.thumbnail),
    durationSeconds: parseDuration(length),
    uploadedText,
    uploadedAt: parseAgo(uploadedText),
    viewCount: parseCount(text(r.viewCountText)),
    isLive: live,
  };
}

/** A video from a channel tab's lockupViewModel, or null if it isn't a video. */
export function videoFromLockup(l: any, channel: { id: string; name: string | null }): Video | null {
  if (typeof l?.contentId !== 'string' || (l.contentType && l.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO')) return null;
  const parts: string[] = findAll(l.metadata, 'metadataParts')
    .flat()
    .map((p: any) => text(p?.text))
    .filter((t: string | null): t is string => !!t);
  const badge = text(findAll(l.contentImage, 'thumbnailBadgeViewModel')[0]?.text);
  const uploadedText = parts.find((p) => /ago/i.test(p)) ?? null;
  return {
    type: 'video',
    id: l.contentId,
    url: watchUrl(l.contentId),
    title: text(l.metadata?.lockupMetadataViewModel?.title) ?? '',
    channelId: channel.id,
    channelName: channel.name,
    thumbnail: bestImage(l.contentImage?.thumbnailViewModel?.image),
    durationSeconds: parseDuration(badge),
    uploadedText,
    uploadedAt: parseAgo(uploadedText),
    viewCount: parseCount(parts.find((p) => /view/i.test(p))),
    isLive: badge === 'LIVE',
  };
}
