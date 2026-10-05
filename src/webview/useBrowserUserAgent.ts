import Constants from 'expo-constants';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { type MobileOS, toMobileBrowserUserAgent } from './userAgent';

const os: MobileOS = Platform.OS === 'ios' ? 'ios' : 'android';

// The default WebView UA can't change while the app runs, so look it up once.
let defaultUserAgent: Promise<string | null> | undefined;
function getDefaultWebViewUserAgent(): Promise<string | null> {
  defaultUserAgent ??= Constants.getWebViewUserAgentAsync().catch(() => null);
  return defaultUserAgent;
}

/**
 * Resolves the user agent the platform WebView should send. Returns null until
 * it's known, so callers can hold off mounting the WebView: loading the site
 * with the wrong UA first and then reloading would cost a round trip and could
 * leave the site's "you're in an app" state stuck in its cookies.
 */
export function useBrowserUserAgent(override?: Partial<Record<MobileOS, string>>): string | null {
  const fixed = override?.[os];
  const [userAgent, setUserAgent] = useState<string | null>(fixed ?? null);

  useEffect(() => {
    if (fixed) return;
    let active = true;
    getDefaultWebViewUserAgent().then((ua) => {
      if (active) setUserAgent(toMobileBrowserUserAgent(ua, os));
    });
    return () => {
      active = false;
    };
  }, [fixed]);

  return fixed ?? userAgent;
}
