import type { MobileOS } from '@/webview/userAgent';

/**
 * Code-side description of a supported platform.
 *
 * These fields are bundled with the app and reviewed in code; the remote rules
 * file can never change them. That keeps a compromised or broken rules URL from
 * pointing the WebView at a different site, widening where it may navigate, or
 * unblocking login and messages.
 *
 * The blocking rules themselves (routes, selectors, texts) live in
 * rules/rules.json under the same `id`.
 */
export interface PlatformConfig {
  /** Stable id used in routes, persisted settings and rules.json. Never rename. */
  id: string;
  /** Display name. */
  name: string;
  /** One-line description shown on the picker. */
  tagline: string;
  /** Where the WebView starts and where "Home" returns to. Must be the mobile site. */
  baseUrl: string;
  /** Hosts where the blocking rules apply. */
  siteHosts: string[];
  /**
   * Hosts allowed to load inside the WebView: the site plus whatever its login
   * and link redirectors need. Top-level navigation anywhere else opens in the
   * system browser. `*.example.com` matches subdomains.
   */
  allowedHosts: string[];
  /** Path globs no rule may ever block, so a bad rule can't break login, 2FA or DMs. */
  neverBlock: string[];
  /** Settings toggles. Rules reference them by id; the settings screen is generated from this list. */
  toggles: ToggleDefinition[];
  /**
   * Optional fixed user agent per OS. Omit it to use the device's own WebView
   * engine version presented as the stock mobile browser (see webview/userAgent.ts),
   * which is the right choice for nearly every site.
   */
  userAgent?: Partial<Record<MobileOS, string>>;
  /** Accent color for the platform's card on the picker. */
  accentColor: string;
}

export interface ToggleDefinition {
  id: string;
  label: string;
  description: string;
  default: boolean;
}
