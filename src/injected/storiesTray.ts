/**
 * A Stories tray for pages where the site leaves its own out: Instagram's
 * Following feed has no tray, so with "Following feed" on you'd never see
 * Stories at the top.
 *
 * It looks like Instagram's own: "Your story" first (with the + to add one),
 * then the people you follow, unwatched stories with the coloured ring
 * (green for Close Friends), watched ones with a thin grey ring.
 *
 * The list comes from Instagram's own API, fetched from inside the page with
 * the page's session, the same request instagram.com makes for its tray. It
 * never reaches the app. Each entry is a plain link to /stories/<username>/,
 * the page Instagram's own tray opens.
 *
 * The tray lives in a shadow root: the site's styles can't restyle it,
 * our hide rules and text scan can't see into it, and the feed limit doesn't
 * count it. It sits just above the list that holds the feed items, outside
 * it: Instagram renders only the posts near the screen and pads the list for
 * the rest, and anything inside that list would move with its window of
 * posts and throw its scroll position off.
 */
import { cookie, igJson, safeMediaUrl, USERNAME } from './igApi';

const HOST_ID = '__lite-social-stories';
const TRAY_PATH = '/api/v1/feed/reels_tray/';
const ME_KEY = '__lite-social-me';
/** Re-read the tray when the feed is shown again after this long, so watched stories turn grey. */
const STALE_MS = 5 * 60_000;
/** After a failed read, wait this long before trying again. */
const RETRY_MS = 60_000;
const MAX_ITEMS = 100;
/** Where "Your story" goes when you have none: Instagram's story camera. */
const CREATE_STORY_PATH = '/create/story/';

const STYLE = `
:host{display:block!important;width:100%;box-sizing:border-box;contain:content;border-bottom:1px solid var(--ls-line,rgba(128,128,128,.22))}
.row{display:flex;overflow-x:auto;padding:10px 6px 10px;scrollbar-width:none;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain}
.row::-webkit-scrollbar{display:none}
a{flex:0 0 auto;width:84px;color:inherit;text-decoration:none;text-align:center;font:12px/16px -apple-system,system-ui,"Segoe UI",Roboto,sans-serif;-webkit-tap-highlight-color:transparent}
a:active .ring{transform:scale(.96)}
.ring{position:relative;display:block;width:72px;height:72px;margin:0 auto 5px;padding:1px;border-radius:50%;box-sizing:border-box;background:var(--ls-seen,rgba(128,128,128,.5));transition:transform .1s}
.unseen .ring{padding:3px;background:linear-gradient(45deg,#ffc107 0%,#f77737 25%,#e1306c 55%,#c13584 80%,#833ab4 100%)}
.unseen.besties .ring{background:linear-gradient(45deg,#14b04d,#3ddc72)}
.none .ring{padding:0;background:none}
.pic{display:block;width:100%;height:100%;border-radius:50%;box-sizing:border-box;border:5px solid var(--ls-bg,#fff);object-fit:cover;background:rgba(128,128,128,.25)}
.unseen .pic{border-width:3px}
.none .pic{border:0;padding:6px;background-clip:content-box}
.plus{position:absolute;right:2px;bottom:2px;width:22px;height:22px;border-radius:50%;box-sizing:border-box;border:2px solid var(--ls-bg,#fff);background:#0095f6;color:#fff;font:600 17px/17px system-ui,sans-serif;text-align:center}
.name{display:block;max-width:76px;margin:0 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.me .name{opacity:.6}
`;

interface TrayItem {
  username: string;
  picture: string;
  unseen: boolean;
  /** Close Friends story: green ring. */
  besties: boolean;
}

interface Me {
  username: string;
  picture: string;
}

export interface StoriesTray {
  /**
   * Show the tray above the list holding `anchor` items, or remove it when
   * `anchor` is null. Called on every DOM pass, so it's cheap when nothing changed.
   */
  update(anchor: string | null): void;
  remove(): void;
}

/** `onLoaded` runs after the tray data arrives, so the caller can place it. */
export function createStoriesTray(onLoaded: () => void): StoriesTray {
  let host: HTMLElement | null = null;
  let row: HTMLElement | null = null;
  let items: TrayItem[] | null = null;
  let me: Me | null = readMe();
  let loadedAt = 0;
  let failedAt = 0;
  let loading = false;
  let renderedFor: TrayItem[] | null = null;
  /** The feed list the tray sits above. Kept until it's gone, so the tray never hops around. */
  let placedAbove: Element | null = null;

  function update(anchor: string | null) {
    if (anchor === null) return remove();
    const now = Date.now();
    const stale = items === null || (now - loadedAt > STALE_MS && document.visibilityState === 'visible');
    if (stale && !loading && now - failedAt > RETRY_MS) void load();
    if (!items || (items.length === 0 && !me)) return remove();

    if (!host) host = createHost();
    if (renderedFor !== items) render(items);
    if (host.isConnected && placedAbove?.isConnected && host.nextElementSibling === placedAbove) return;

    const list = feedList(anchor);
    const parent = list?.parentElement;
    if (!list || !parent) return; // Feed not rendered yet (or between pages): leave the tray where it is.
    placedAbove = list;
    if (host.nextElementSibling === list) return;
    host.style.setProperty('--ls-bg', backgroundOf(list));
    parent.insertBefore(host, list);
  }

  function remove() {
    host?.remove();
    placedAbove = null;
  }

  async function load() {
    loading = true;
    try {
      const [tray] = await Promise.all([fetchTray(), me ? null : loadMe()]);
      items = parseTray(tray);
      loadedAt = Date.now();
    } catch {
      failedAt = Date.now(); // Not logged in, rate-limited or the API changed: no tray, nothing else breaks.
    } finally {
      loading = false;
      onLoaded();
    }
  }

  /** Your own name and picture, for "Your story". Optional: without them the tray just starts with others. */
  async function loadMe() {
    try {
      const id = cookie('ds_user_id');
      if (!/^\d{1,20}$/.test(id)) return;
      const user = ((await igJson(`/api/v1/users/${id}/info/`)) as { user?: Record<string, unknown> } | null)?.user;
      const username = user?.username;
      if (typeof username !== 'string' || !USERNAME.test(username)) return;
      me = { username, picture: safeMediaUrl(user?.profile_pic_url) };
      try {
        sessionStorage.setItem(ME_KEY, JSON.stringify(me));
      } catch {
        // No storage: asked again on the next page.
      }
    } catch {
      // Leave "Your story" out.
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
    const mine = me ? list.find((item) => item.username === me!.username) : undefined;
    if (me) row.appendChild(entry(mine ?? { ...me, unseen: false, besties: false }, mine ? 'story' : 'none', 'Your story'));
    for (const item of list) if (item !== mine) row.appendChild(entry(item, 'story', item.username));
  }

  /** One circle: 'story' links to the viewer, 'none' is your own picture with the + to add a story. */
  function entry(item: Pick<TrayItem, 'username' | 'picture' | 'unseen' | 'besties'>, kind: 'story' | 'none', label: string): HTMLElement {
    const link = document.createElement('a');
    link.href = kind === 'story' ? `/stories/${encodeURIComponent(item.username)}/` : CREATE_STORY_PATH;
    link.className = [kind === 'none' ? 'none' : item.unseen ? 'unseen' : 'seen', item.besties ? 'besties' : '', label === 'Your story' ? 'me' : '']
      .filter(Boolean)
      .join(' ');
    link.setAttribute('aria-label', label === 'Your story' ? 'Your story' : `Story by ${item.username}`);
    const ring = document.createElement('span');
    ring.className = 'ring';
    const pic = document.createElement('img');
    pic.className = 'pic';
    pic.alt = '';
    pic.decoding = 'async';
    pic.referrerPolicy = 'no-referrer';
    if (item.picture) pic.src = item.picture;
    ring.appendChild(pic);
    if (kind === 'none') {
      const plus = document.createElement('span');
      plus.className = 'plus';
      plus.textContent = '+';
      ring.appendChild(plus);
    }
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = label;
    link.append(ring, name);
    return link;
  }

  return { update, remove };
}

async function fetchTray(): Promise<unknown> {
  try {
    return await igJson(TRAY_PATH);
  } catch {
    // instagram.com itself POSTs this request; some sessions only answer that form.
    return igJson(TRAY_PATH, {
      method: 'POST',
      headers: { 'X-CSRFToken': cookie('csrftoken'), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'reason=cold_start&page_size=50',
    });
  }
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
    items.push({ username, picture: safeMediaUrl(user?.profile_pic_url), unseen: latest > seen, besties: reel.has_besties_media === true });
  }
  return items;
}

function readMe(): Me | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(ME_KEY) || 'null') as Me | null;
    return saved && typeof saved.username === 'string' && USERNAME.test(saved.username)
      ? { username: saved.username, picture: safeMediaUrl(saved.picture) }
      : null;
  } catch {
    return null;
  }
}

/**
 * The element that holds the feed items: the closest common ancestor of the
 * first two. With only one so far it waits, since that one's parent may just
 * be the post's own wrapper.
 */
function feedList(anchor: string): Element | null {
  let found: NodeListOf<Element>;
  try {
    found = document.querySelectorAll(anchor);
  } catch {
    return null;
  }
  if (found.length < 2) return null;
  let list = found[0].parentElement;
  while (list && !list.contains(found[1])) list = list.parentElement;
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
