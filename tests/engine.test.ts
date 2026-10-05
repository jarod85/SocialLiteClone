/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://www.instagram.com/"}
 */
/**
 * The in-page engine against a hand-written stand-in for Instagram's DOM.
 * jsdom has no layout and only partial :has() support, so this covers the
 * engine's JavaScript (marks, feed limit, navigation interception, messages),
 * not how the CSS renders. That part needs the device checklist.
 */
import { MARK } from '@/core/cssBuilder';
import type { EnginePayload, PageMessage } from '@/core/types';
// Importing the source installs the engine on window, the same way the injected bundle does.
import '@/injected/engine';

const posted: PageMessage[] = [];
// The engine looks this up each time it posts, so setting it after the import is fine.
window.ReactNativeWebView = { postMessage: (m: string) => posted.push(JSON.parse(m)) };
const engine = window.__liteSocial!;

const payload = (overrides: Partial<EnginePayload> = {}): EnginePayload => ({
  siteHosts: ['www.instagram.com'],
  homeUrl: 'https://www.instagram.com/',
  neverBlock: ['/direct/**'],
  feedLimit: 3,
  toggles: { blockReels: true, hideSuggested: true, limitFeed: true },
  rules: {
    routes: [{ id: 'reels-pages', toggle: 'blockReels', action: 'block', paths: ['/reels/**', '/reel/**'] }],
    hide: [{ id: 'reels-tab', toggle: 'blockReels', selectors: ['a[href^="/reels/"]'] }],
    textHide: [
      {
        id: 'suggested-posts',
        toggle: 'hideSuggested',
        match: ['Suggested for you'],
        containers: ['article', 'section'],
        mode: 'collapse',
        label: 'Suggestion hidden',
      },
    ],
    feedLimit: { id: 'feed-limit', toggle: 'limitFeed', itemSelector: 'article', paths: ['/', '/feed'] },
  },
  ...overrides,
});

/** The engine debounces DOM work; give it time to run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 250));

function article(text: string): HTMLElement {
  const el = document.createElement('article');
  el.innerHTML = `<header><span>${text}</span></header><div><img alt=""></div>`;
  return el;
}

let feed: HTMLElement;
beforeEach(async () => {
  posted.length = 0;
  document.body.innerHTML = '<main><nav><a href="/reels/">Reels</a></nav><div id="feed"></div></main>';
  feed = document.getElementById('feed')!;
  window.history.replaceState(null, '', '/');
  engine.apply(payload({ feedLimit: 3 + Math.random() })); // a fresh payload resets per-test state
  engine.apply(payload());
  await settle();
});

it('injects its stylesheet once and keeps it attached', async () => {
  const styles = document.querySelectorAll('#__lite-social-style');
  expect(styles).toHaveLength(1);
  expect(styles[0].textContent).toContain('a[href^="/reels/"]{display:none!important}');

  styles[0].remove();
  feed.appendChild(article('trigger a mutation'));
  await settle();
  expect(document.querySelectorAll('#__lite-social-style')).toHaveLength(1);
});

it('collapses posts labelled "Suggested for you" (case and whitespace insensitive)', async () => {
  const suggested = article('  suggested FOR you ');
  const normal = article('A friend posted');
  feed.append(normal, suggested);
  await settle();
  expect(suggested.getAttribute(MARK.collapse)).toBe('Suggestion hidden');
  expect(suggested.getAttribute(MARK.rule)).toBe('suggested-posts');
  expect(normal.hasAttribute(MARK.collapse)).toBe(false);
});

it('unhides a reused element once its label text changes', async () => {
  const post = article('Suggested for you');
  feed.appendChild(post);
  await settle();
  expect(post.hasAttribute(MARK.collapse)).toBe(true);

  // Sites reuse DOM nodes for different posts.
  post.querySelector('span')!.textContent = 'A friend posted';
  feed.appendChild(document.createElement('div')); // any mutation triggers a pass
  await settle();
  expect(post.hasAttribute(MARK.collapse)).toBe(false);
});

it('never hides a container big enough to take the page with it', async () => {
  // Matching text with no <article> around it: the only "section" ancestor wraps <main>.
  document.body.innerHTML = '<section><main><span>Suggested for you</span><article></article></main></section>';
  engine.apply(payload({ feedLimit: 9 }));
  await settle();
  expect(document.querySelector(`[${MARK.collapse}],[${MARK.hide}]`)).toBeNull();
});

it('ends the feed after the limit with one card, then hides the rest', async () => {
  const posts = [1, 2, 3, 4, 5].map((n) => article(`post ${n}`));
  feed.append(...posts);
  await settle();
  expect(posts.map((p) => p.getAttribute(MARK.limit))).toEqual([null, null, null, 'first', 'rest']);
});

it('does not limit feeds on other pages', async () => {
  window.history.pushState(null, '', '/natgeo/');
  const posts = [1, 2, 3, 4, 5].map((n) => article(`post ${n}`));
  feed.append(...posts);
  await settle();
  expect(posts.some((p) => p.hasAttribute(MARK.limit))).toBe(false);
});

it('swallows client-side navigation to a blocked route and reports it', () => {
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined); // jsdom can't navigate
  window.history.pushState(null, '', '/reels/');
  expect(window.location.pathname).toBe('/');
  expect(posted).toContainEqual({ type: 'blocked', ruleId: 'reels-pages', path: '/reels' });
  consoleError.mockRestore();
});

it('lets allowed navigation through, including neverBlock paths', () => {
  window.history.pushState(null, '', '/p/abc/');
  expect(window.location.pathname).toBe('/p/abc/');
  window.history.pushState(null, '', '/direct/inbox/');
  expect(window.location.pathname).toBe('/direct/inbox/');
  expect(posted.filter((m) => m.type === 'blocked')).toEqual([]);
});

it('applies redirects to user navigation but not to the site rewriting its own URL', () => {
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined); // jsdom can't navigate
  window.history.pushState(null, '', '/p/abc/');
  const base = payload();
  engine.apply({
    ...base,
    rules: { ...base.rules, routes: [{ id: 'following-feed', action: 'redirect', paths: ['/'], to: '/?variant=following' }] },
  });

  // replaceState: the site tidying its URL (e.g. dropping ?variant=following) is left alone.
  window.history.replaceState(null, '', '/');
  expect(window.location.pathname).toBe('/');

  // pushState: the user heading to the home feed gets sent to the Following feed instead.
  window.history.pushState(null, '', '/p/xyz/');
  window.history.pushState(null, '', '/');
  expect(window.location.pathname).toBe('/p/xyz/');
  consoleError.mockRestore();
});

it('stops intercepting when the toggle is switched off live', () => {
  engine.apply(payload({ toggles: { blockReels: false } }));
  window.history.pushState(null, '', '/reels/');
  expect(window.location.pathname).toBe('/reels/');
  expect(document.getElementById('__lite-social-style')!.textContent).not.toContain('/reels/');
});

it('clears its marks when a rule is switched off', async () => {
  const post = article('Suggested for you');
  feed.appendChild(post);
  await settle();
  expect(post.hasAttribute(MARK.collapse)).toBe(true);
  engine.apply(payload({ toggles: { blockReels: true, hideSuggested: false, limitFeed: true } }));
  expect(post.hasAttribute(MARK.collapse)).toBe(false);
});

it('answers stats requests with counts only', async () => {
  feed.appendChild(article('Suggested for you'));
  await settle();
  engine.stats('req-1');
  const stats = posted.find((m) => m.type === 'stats');
  expect(stats).toEqual({
    type: 'stats',
    requestId: 'req-1',
    counts: { 'reels-tab': 1, 'suggested-posts': 1, 'feed-limit': 0 },
  });
});

it('pauses a video that starts playing while hidden', () => {
  const pause = jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  const video = document.createElement('video');
  feed.appendChild(video); // jsdom has no layout, so every element reads as not rendered
  video.dispatchEvent(new Event('play'));
  expect(pause).toHaveBeenCalled();
  expect(video.muted).toBe(true);
  pause.mockRestore();
});
