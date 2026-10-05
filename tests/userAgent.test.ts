import { FALLBACK_USER_AGENTS, toMobileBrowserUserAgent } from '@/webview/userAgent';

describe('toMobileBrowserUserAgent', () => {
  describe('android', () => {
    it('strips the WebView markers from a full device UA', () => {
      const webView =
        'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36';
      expect(toMobileBrowserUserAgent(webView, 'android')).toBe(
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.6668.100 Mobile Safari/537.36',
      );
    });

    it('handles the reduced UA format', () => {
      const webView =
        'Mozilla/5.0 (Linux; Android 10; K; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36';
      expect(toMobileBrowserUserAgent(webView, 'android')).toBe(
        'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
      );
    });

    it('keeps the real engine version', () => {
      const result = toMobileBrowserUserAgent(
        'Mozilla/5.0 (Linux; Android 15; SM-S921B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/151.0.7000.12 Mobile Safari/537.36',
        'android',
      );
      expect(result).toContain('Chrome/151.0.7000.12');
      expect(result).not.toMatch(/\bwv\b|Version\/4\.0/);
    });

    it('falls back when the UA is missing or not Android Chrome', () => {
      expect(toMobileBrowserUserAgent(null, 'android')).toBe(FALLBACK_USER_AGENTS.android);
      expect(toMobileBrowserUserAgent('', 'android')).toBe(FALLBACK_USER_AGENTS.android);
      expect(toMobileBrowserUserAgent('SomethingElse/1.0', 'android')).toBe(FALLBACK_USER_AGENTS.android);
    });
  });

  describe('ios', () => {
    it('adds the Safari tokens to a WKWebView UA', () => {
      const webView =
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
      expect(toMobileBrowserUserAgent(webView, 'ios')).toBe(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
      );
    });

    it('uses major.minor for the Safari version when the OS has a patch number', () => {
      const webView =
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
      expect(toMobileBrowserUserAgent(webView, 'ios')).toContain('Version/17.5 Mobile/15E148 Safari/604.1');
    });

    it('adds a Mobile token if the WebView UA has none', () => {
      const webView = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)';
      expect(toMobileBrowserUserAgent(webView, 'ios')).toBe(`${webView} Version/18.0 Mobile/15E148 Safari/604.1`);
    });

    it('leaves an existing Safari UA alone', () => {
      expect(toMobileBrowserUserAgent(FALLBACK_USER_AGENTS.ios, 'ios')).toBe(FALLBACK_USER_AGENTS.ios);
    });

    it('falls back for non-iPhone UAs such as the desktop-class iPad UA', () => {
      const iPad = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)';
      expect(toMobileBrowserUserAgent(iPad, 'ios')).toBe(FALLBACK_USER_AGENTS.ios);
      expect(toMobileBrowserUserAgent(undefined, 'ios')).toBe(FALLBACK_USER_AGENTS.ios);
    });
  });
});
