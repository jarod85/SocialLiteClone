/**
 * A Stories tray for pages where the site leaves its own out: Instagram's
 * Following feed has no tray, so with "Following feed" on you'd never see
 * Stories at the top.
 *
 * The list comes from Instagram's own API, fetched from inside the page with
 * the page's session, the same request instagram.com makes for its tray. It
 * never reaches the app. Each entry is a plain link to /stories/<username>/,
 * the page Instagram's own tray opens.
 *
 * The tray lives in a shadow root: the site's styles can't restyle it,
 * our hide rules and text scan can't see into it, and the feed limit doesn't
 * count it. It sits at the top of the list that holds the feed items, so it
 * scrolls with the feed.
 */

const HOST_ID = '__lite-social-stories';
const TRAY_PATH = '/api/v1/feed/reels_tray/';
/** instagram.com's public web app id, used if the page doesn't tell us the one it uses. */
const FALLBACK_APP_ID = '936619743392459';
/** Sent by instagram.com with every API call. */
const ASBD_ID = '359341';
/** Re-read the tray when the feed is shown again after this long, so watched stories turn grey. */
const STALE_MS = 5 * 60_000;
/** After a failed read, wait this long before trying again. */
const RETRY_MS = 60_000;
const MAX_ITEMS = 100;
const USERNAME = /^[A-Za-z0-9._]{1,30}$/;
const IMAGE_HOST = /(^|\.)(cdninstagram\.com|fbcdn\.net)$/i;
const APP_ID_PATTERNS = [/"X-IG-App-ID"\s*:\s*"(\d{6,20})"/, /"APP_ID"\s*:\s*"(\d{6,20})"/, /"appId"\s*:\s*"(\d{6,20})"/];

const STYLE = `
:host{display:block!important;contain:content}
.row{display:flex;gap:10px;overflow-x:auto;padding:10px 12px 8px;scrollbar-width:none;-webkit-overflow-scrolling:touch}
.row::-webkit-scrollbar{display:none}
a{flex:0 0 auto;width:68px;color:inherit;text-decoration:none;text-align:center;font:12px/1.3 -apple-system,system-ui,sans-serif;-webkit-tap-highlight-color:transparent}
.ring{width:64px;height:64px;margin:0 auto 4px;padding:2px;border-radius:50%;box-sizing:border-box;background:rgba(128,128,128,.45)}
.unseen .ring{padding:3px;background:linear-gradient(45deg,#feda75,#fa7e1e,#d62976,#962fbf,#4f5bd5)}
.pic{display:block;width:100%;height:100%;border-radius:50%;box-sizing:border-box;border:2px solid var(--ls-bg,#fff);object-fit:cover;background:rgba(128,128,128,.25)}
.name{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.seen .name{opacity:.65}
`;

interface TrayItem {
  username: string;
  picture: string;
  unseen: boolean;
}

export interface StoriesTray {
  /**
   * Show the tray at the top of the list holding `anchor` items, or remove it
   * when `anchor` is null. Called on every DOM pass, so it's cheap when nothing changed.
   */
  update(anchor: string | null): void;
  remove(): void;
}

/** `onLoaded` runs after the tray data arrives, so the caller can place it. */
export function createStoriesTray(onLoaded: () => void): StoriesTray {
  let host: HTMLElement | null = null;
  let row: HTMLElement | null = null;
  let items: TrayItem[] | null = null;
  let loadedAt = 0;
  let failedAt = 0;
  let loading = false;
  let renderedFor: TrayItem[] | null = null;

  function update(anchor: string | null) {
    if (anchor === null) return remove();
    const now = Date.now();
    const stale = items === null || (now - loadedAt > STALE_MS && document.visibilityState === 'visible');
    if (stale && !loading && now - failedAt > RETRY_MS) void load();
    if (!items || items.length === 0) return remove();

    const list = feedList(anchor);
    if (!list) return; // Feed not rendered yet (or between pages): leave the tray where it is.
    if (!host) host = createHost();
    if (renderedFor !== items) render(items);
    if (host.parentNode !== list || list.firstChild !== host) {
      host.style.setProperty('--ls-bg', backgroundOf(list));
      list.insertBefore(host, list.firstChild);
    }
  }

  function remove() {
    host?.remove();
  }

  async function load() {
    loading = true;
    try {
      items = parseTray(await fetchTray());
      loadedAt = Date.now();
    } catch {
      failedAt = Date.now(); // Not logged in, rate-limited or the API changed: no tray, nothing else breaks.
    } finally {
      loading = false;
      onLoaded();
    }
  }

  function createHost(): HTMLElement {
    const el = document.createElement('div');
    el.id = HOST_ID;
    const root = el.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    row = document.createElement('div');
    row.className = 'row';
    root.append(style, row);
    return el;
  }

  function render(list: TrayItem[]) {
    if (!row) return;
    renderedFor = list;
    row.textContent = '';
    for (const item of list) {
      const link = document.createElement('a');
      link.href = `/stories/${encodeURIComponent(item.username)}/`;
      link.className = item.unseen ? 'unseen' : 'seen';
      const ring = document.createElement('span');
      ring.className = 'ring';
      const pic = document.createElement('img');
      pic.className = 'pic';
      pic.alt = '';
      pic.decoding = 'async';
      pic.referrerPolicy = 'no-referrer';
      if (item.picture) pic.src = item.picture;
      ring.appendChild(pic);
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = item.username;
      link.append(ring, name);
      row.appendChild(link);
    }
  }

  return { update, remove };
}

async function fetchTray(): Promise<unknown> {
  const headers: Record<string, string> = {
    'X-IG-App-ID': appId(),
    'X-ASBD-ID': ASBD_ID,
    'X-Requested-With': 'XMLHttpRequest',
  };
  let response = await fetch(TRAY_PATH, { credentials: 'include', headers });
  if (!response.ok) {
    // instagram.com itself POSTs this request; some sessions only answer that form.
    response = await fetch(TRAY_PATH, {
      method: 'POST',
      credentials: 'include',
      headers: {
        ...headers,
        'X-CSRFToken': cookie('csrftoken'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'reason=cold_start&page_size=50',
    });
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  // Some of Instagram's endpoints guard their JSON against being run as a script.
  return JSON.parse((await response.text()).replace(/^for \(;;\);/, ''));
}

/** Only what the tray shows: usernames, picture URLs on Instagram's image hosts, and seen or not. */
export function parseTray(json: unknown): TrayItem[] {
  const tray = (json as { tray?: unknown } | null)?.tray;
  if (!Array.isArray(tray)) throw new Error('No tray');
  const items: TrayItem[] = [];
  for (const reel of tray.slice(0, MAX_ITEMS) as Record<string, unknown>[]) {
    const user = reel?.user as Record<string, unknown> | undefined;
    const username = user?.username;
    if (typeof username !== 'string' || !USERNAME.test(username) || reel.muted === true) continue;
    const latest = Number(reel.latest_reel_media) || 0;
    const seen = Number(reel.seen) || 0;
    items.push({ username, picture: safeImage(user?.profile_pic_url), unseen: latest > seen });
  }
  return items;
}

function safeImage(url: unknown): string {
  if (typeof url !== 'string') return '';
  const a = document.createElement('a');
  a.href = url;
  return a.protocol === 'https:' && IMAGE_HOST.test(a.hostname) ? a.href : '';
}

/**
 * The element that holds the feed items: the closest common ancestor of the
 * first two, or the first one's parent if there's only one so far.
 */
function feedList(anchor: string): Element | null {
  let found: NodeListOf<Element>;
  try {
    found = document.querySelectorAll(anchor);
  } catch {
    return null;
  }
  if (found.length === 0) return null;
  let list = found[0].parentElement;
  if (found.length > 1) while (list && !list.contains(found[1])) list = list.parentElement;
  return list && list !== document.body && list !== document.documentElement ? list : null;
}

/** The page's background behind the feed, for the gap between a story ring and its picture. */
function backgroundOf(from: Element): string {
  for (let el: Element | null = from; el; el = el.parentElement) {
    const color = getComputedStyle(el).backgroundColor;
    if (color && color !== 'transparent' && !/^rgba\(.*,\s*0\)$/.test(color)) return color;
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? '#000' : '#fff';
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

function cookie(name: string): string {
  const match = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(document.cookie);
  return match ? decodeURIComponent(match[1]) : '';
}
