import type { MobileOS } from '@/webview/userAgent';

/**
 * Code-side description of a supported platform.
 *
 * These fields are bundled with the app and reviewed in code; the remote rules
 * file (added in a later milestone) can never change them. That keeps a
 * compromised or broken rules URL from pointing the WebView at a different site
 * or altering how we identify ourselves to it.
 */
export interface PlatformConfig {
  /** Stable id used in routes, persisted settings and rules.json. Never rename. */
  id: string;
  /** Display name. */
  name: string;
  /** One-line description shown on the platform picker. */
  tagline: string;
  /** Where the WebView starts and where "Home" returns to. Must be the mobile site. */
  baseUrl: string;
  /**
   * Optional fixed user agent per OS. Omit it to use the device's own WebView
   * engine version presented as the stock mobile browser (see webview/userAgent.ts),
   * which is the right choice for nearly every site.
   */
  userAgent?: Partial<Record<MobileOS, string>>;
  /** Accent color for the platform's card on the picker. */
  accentColor: string;
}
