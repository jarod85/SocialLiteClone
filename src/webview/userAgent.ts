/**
 * User-agent handling for the platform WebView.
 *
 * Why we touch the user agent at all: sites like Instagram serve degraded pages,
 * login walls or "open in the app" interstitials to embedded WebViews, and the
 * main thing they key on is the UA string:
 *   - Android System WebView adds a "; wv" token and a fake "Version/4.0" token.
 *   - iOS WKWebView omits Safari's "Version/x.y" and "Safari/604.1" tokens.
 *
 * Rather than hardcoding a browser UA that goes stale (and lies about the engine
 * version, which breaks sites' feature detection), we start from the device's
 * real WebView UA and only remove or add those embedding markers. The result
 * matches the stock mobile browser on the same OS and engine version.
 *
 * This module is pure so it can be unit-tested; the React hook that fetches the
 * device's default UA lives in useBrowserUserAgent.ts.
 */

export type MobileOS = 'ios' | 'android';

/**
 * Used only when the device's WebView UA can't be read or doesn't look like a
 * phone (e.g. iPad WebViews report a desktop Mac UA). Update occasionally.
 */
export const FALLBACK_USER_AGENTS: Record<MobileOS, string> = {
  ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  android:
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
};

/** Turn the device's default WebView UA into the equivalent mobile-browser UA. */
export function toMobileBrowserUserAgent(webViewUserAgent: string | null | undefined, os: MobileOS): string {
  if (!webViewUserAgent) return FALLBACK_USER_AGENTS[os];
  return os === 'ios' ? toMobileSafari(webViewUserAgent) : toMobileChrome(webViewUserAgent);
}

/**
 * WKWebView: "...(KHTML, like Gecko) Mobile/15E148"
 * Safari:    "...(KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1"
 */
function toMobileSafari(ua: string): string {
  const osVersion = ua.match(/iPhone OS (\d+)_(\d+)/);
  if (!osVersion) return FALLBACK_USER_AGENTS.ios;
  if (/ Safari\//.test(ua)) return ua; // Already a Safari-style UA.

  const versionToken = `Version/${osVersion[1]}.${osVersion[2]}`;
  const withVersion = / Mobile\/\w+/.test(ua)
    ? ua.replace(/ (Mobile\/\w+)/, ` ${versionToken} $1`)
    : `${ua} ${versionToken} Mobile/15E148`;
  return `${withVersion} Safari/604.1`;
}

/**
 * Android WebView: "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240805.005; wv)
 *                   AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36"
 * Chrome:          "Mozilla/5.0 (Linux; Android 14; Pixel 8)
 *                   AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.6668.100 Mobile Safari/537.36"
 */
function toMobileChrome(ua: string): string {
  if (!/Android/.test(ua) || !/Chrome\/\d+/.test(ua)) return FALLBACK_USER_AGENTS.android;
  return ua
    .replace(/;\s*wv(?=\))/, '') // WebView marker
    .replace(/ Build\/[^;)]+/, '') // Chrome dropped the build id years ago
    .replace(/Version\/\d+(?:\.\d+)* /, '') // WebView's fake Version/4.0 token
    .replace(/\s{2,}/g, ' ')
    .trim();
}
