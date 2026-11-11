/**
 * Recognizes YouTube links (shared from other apps, or pasted into search).
 * Pure, so the same rules are unit-tested and used by +native-intent.
 */
import type { DescriptionLink } from './types';

export type YouTubeLink =
  | { kind: 'video'; id: string }
  | { kind: 'short'; id: string }
  | { kind: 'channel'; id: string }
  | { kind: 'handle'; handle: string };

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be']);

export function parseYouTubeLink(input: string): YouTubeLink | null {
  const text = input.trim();
  const match = /^(?:https?:\/\/)?([^/?#\s]+)(\/[^?#\s]*)?(?:\?([^#\s]*))?/i.exec(text);
  if (!match) return null;
  const host = match[1].toLowerCase();
  if (!HOSTS.has(host)) return null;
  const segments = (match[2] ?? '/').split('/').filter(Boolean);
  const query = new Map<string, string>();
  for (const pair of (match[3] ?? '').split('&')) {
    const eq = pair.indexOf('=');
    if (eq > 0) query.set(pair.slice(0, eq), decodeURIComponentSafe(pair.slice(eq + 1)));
  }

  if (host.endsWith('youtu.be')) return video(segments[0]);
  const [first, second] = segments;
  switch (first) {
    case 'watch':
      return video(query.get('v'));
    case 'live':
    case 'embed':
    case 'v':
      return video(second);
    case 'shorts':
      return second && VIDEO_ID.test(second) ? { kind: 'short', id: second } : null;
    case 'channel':
      return second && CHANNEL_ID.test(second) ? { kind: 'channel', id: second } : null;
    default:
      if (first?.startsWith('@') && first.length > 1) return { kind: 'handle', handle: first };
      return null;
  }
}

function video(id: string | undefined): YouTubeLink | null {
  return id && VIDEO_ID.test(id) ? { kind: 'video', id } : null;
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** The app route a link opens, or null for links that aren't ours to handle. */
export function routeForLink(input: string): string | null {
  const link = parseYouTubeLink(input);
  if (!link) return null;
  switch (link.kind) {
    case 'video':
      return `/youtube/watch/${link.id}`;
    case 'short':
      return `/youtube/watch/${link.id}?short=1`;
    case 'channel':
      return `/youtube/channel/${link.id}`;
    case 'handle':
      return `/youtube/channel/${encodeURIComponent(`https://www.youtube.com/${link.handle}`)}`;
  }
}

/** Text cut into plain parts and link parts (with their url), in order. Links that overlap or fall outside the text are left as text. */
export function splitLinks(text: string, links: readonly DescriptionLink[] = []): { text: string; url?: string }[] {
  const parts: { text: string; url?: string }[] = [];
  let at = 0;
  for (const link of links) {
    if (link.start < at || link.end <= link.start || link.end > text.length) continue;
    if (link.start > at) parts.push({ text: text.slice(at, link.start) });
    parts.push({ text: text.slice(link.start, link.end), url: link.url });
    at = link.end;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}

/** Where a link asks the video to start, in seconds (`t=90`, `t=90s`, `t=1m30s`), or null. */
export function startSeconds(url: string): number | null {
  const t = /[?&#]t=(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?(?=[&#]|$)/.exec(url);
  if (!t || (!t[1] && !t[2] && !t[3])) return null;
  return Number(t[1] ?? 0) * 3600 + Number(t[2] ?? 0) * 60 + Number(t[3] ?? 0);
}

/** "13:59" or "1:02:03", not inside a longer run of digits and colons. Group 1 is the character before it. */
const TIMESTAMP = /(^|[^\d:])((?:(\d{1,2}):)?(\d{1,2}):([0-5]\d))(?![\d:])/g;

/**
 * The description's links plus, for each timestamp YouTube left as plain text,
 * a link into `videoUrl` at that time (only up to `duration` seconds, when known).
 */
export function withTimestamps(
  text: string,
  links: readonly DescriptionLink[] = [],
  videoUrl: string,
  duration?: number | null,
): DescriptionLink[] {
  const found: DescriptionLink[] = [];
  for (const m of text.matchAll(TIMESTAMP)) {
    const start = m.index + m[1].length;
    const end = start + m[2].length;
    const seconds = Number(m[3] ?? 0) * 3600 + Number(m[4]) * 60 + Number(m[5]);
    if (duration != null && seconds > duration) continue;
    if (links.some((l) => l.start < end && start < l.end)) continue;
    found.push({ start, end, url: `${videoUrl}&t=${seconds}` });
  }
  return [...links, ...found].sort((a, b) => a.start - b.start);
}
