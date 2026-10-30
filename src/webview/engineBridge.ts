/**
 * App-side half of the page <-> app bridge: builds the scripts we inject and
 * validates what the page posts back.
 */
import type { PlatformConfig } from '@/platforms/types';
import type { EnginePayload, PageMessage, PlatformRules, ReelDetails, Toggles } from '@/core/types';
import { parseUrl } from '@/core/urls';
import { ENGINE_SOURCE } from '@/injected/generated/engineSource';

export function buildPayload(
  platform: PlatformConfig,
  rules: PlatformRules,
  toggles: Toggles,
  feedLimit: number,
  homeUrl: string,
): EnginePayload {
  return {
    siteHosts: platform.siteHosts,
    homeUrl,
    neverBlock: platform.neverBlock,
    rules,
    toggles,
    feedLimit,
    reelViewer: toggles.fullscreenReels === true,
    pinchZoom: toggles.pinchZoom === true,
  };
}

/** JSON is valid JavaScript, so data goes into the page as a literal: no string-building of code. */
function callEngine(method: 'apply' | 'stats' | 'pauseMedia', arg?: unknown): string {
  const args = arg === undefined ? '' : JSON.stringify(arg);
  return `(function(){var e=window.__liteSocial;if(e)e.${method}(${args});})();`;
}

/** Installs the engine (if needed) and applies the payload. Injected before and after each page load. */
export function bootScript(payload: EnginePayload): string {
  return `${ENGINE_SOURCE};\n${callEngine('apply', payload)}\ntrue;`;
}

/** Re-applies changed settings to the current page without reloading it. */
export function applyScript(payload: EnginePayload): string {
  return `${callEngine('apply', payload)}true;`;
}

export function statsScript(requestId: string): string {
  return `${callEngine('stats', requestId)}true;`;
}

export const PAUSE_MEDIA_SCRIPT = `${callEngine('pauseMedia')}true;`;

/**
 * Parse a message from the page. The site's own scripts can call
 * ReactNativeWebView.postMessage too, so anything that isn't exactly one of our
 * message shapes, naming one of our rules, is ignored. A valid message can only
 * show the "blocked" notice, answer a stats request or play a reel from the
 * site's own CDN in the full-screen player; it can never change settings.
 */
export function parsePageMessage(data: string, knownRuleIds: ReadonlySet<string>): PageMessage | null {
  let message: unknown;
  try {
    message = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof message !== 'object' || message === null) return null;
  const m = message as Record<string, unknown>;

  if (m.type === 'blocked') {
    if (typeof m.ruleId !== 'string' || !knownRuleIds.has(m.ruleId)) return null;
    if (typeof m.path !== 'string' || m.path.length > 300) return null;
    return { type: 'blocked', ruleId: m.ruleId, path: m.path };
  }
  if (m.type === 'stats') {
    if (typeof m.requestId !== 'string' || typeof m.counts !== 'object' || m.counts === null) return null;
    const counts: Record<string, number> = {};
    for (const [ruleId, n] of Object.entries(m.counts as Record<string, unknown>)) {
      if (knownRuleIds.has(ruleId) && typeof n === 'number' && Number.isFinite(n)) counts[ruleId] = n;
    }
    return { type: 'stats', requestId: m.requestId, counts };
  }
  if (m.type === 'reel') {
    if (typeof m.requestId !== 'string' || !/^r\d{1,9}$/.test(m.requestId)) return null;
    if (m.state === 'loading' || m.state === 'failed') return { type: 'reel', requestId: m.requestId, state: m.state };
    if (m.state !== 'ready') return null;
    const reel = parseReel(m.reel);
    return reel ? { type: 'reel', requestId: m.requestId, state: 'ready', reel } : null;
  }
  return null;
}

/** Instagram's image and video CDN. The player only ever loads from there. */
const MEDIA_HOST = /(^|\.)(cdninstagram\.com|fbcdn\.net)$/i;

function mediaUrl(value: unknown, required: boolean): string | null {
  if (value === '' && !required) return '';
  if (typeof value !== 'string' || value.length > 4000) return null;
  const url = parseUrl(value);
  // No credentials or spaces: a plain https address on the CDN.
  return url && url.scheme === 'https' && MEDIA_HOST.test(url.host) && !/[\s@\\]/.test(value.split('?')[0]) ? value : null;
}

function parseReel(value: unknown): ReelDetails | null {
  if (typeof value !== 'object' || value === null) return null;
  const r = value as Record<string, unknown>;
  const video = mediaUrl(r.video, true);
  const poster = mediaUrl(r.poster, false);
  const avatar = mediaUrl(r.avatar, false);
  if (video === null || poster === null || avatar === null) return null;
  const number = (n: unknown, max: number) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= max ? n : 0);
  const username = typeof r.username === 'string' && /^[A-Za-z0-9._]{0,30}$/.test(r.username) ? r.username : '';
  const caption = typeof r.caption === 'string' ? r.caption.slice(0, 2200) : '';
  return {
    video,
    poster,
    avatar,
    username,
    caption,
    width: number(r.width, 10_000),
    height: number(r.height, 10_000),
    duration: number(r.duration, 24 * 3600),
  };
}

export function ruleIds(rules: PlatformRules): Set<string> {
  const ids = new Set<string>();
  for (const r of rules.routes) ids.add(r.id);
  for (const r of rules.hide) ids.add(r.id);
  for (const r of rules.textHide) ids.add(r.id);
  if (rules.feedLimit) ids.add(rules.feedLimit.id);
  return ids;
}
