/**
 * Layer 1 of blocking: what to do with a navigation the WebView is about to
 * make (onShouldStartLoadWithRequest). Pure, so it's unit-tested directly.
 */
import { type CompiledRoutes, decideRoute } from './routeMatcher';
import type { Toggles } from './types';
import { hostMatches, normalizePath, originOf, parseUrl } from './urls';

export type NavigationDecision =
  | { type: 'allow' }
  /** Stay on the current page and tell the user why. */
  | { type: 'block'; ruleId: string; path: string }
  /** Load `url` instead. */
  | { type: 'redirect'; ruleId: string; url: string }
  /** Leave the app's browser: open in the system browser / mail / phone app. */
  | { type: 'external'; url: string }
  /** Drop silently (deep links into the platform's native app, unknown schemes). */
  | { type: 'deny' };

export interface NavigationContext {
  /** Hosts that load inside the WebView (site, CDN redirectors, login providers). */
  allowedHosts: readonly string[];
  /** Hosts the route rules apply to. A subset of allowedHosts. */
  siteHosts: readonly string[];
  baseUrl: string;
  routes: CompiledRoutes;
  toggles: Toggles;
}

/** Schemes the system should handle (compose an email, dial a number). */
const HANDOFF_SCHEMES = new Set(['mailto', 'tel', 'sms']);
/** In-page pseudo-navigations that never leave the WebView. */
const INERT_SCHEMES = new Set(['about', 'data', 'blob', 'javascript']);

export function decideNavigation(url: string, isTopFrame: boolean, ctx: NavigationContext): NavigationDecision {
  const parsed = parseUrl(url);
  if (!parsed) return { type: 'allow' }; // Not a URL we understand: fail open, the WebView will deal with it.

  if (INERT_SCHEMES.has(parsed.scheme)) return { type: 'allow' };
  if (HANDOFF_SCHEMES.has(parsed.scheme)) return isTopFrame ? { type: 'external', url } : { type: 'deny' };
  // Everything else that isn't http(s) is a deep link like instagram://, intent:// or market://.
  // Following those would bounce you into the platform's own app, which defeats the point.
  if (parsed.scheme !== 'http' && parsed.scheme !== 'https') return { type: 'deny' };

  // Only top-level navigation is policed. Frames (captchas, embeds, login widgets) load normally.
  if (!isTopFrame) return { type: 'allow' };

  if (!hostMatches(parsed.host, ctx.allowedHosts)) return { type: 'external', url };
  if (!hostMatches(parsed.host, ctx.siteHosts)) return { type: 'allow' };

  const route = decideRoute(parsed.path, parsed.query, ctx.routes, ctx.toggles);
  switch (route.type) {
    case 'allow':
      return route;
    case 'block':
      return { type: 'block', ruleId: route.ruleId, path: normalizePath(parsed.path) || '/' };
    case 'redirect':
      return { type: 'redirect', ruleId: route.ruleId, url: resolveSitePath(ctx.baseUrl, route.to) };
  }
}

/** Where the WebView should start: the base URL, unless a redirect rule (e.g. following feed) applies to it. */
export function initialUrl(ctx: NavigationContext): string {
  const decision = decideNavigation(ctx.baseUrl, true, ctx);
  return decision.type === 'redirect' ? decision.url : ctx.baseUrl;
}

export function resolveSitePath(baseUrl: string, path: string): string {
  return `${originOf(baseUrl)}${path.startsWith('/') ? '' : '/'}${path}`;
}
