/**
 * Full-screen reels: a tap on a reel (a video in the feed or on a post, or a
 * link to a single reel, e.g. one sent in a DM) opens it in the app's own
 * full-screen player instead of the small in-page one, the way the Instagram
 * app does. Only reels Lite Social lets through anyway: hidden videos aren't
 * tappable, and a link is only taken over when its page isn't blocked. The
 * swipe-for-more Reels viewer stays blocked.
 *
 * The reel's details come from Instagram's own media API, read in the page
 * with its session. The app gets only what the player shows: the video and
 * cover addresses on Instagram's CDN, the account name and picture, and the
 * caption. If that fails, the tap does what it did before.
 */
import type { PageMessage, ReelDetails } from '../core/types';
import { igJson, safeMediaUrl, USERNAME } from './igApi';

type ReelMessage = Extract<PageMessage, { type: 'reel' }>;

const SHORTCODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const SHORTCODE = /^[A-Za-z0-9_-]{5,64}$/;
/** /reel/<code>/ and /<user>/reel/<code>/ (a reel opened from a profile). Not /reels/: that's the endless viewer. */
const REEL_PATH = /^\/(?:[A-Za-z0-9._]+\/)?reels?\/([A-Za-z0-9_-]+)\/?$/;
const SINGLE_REEL_PATH = /^\/(?:[A-Za-z0-9._]+\/)?reel\/([A-Za-z0-9_-]+)\/?$/;
const POST_PATH = /^\/(?:[A-Za-z0-9._]+\/)?(?:p|reel)\/([A-Za-z0-9_-]+)\/?/;
/** Smaller videos are previews (a DM's reel card plays as a link instead). */
const MIN_VIDEO_WIDTH = 120;
const MAX_CAPTION = 2200;

export interface ReelViewerOptions {
  /** Whether the engine would let the page at this path open (not blocked by a rule). */
  allowed(path: string): boolean;
  /** Elements the engine hid or collapsed: their videos aren't tappable. */
  hiddenSelector: string;
  post(message: ReelMessage): void;
}

/** Installs the tap handler. `enabled()` is checked on every tap, so the setting applies live. */
export function installReelViewer(enabled: () => boolean, options: ReelViewerOptions): void {
  let counter = 0;

  document.addEventListener(
    'click',
    (event) => {
      try {
        if (!enabled() || event.defaultPrevented || event.button !== 0) return;
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;

        const link = target.closest('a[href]') as HTMLAnchorElement | null;
        const linkCode = link ? singleReelCode(link) : null;
        if (link && linkCode) {
          take(event);
          void open(linkCode, null, link.href);
          return;
        }

        const video = videoAt(event.clientX, event.clientY, target);
        if (!video || isSmallControl(target, video)) return;
        const code = codeFor(video);
        if (!code) return;
        take(event);
        void open(code, video, null);
      } catch {
        // Fail open: the tap does what Instagram does with it.
      }
    },
    true, // Before Instagram's own handlers.
  );

  function take(event: Event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  /** The reel code of a link to a single reel that would be allowed to open, or null. */
  function singleReelCode(link: HTMLAnchorElement): string | null {
    if (link.hostname && link.hostname !== location.hostname) return null;
    const match = SINGLE_REEL_PATH.exec(link.pathname);
    if (!match || !SHORTCODE.test(match[1]) || !options.allowed(link.pathname)) return null;
    return match[1];
  }

  /** The visible video under the tap (Instagram lays its own tap targets over its videos). */
  function videoAt(x: number, y: number, target: Element): HTMLVideoElement | null {
    const under = typeof document.elementsFromPoint === 'function' ? document.elementsFromPoint(x, y) : [target];
    for (const el of under) {
      if (!(el instanceof HTMLVideoElement)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < MIN_VIDEO_WIDTH || el.closest(options.hiddenSelector)) return null;
      return el;
    }
    return null;
  }

  /** Instagram's small buttons on a video (sound, tagged people) keep working. */
  function isSmallControl(target: Element, video: HTMLVideoElement): boolean {
    const control = target.closest('button, [role="button"], a[href], input, textarea, [contenteditable]');
    if (!control || control.contains(video)) return false;
    const c = control.getBoundingClientRect();
    const v = video.getBoundingClientRect();
    return c.width * c.height < 0.3 * v.width * v.height;
  }

  /** The post a video belongs to: its permalink inside the post, or the page's own address. */
  function codeFor(video: HTMLVideoElement): string | null {
    const article = video.closest('article');
    if (article) {
      for (const a of Array.from(article.querySelectorAll<HTMLAnchorElement>('a[href*="/p/"], a[href*="/reel/"]'))) {
        const match = POST_PATH.exec(a.pathname);
        if (match && SHORTCODE.test(match[1])) return match[1];
      }
    }
    const page = REEL_PATH.exec(location.pathname) ?? POST_PATH.exec(location.pathname);
    return page && SHORTCODE.test(page[1]) ? page[1] : null;
  }

  async function open(code: string, video: HTMLVideoElement | null, href: string | null) {
    const requestId = `r${++counter}`;
    pauseAll();
    options.post({ type: 'reel', requestId, state: 'loading' });
    try {
      const reel = await fetchReel(code, video);
      options.post({ type: 'reel', requestId, state: 'ready', reel });
    } catch {
      options.post({ type: 'reel', requestId, state: 'failed' });
      // What the tap would have done.
      if (href) location.assign(href);
      else if (video?.paused) void video.play().catch(() => undefined);
      else video?.pause();
    }
  }
}

function pauseAll() {
  document.querySelectorAll('video').forEach((v) => v.pause());
}

async function fetchReel(code: string, video: HTMLVideoElement | null): Promise<ReelDetails> {
  const id = mediaIdFromShortcode(code);
  let item: Record<string, unknown> | null = null;
  if (id) item = firstItem(await igJson(`/api/v1/media/${id}/info/`).catch(() => null));
  if (!item) item = firstItem(await igJson(`/p/${encodeURIComponent(code)}/?__a=1&__d=dis`).catch(() => null));
  if (!item) throw new Error('No media');
  const details = reelDetails(item, video?.poster ?? '');
  if (!details) throw new Error('Not a video');
  return details;
}

function firstItem(json: unknown): Record<string, unknown> | null {
  const items = (json as { items?: unknown } | null)?.items;
  return Array.isArray(items) && items[0] && typeof items[0] === 'object' ? (items[0] as Record<string, unknown>) : null;
}

/**
 * The playable details of a media item: its own video, or for a carousel the
 * video slide whose cover is the one on screen (else the first video slide).
 */
export function reelDetails(item: Record<string, unknown>, posterOnScreen = ''): ReelDetails | null {
  let media: Record<string, unknown> | null = Array.isArray(item.video_versions) ? item : null;
  if (!media && Array.isArray(item.carousel_media)) {
    const videos = (item.carousel_media as Record<string, unknown>[]).filter((m) => m && Array.isArray(m.video_versions));
    media = videos.find((m) => posterOnScreen && coverOf(m) && sameImage(coverOf(m), posterOnScreen)) ?? videos[0] ?? null;
  }
  if (!media) return null;
  const version = bestVersion(media.video_versions as Record<string, unknown>[]);
  const video = safeMediaUrl(version?.url);
  if (!video) return null;
  const user = (item.user ?? media.user) as Record<string, unknown> | undefined;
  const username = typeof user?.username === 'string' && USERNAME.test(user.username) ? user.username : '';
  const captionText = (item.caption as { text?: unknown } | null)?.text;
  return {
    video,
    poster: safeMediaUrl(coverOf(media)),
    width: dimension(version?.width ?? media.original_width),
    height: dimension(version?.height ?? media.original_height),
    username,
    avatar: safeMediaUrl(user?.profile_pic_url),
    caption: typeof captionText === 'string' ? captionText.slice(0, MAX_CAPTION) : '',
    duration: Number(media.video_duration) > 0 ? Number(media.video_duration) : 0,
  };
}

/** The sharpest version up to 1080 pixels wide (phones gain nothing from more), else the smallest. */
function bestVersion(versions: Record<string, unknown>[]): Record<string, unknown> | null {
  const valid = versions.filter((v) => v && typeof v.url === 'string');
  const width = (v: Record<string, unknown>) => Number(v.width) || 0;
  const fitting = valid.filter((v) => width(v) <= 1080).sort((a, b) => width(b) - width(a));
  return fitting[0] ?? valid.sort((a, b) => width(a) - width(b))[0] ?? null;
}

function coverOf(media: Record<string, unknown>): string {
  const candidates = (media.image_versions2 as { candidates?: { url?: unknown }[] } | undefined)?.candidates;
  const url = Array.isArray(candidates) ? candidates[0]?.url : undefined;
  return typeof url === 'string' ? url : '';
}

/** Two CDN addresses of the same picture (they differ in size and signature parameters). */
function sameImage(a: string, b: string): boolean {
  const file = (url: string) => url.split('?')[0].split('/').pop() ?? '';
  return file(a) !== '' && file(a) === file(b);
}

function dimension(value: unknown): number {
  const n = Math.round(Number(value));
  return n > 0 && n <= 10_000 ? n : 0;
}

/**
 * The numeric media id behind a post's shortcode (its base-64 digits), as a
 * decimal string: ids are bigger than JavaScript numbers hold exactly. Codes
 * longer than 11 characters (private accounts) carry the id in the first 11.
 */
export function mediaIdFromShortcode(code: string): string | null {
  const digits = [0]; // Decimal digits, least significant first.
  for (const ch of code.length > 11 ? code.slice(0, 11) : code) {
    let carry = SHORTCODE_ALPHABET.indexOf(ch);
    if (carry < 0) return null;
    for (let i = 0; i < digits.length; i++) {
      const value = digits[i] * 64 + carry;
      digits[i] = value % 10;
      carry = Math.floor(value / 10);
    }
    while (carry > 0) {
      digits.push(carry % 10);
      carry = Math.floor(carry / 10);
    }
  }
  const id = digits.reverse().join('').replace(/^0+(?=\d)/, '');
  return id === '0' ? null : id;
}
