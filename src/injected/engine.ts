/**
 * Lite Social in-page engine: layers 2 and 3 of blocking.
 *
 * scripts/build-engine.js bundles this file (and the src/core modules it
 * imports) into one string, src/injected/generated/engineSource.ts. The app
 * injects that string into every top-level page twice:
 *   - via injectedJavaScriptBeforeContentLoaded, as early as the platform
 *     allows (document start on iOS; page start on Android, which can race the
 *     site's own scripts), and
 *   - via injectedJavaScript after load, as a backstop. The second run finds
 *     the engine already installed and just re-applies the settings.
 *
 * What it does:
 *   1. Injects the stylesheet built by core/cssBuilder (layer 2) and keeps it attached.
 *   2. Watches the DOM with a single debounced MutationObserver (no polling or
 *      intervals) to handle what CSS can't express: hiding by text ("Suggested
 *      for you") and the feed length limit.
 *   3. Intercepts single-page-app navigation (history.pushState/replaceState,
 *      popstate, and the Navigation API where available). Client-side route
 *      changes, like tapping the Reels tab, never reach the app's
 *      onShouldStartLoadWithRequest, so this is the only layer that sees them.
 *   4. Pauses any video that starts playing inside something it hid. Hiding a
 *      <video> with CSS doesn't stop its sound.
 *
 * Privacy: the engine reads the page only to decide what to hide. All it ever
 * sends to the app is a 'blocked' event (rule id and path, never the query) and,
 * when asked, how many elements each rule matched. No text, cookies or content.
 *
 * Fail open: every entry point is wrapped in guard(), and each selector is
 * tried on its own. A broken rule or exception leaves the page usable, just
 * less filtered. The "Report a leak" button exists for exactly that case.
 */
import { buildCss, DEFAULT_COLLAPSE_LABEL, MARK } from '../core/cssBuilder';
import { type CompiledRoutes, compilePathPattern, compileRoutes, decideRoute, pathMatches } from '../core/routeMatcher';
import { type EnginePayload, isActive, type PageMessage, type TextHideRule } from '../core/types';
import { hostMatches, normalizePath } from '../core/urls';

interface EngineApi {
  apply(payload: EnginePayload): void;
  stats(requestId: string): void;
  pauseMedia(): void;
}

declare global {
  interface Window {
    __liteSocial?: EngineApi;
    ReactNativeWebView?: { postMessage(message: string): void };
  }
}

interface CompiledTextRule {
  rule: TextHideRule;
  texts: Set<string>;
  paths: RegExp[] | null;
}

const STYLE_ID = '__lite-social-style';
const LOOP_KEY = '__lite-social-nav';
/** Mutations arrive in bursts while the site renders; wait for a quiet moment... */
const DEBOUNCE_MS = 120;
/** ...but never longer than this, so a constantly-changing page still gets filtered. */
const MAX_WAIT_MS = 500;
/** Past this many changed subtrees in one batch, rescanning the whole document is cheaper. */
const MAX_PENDING_ROOTS = 300;
/** Text-hide phrases are short labels; skipping long text nodes skips scripts, captions and comments. */
const MAX_TEXT_LENGTH = 80;
const MARKED = `[${MARK.hide}],[${MARK.collapse}]`;

if (window.top === window && !window.__liteSocial) {
  window.__liteSocial = createEngine();
}

function createEngine(): EngineApi {
  let payload: EnginePayload | null = null;
  let payloadJson = '';
  let routes: CompiledRoutes | null = null;
  let textRules: CompiledTextRule[] = [];
  let feedPaths: RegExp[] = [];
  let style: HTMLStyleElement | null = null;
  let observer: MutationObserver | null = null;
  let hooksInstalled = false;

  let lastHref = '';
  let lastStylePath: string | null = null;
  let lastAllowedHref = location.href;

  const pending = new Set<Element>();
  let fullScan = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let firstPendingAt = 0;

  /** Container -> the text node that justified hiding it, re-checked on every pass. */
  const textMarks = new Map<Element, { node: Text; rule: CompiledTextRule }>();

  let feedKey = '';
  let feedSeen = new WeakMap<Element, number>();
  let feedCount = 0;

  const active = () => payload !== null && hostMatches(location.hostname, payload.siteHosts);

  function apply(next: EnginePayload) {
    guard(() => {
      if (!document.documentElement) {
        document.addEventListener('DOMContentLoaded', () => apply(next), { once: true });
        return;
      }
      const json = JSON.stringify(next);
      const changed = json !== payloadJson;
      if (changed) {
        payload = next;
        payloadJson = json;
        routes = compileRoutes(next.rules.routes, next.neverBlock);
        textRules = next.rules.textHide.filter((r) => isActive(r, next.toggles)).map(compileTextRule);
        feedPaths = next.rules.feedLimit ? next.rules.feedLimit.paths.map(compilePathPattern) : [];
      }
      if (!active()) {
        teardown();
        return;
      }
      installHooks();
      if (!observer) {
        observer = new MutationObserver(onMutations);
        observer.observe(document.documentElement, { childList: true, subtree: true });
      }
      if (changed) {
        unmarkAll(); // A toggle may have been switched off.
        lastStylePath = null;
        feedKey = '';
      }
      checkRoute(true); // A fresh page load (or new settings): redirects apply.
      refreshStyle();
      fullScan = true;
      schedule();
    });
  }

  function teardown() {
    observer?.disconnect();
    observer = null;
    style?.remove();
    unmarkAll();
  }

  // ---------------------------------------------------------------- styles

  function refreshStyle() {
    if (!payload) return;
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
    }
    const path = location.pathname;
    if (path !== lastStylePath) {
      lastStylePath = path; // Some rules are scoped to paths (e.g. the Explore grid).
      const css = buildCss(payload.rules, payload.toggles, path, payload.feedLimit);
      if (style.textContent !== css) style.textContent = css;
    }
    // Re-attach if the site replaced <head> or removed us during a re-render.
    if (!style.isConnected) (document.head || document.documentElement).appendChild(style);
  }

  // ------------------------------------------------------------ navigation

  function installHooks() {
    if (hooksInstalled) return;
    hooksInstalled = true;

    for (const method of ['pushState', 'replaceState'] as const) {
      const original = history[method];
      history[method] = function (this: History, ...args: Parameters<History['pushState']>) {
        const url = args[2];
        // pushState is the user moving somewhere. replaceState is usually the site tidying its own
        // URL, so only blocks apply to it; a redirect there could fight the site in a loop.
        if (url != null && intercept(String(url), method === 'pushState')) return; // Swallowed: we're reloading.
        return original.apply(this, args);
      };
    }

    window.addEventListener('popstate', () => guard(() => checkRoute(false)));

    // The Navigation API sees every navigation, including pushState calls made
    // through a reference the site grabbed before we patched history (possible
    // on Android, where injection can run late). Chrome 102+, Safari 26+.
    const navigation = (window as unknown as { navigation?: EventTarget }).navigation;
    navigation?.addEventListener('navigate', (event) =>
      guard(() => {
        const e = event as Event & { destination?: { url: string }; navigationType?: string; cancelable: boolean };
        if (e.destination && intercept(e.destination.url, e.navigationType === 'push') && e.cancelable) e.preventDefault();
      }),
    );

    // Hidden but still playing (CSS doesn't stop sound): pause it. Videos only;
    // <audio> elements are never rendered, so they'd always look hidden.
    document.addEventListener(
      'play',
      (event) =>
        guard(() => {
          const media = event.target;
          if (media instanceof HTMLVideoElement && active() && media.getClientRects().length === 0) {
            media.pause();
            media.muted = true;
          }
        }),
      true, // 'play' doesn't bubble, but capture listeners on document still see it.
    );
  }

  /**
   * Decide a navigation the page is about to make. True if it was blocked or
   * redirected. Redirect rules only apply when `allowRedirect` (user navigation).
   */
  function intercept(url: string, allowRedirect: boolean): boolean {
    let handled = false;
    guard(() => {
      if (!payload || !routes || !active()) return;
      // An anchor resolves relative URLs the same way the browser will, without
      // depending on window.URL (which a page can replace).
      const target = document.createElement('a');
      target.href = url;
      if (!hostMatches(target.hostname, payload.siteHosts)) return; // Other sites: the app's policy decides.
      const decision = decideRoute(target.pathname, target.search.slice(1), routes, payload.toggles);
      if (decision.type === 'allow' || (decision.type === 'redirect' && !allowRedirect)) return;
      handled = true;
      if (decision.type === 'block') {
        post({ type: 'blocked', ruleId: decision.ruleId, path: normalizePath(target.pathname) || '/' });
        // The site may already be rendering the blocked view; reload where we are.
        safeReplace(location.href);
      } else {
        safeReplace(target.origin + decision.to);
      }
    });
    return handled;
  }

  /**
   * Check the page we're on now: on load, after back/forward, or after a URL
   * change the hooks didn't see. Redirects only apply on load, for the same
   * reason as replaceState above.
   */
  function checkRoute(allowRedirect: boolean) {
    if (!payload || !routes || !active()) return;
    lastHref = location.href;
    const decision = decideRoute(location.pathname, location.search.slice(1), routes, payload.toggles);
    if (decision.type === 'allow' || (decision.type === 'redirect' && !allowRedirect)) {
      lastAllowedHref = location.href;
    } else if (decision.type === 'block') {
      post({ type: 'blocked', ruleId: decision.ruleId, path: normalizePath(location.pathname) || '/' });
      safeReplace(lastAllowedHref !== location.href ? lastAllowedHref : payload.homeUrl);
    } else {
      safeReplace(location.origin + decision.to);
    }
  }

  /**
   * location.replace with a loop guard: if we keep sending the page to the same
   * URL in quick succession, a rule is probably wrong (say, the home page got
   * blocked). Stop and leave the page alone rather than reload forever.
   */
  function safeReplace(url: string) {
    try {
      const now = Date.now();
      const prev = JSON.parse(sessionStorage.getItem(LOOP_KEY) || 'null') as { url: string; at: number; n: number } | null;
      const n = prev && prev.url === url && now - prev.at < 4000 ? prev.n + 1 : 1;
      if (n > 3) return;
      sessionStorage.setItem(LOOP_KEY, JSON.stringify({ url, at: now, n }));
    } catch {
      // Storage unavailable: proceed without the guard.
    }
    location.replace(url);
  }

  // ------------------------------------------------------- DOM observation

  function onMutations(records: MutationRecord[]) {
    for (const record of records) {
      record.addedNodes.forEach((node) => {
        const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
        if (!element) return;
        if (pending.size < MAX_PENDING_ROOTS) pending.add(element);
        else fullScan = true;
      });
    }
    schedule();
  }

  function schedule() {
    const now = Date.now();
    if (firstPendingAt === 0) firstPendingAt = now;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(flush, now - firstPendingAt >= MAX_WAIT_MS ? 0 : DEBOUNCE_MS);
  }

  function flush() {
    timer = undefined;
    firstPendingAt = 0;
    guard(() => {
      if (!active()) return;
      if (location.href !== lastHref) checkRoute(false); // Backstop for navigations the hooks didn't see.
      refreshStyle();

      const roots = fullScan ? [document.documentElement] : Array.from(pending);
      pending.clear();
      fullScan = false;

      revalidateTextMarks();
      const rules = textRules.filter((r) => !r.paths || pathMatches(location.pathname, r.paths));
      if (rules.length > 0) for (const root of roots) if (root.isConnected) scanText(root, rules);
      applyFeedLimit();
    });
  }

  // ------------------------------------------------------------ text hide

  function compileTextRule(rule: TextHideRule): CompiledTextRule {
    return {
      rule,
      texts: new Set(rule.match.map((t) => t.trim().toLowerCase())),
      paths: rule.paths ? rule.paths.map(compilePathPattern) : null,
    };
  }

  function textKey(node: Node): string {
    const value = node.nodeValue;
    return value && value.length <= MAX_TEXT_LENGTH ? value.trim().toLowerCase() : '';
  }

  function scanText(root: Element, rules: CompiledTextRule[]) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const key = textKey(node);
      if (!key) continue;
      for (const compiled of rules) {
        if (!compiled.texts.has(key)) continue;
        const parent = node.parentElement;
        if (!parent || parent.closest(MARKED)) break; // Already hidden.
        const container = findContainer(parent, compiled.rule.containers);
        if (container) {
          mark(container, compiled.rule);
          textMarks.set(container, { node: node as Text, rule: compiled });
          break;
        }
      }
    }
  }

  function findContainer(from: Element, selectors: string[]): Element | null {
    for (const selector of selectors) {
      let candidate: Element | null = null;
      try {
        candidate = from.closest(selector);
      } catch {
        continue; // Selector the browser doesn't understand: try the next one.
      }
      if (candidate && isSafeContainer(candidate)) return candidate;
    }
    return null;
  }

  /** Never hide something big enough to take the page down with it if a selector climbs too far. */
  function isSafeContainer(el: Element): boolean {
    return (
      el !== document.documentElement &&
      el !== document.body &&
      el.tagName !== 'MAIN' &&
      el.querySelector('main') === null &&
      el.querySelectorAll('article').length < 2
    );
  }

  /** Sites reuse DOM nodes. Unhide anything whose justifying text has gone or changed. */
  function revalidateTextMarks() {
    textMarks.forEach(({ node, rule }, container) => {
      if (!container.isConnected) {
        textMarks.delete(container);
      } else if (!node.isConnected || !container.contains(node) || !rule.texts.has(textKey(node))) {
        unmark(container);
        textMarks.delete(container);
      }
    });
  }

  function mark(el: Element, rule: { id: string; mode?: 'hide' | 'collapse'; label?: string }) {
    el.setAttribute(MARK.rule, rule.id);
    if (rule.mode === 'collapse') el.setAttribute(MARK.collapse, rule.label || DEFAULT_COLLAPSE_LABEL);
    else el.setAttribute(MARK.hide, '');
  }

  function unmark(el: Element) {
    el.removeAttribute(MARK.rule);
    el.removeAttribute(MARK.hide);
    el.removeAttribute(MARK.collapse);
  }

  function unmarkAll() {
    document.querySelectorAll(`[${MARK.rule}]`).forEach(unmark);
    document.querySelectorAll(`[${MARK.limit}]`).forEach((el) => el.removeAttribute(MARK.limit));
    textMarks.clear();
  }

  // ------------------------------------------------------------ feed limit

  /**
   * Counts feed items in the order they first appear and marks everything past
   * the limit. The first item past it shows the "all caught up" card (CSS);
   * the rest are hidden. Counting by first appearance means re-rendered items
   * keep their place instead of resetting the count.
   */
  function applyFeedLimit() {
    if (!payload) return;
    const rule = payload.rules.feedLimit;
    const on = !!rule && isActive(rule, payload.toggles) && pathMatches(location.pathname, feedPaths);
    const key = on ? `${location.pathname}|${payload.feedLimit}` : '';
    if (key !== feedKey) {
      feedKey = key;
      feedSeen = new WeakMap();
      feedCount = 0;
      document.querySelectorAll(`[${MARK.limit}]`).forEach((el) => el.removeAttribute(MARK.limit));
    }
    if (!on || !rule) return;

    let items: Element[];
    try {
      items = Array.from(document.querySelectorAll(rule.itemSelector));
    } catch {
      return;
    }
    const limit = payload.feedLimit;
    for (const item of items) {
      let index = feedSeen.get(item);
      if (index === undefined) {
        index = feedCount++;
        feedSeen.set(item, index);
      }
      const want = index < limit ? null : index === limit ? 'first' : 'rest';
      if (item.getAttribute(MARK.limit) !== want) {
        if (want) item.setAttribute(MARK.limit, want);
        else item.removeAttribute(MARK.limit);
      }
    }
  }

  // ---------------------------------------------------------------- misc

  function stats(requestId: string) {
    guard(() => {
      if (!payload || !active()) return post({ type: 'stats', requestId, counts: {} });
      const counts: Record<string, number> = {};
      const path = location.pathname;
      for (const rule of payload.rules.hide) {
        if (!isActive(rule, payload.toggles)) continue;
        if (rule.paths && !pathMatches(path, rule.paths.map(compilePathPattern))) continue;
        let n = 0;
        for (const selector of rule.selectors) {
          try {
            n += document.querySelectorAll(selector).length;
          } catch {
            // Invalid selector: contributes nothing.
          }
        }
        counts[rule.id] = n;
      }
      for (const { rule } of textRules) {
        counts[rule.id] = document.querySelectorAll(`[${MARK.rule}="${rule.id}"]`).length;
      }
      const feed = payload.rules.feedLimit;
      if (feed && isActive(feed, payload.toggles)) counts[feed.id] = document.querySelectorAll(`[${MARK.limit}]`).length;
      post({ type: 'stats', requestId, counts });
    });
  }

  function pauseMedia() {
    guard(() => document.querySelectorAll('video, audio').forEach((m) => (m as HTMLMediaElement).pause()));
  }

  return { apply, stats, pauseMedia };
}

function post(message: PageMessage) {
  try {
    window.ReactNativeWebView?.postMessage(JSON.stringify(message));
  } catch {
    // Not running inside the app (e.g. tests): nothing to tell.
  }
}

function guard(fn: () => void) {
  try {
    fn();
  } catch {
    // Fail open: the page keeps working, just less filtered.
  }
}
