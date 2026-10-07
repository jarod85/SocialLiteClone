/**
 * Recognizes YouTube links (shared from other apps, or pasted into search).
 * Pure, so the same rules are unit-tested and used by +native-intent.
 */

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
