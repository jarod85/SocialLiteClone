/**
 * Instagram's own web API, called from inside the page with the page's
 * session: the same requests instagram.com makes. Used by the Stories tray and
 * the full-screen reel player. Responses stay in the page except for what
 * those features hand the app (see reelViewer.ts).
 */

/** instagram.com's public web app id, used if the page doesn't tell us the one it uses. */
const FALLBACK_APP_ID = '936619743392459';
/** Sent by instagram.com with every API call. */
const ASBD_ID = '359341';
const APP_ID_PATTERNS = [/"X-IG-App-ID"\s*:\s*"(\d{6,20})"/, /"APP_ID"\s*:\s*"(\d{6,20})"/, /"appId"\s*:\s*"(\d{6,20})"/];
export const IMAGE_HOST = /(^|\.)(cdninstagram\.com|fbcdn\.net)$/i;
export const USERNAME = /^[A-Za-z0-9._]{1,30}$/;

export function apiHeaders(): Record<string, string> {
  return { 'X-IG-App-ID': appId(), 'X-ASBD-ID': ASBD_ID, 'X-Requested-With': 'XMLHttpRequest' };
}

/** GET (or the given request) on instagram.com, parsed as JSON. Throws on HTTP errors. */
export async function igJson(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(path, { credentials: 'include', ...init, headers: { ...apiHeaders(), ...(init.headers as Record<string, string>) } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  // Some of Instagram's endpoints guard their JSON against being run as a script.
  return JSON.parse((await response.text()).replace(/^for \(;;\);/, ''));
}

/** An https URL on Instagram's image and video hosts, or '' for anything else. */
export function safeMediaUrl(url: unknown): string {
  if (typeof url !== 'string') return '';
  const a = document.createElement('a');
  a.href = url;
  return a.protocol === 'https:' && IMAGE_HOST.test(a.hostname) ? a.href : '';
}

let cachedAppId = '';

/** The app id the page's own scripts send, found once per page. */
function appId(): string {
  if (cachedAppId) return cachedAppId;
  for (const script of Array.from(document.scripts)) {
    if (script.src) continue;
    const text = script.textContent || '';
    for (const pattern of APP_ID_PATTERNS) {
      const match = pattern.exec(text);
      if (match) return (cachedAppId = match[1]);
    }
  }
  return (cachedAppId = FALLBACK_APP_ID);
}

export function cookie(name: string): string {
  const match = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(document.cookie);
  return match ? decodeURIComponent(match[1]) : '';
}
