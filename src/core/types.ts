/**
 * Shapes shared by the app and the in-page engine.
 *
 * Everything in a RulesFile is data: path patterns, CSS selectors, short texts.
 * The rules file never contains code or CSS declarations. The app writes every
 * declaration itself, and the engine that applies the rules ships inside the app.
 * That way a compromised or broken rules URL can, at worst, hide the wrong
 * things. It can't run script in a logged-in page or leak data out of it.
 */

/** Bump when the engine learns a rule feature that older apps can't apply. */
export const ENGINE_VERSION = 2;

export interface RouteRule {
  id: string;
  /** Toggle that enables the rule. Omitted means always on. */
  toggle?: string;
  /** Toggle that switches the rule off again, e.g. "allowSharedReels" lets single reels through "blockReels". */
  unless?: string;
  /** Path globs: `*` = one segment, `**` = any number of segments. Case-insensitive, trailing slash ignored. */
  paths: string[];
  action: 'block' | 'redirect';
  /** For `redirect`: a path, optionally with a query, on the platform's own site. */
  to?: string;
}

export interface HideRule {
  id: string;
  toggle?: string;
  unless?: string;
  /** CSS selectors. Each is applied as its own CSS rule, so one bad selector can't break the others. */
  selectors: string[];
  /** `hide` removes the element; `collapse` keeps a thin labelled bar so you can see filtering is working. */
  mode?: 'hide' | 'collapse';
  /** Text shown in the collapsed bar. */
  label?: string;
  /** Only apply on these path globs. Omitted means everywhere. */
  paths?: string[];
}

export interface TextHideRule {
  id: string;
  toggle?: string;
  unless?: string;
  /** Exact texts (trimmed, case-insensitive) that mark something for hiding, e.g. "Suggested for you". */
  match: string[];
  /** Selectors tried in order with closest() from the text's element; the first ancestor found is hidden. */
  containers: string[];
  mode?: 'hide' | 'collapse';
  label?: string;
  paths?: string[];
}

export interface FeedLimitRule {
  id: string;
  toggle: string;
  /** Selector for one feed item. Items are counted in the order they first appear. */
  itemSelector: string;
  /** Feeds the limit applies to. */
  paths: string[];
}

export interface PlatformRules {
  routes: RouteRule[];
  hide: HideRule[];
  textHide: TextHideRule[];
  feedLimit?: FeedLimitRule;
}

export interface RulesFile {
  schemaVersion: 1;
  /** Monotonic. The app uses whichever valid copy (bundled, cached, remote) has the highest revision. */
  revision: number;
  /** Human-readable date of this revision. */
  updated: string;
  minEngineVersion: number;
  platforms: Record<string, PlatformRules>;
}

export type Toggles = Record<string, boolean>;

/** Everything the in-page engine needs, serialized into the injected script. */
export interface EnginePayload {
  /** Hosts where rules apply (e.g. www.instagram.com). Elsewhere, like the Facebook login page, the engine stays idle. */
  siteHosts: string[];
  /** Absolute URL to fall back to when a blocked page has nowhere better to go. */
  homeUrl: string;
  /** Path globs no rule may block (login, 2FA, DMs). */
  neverBlock: string[];
  rules: PlatformRules;
  toggles: Toggles;
  feedLimit: number;
}

/** Messages the page may post to the app. Treated as untrusted: the site's own scripts can post too. */
export type PageMessage =
  | { type: 'blocked'; ruleId: string; path: string }
  | { type: 'stats'; requestId: string; counts: Record<string, number> };

/**
 * A rule is active when it has no toggle or its toggle is on, and its `unless`
 * toggle (if any) is off. Apps older than engine v2 ignore `unless`, so for them
 * such a rule is simply always on with its toggle: stricter, never looser.
 */
export function isActive(rule: { toggle?: string; unless?: string }, toggles: Toggles): boolean {
  return (rule.toggle === undefined || toggles[rule.toggle] === true) && (rule.unless === undefined || toggles[rule.unless] !== true);
}
