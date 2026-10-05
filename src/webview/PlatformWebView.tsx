import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import type { WebViewErrorEvent, WebViewNavigation, WebViewProgressEvent } from 'react-native-webview/lib/WebViewTypes';

import type { PlatformConfig } from '@/platforms/types';
import { useTheme } from '@/ui/theme';

import { BrowserToolbar } from './BrowserToolbar';
import { LoadErrorView } from './LoadErrorView';
import { useAndroidBack } from './useAndroidBack';
import { useBrowserUserAgent } from './useBrowserUserAgent';

interface Props {
  platform: PlatformConfig;
  onClose: () => void;
}

/**
 * The controlled browser a platform's mobile site runs in. The user logs in on
 * the real site inside this WebView; the app never sees credentials, cookies or
 * page content.
 */
export function PlatformWebView({ platform, onClose }: Props) {
  const theme = useTheme();
  const webViewRef = useRef<WebView>(null);
  const userAgent = useBrowserUserAgent(platform.userAgent);

  const [canGoBack, setCanGoBack] = useState(false);
  // Mirrored in a ref so the Android back handler doesn't resubscribe on every navigation.
  const canGoBackRef = useRef(false);
  const [progress, setProgress] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Changing the key remounts the WebView. Used when the OS kills its web content process.
  const [instanceKey, setInstanceKey] = useState(0);

  const onNavigationStateChange = useCallback((nav: WebViewNavigation) => {
    // Fires for full page loads and, on both platforms, for in-page history.pushState
    // navigation, so this stays accurate inside single-page apps like Instagram.
    canGoBackRef.current = nav.canGoBack;
    setCanGoBack(nav.canGoBack);
  }, []);

  const goBack = useCallback(() => webViewRef.current?.goBack(), []);

  const reload = useCallback(() => {
    setLoadError(null);
    webViewRef.current?.reload();
  }, []);

  const goHome = useCallback(() => {
    setLoadError(null);
    // react-native-webview has no loadUrl(); assigning location from the page is the
    // supported way to navigate while keeping back/forward history intact.
    webViewRef.current?.injectJavaScript(`window.location.assign(${JSON.stringify(platform.baseUrl)}); true;`);
  }, [platform.baseUrl]);

  const recreateWebView = useCallback(() => {
    setLoadError(null);
    setInstanceKey((key) => key + 1);
  }, []);

  useAndroidBack(
    useCallback(() => {
      if (!canGoBackRef.current) return false; // Let the router close the screen.
      webViewRef.current?.goBack();
      return true;
    }, []),
  );

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top', 'bottom', 'left', 'right']}>
      <BrowserToolbar
        title={platform.name}
        canGoBack={canGoBack}
        onBack={goBack}
        onHome={goHome}
        onReload={reload}
        onClose={onClose}
      />
      {/* Android apps draw edge-to-edge, so the window no longer shrinks for the keyboard.
          Without this, the DM composer would sit behind the keyboard. iOS's WebView
          already scrolls focused inputs into view, so padding there would double up. */}
      <KeyboardAvoidingView style={styles.content} behavior={Platform.OS === 'android' ? 'padding' : undefined}>
        {userAgent === null ? (
          <View style={styles.centered}>
            <ActivityIndicator color={theme.textMuted} />
          </View>
        ) : (
          <WebView
            key={instanceKey}
            ref={webViewRef}
            source={{ uri: platform.baseUrl }}
            userAgent={userAgent}
            style={{ backgroundColor: theme.background }}
            // --- Session persistence ---
            // We never read or copy cookies. Logins survive restarts because the WebView
            // keeps its own persistent store: WKWebsiteDataStore.default on iOS, and
            // CookieManager on Android, which react-native-webview flushes to disk after
            // each page load. `incognito` would make that store in-memory only.
            incognito={false}
            javaScriptEnabled
            domStorageEnabled // The site keeps session state in localStorage.
            thirdPartyCookiesEnabled // Android: "Log in with Facebook" crosses domains.
            cacheEnabled
            // --- Browsing behaviour ---
            pullToRefreshEnabled // iOS only. Android uses the toolbar's reload button.
            allowsBackForwardNavigationGestures // iOS: edge swipe goes back.
            contentMode="mobile" // iOS: never fall back to requesting the desktop site.
            setSupportMultipleWindows={false} // Android: open target="_blank" links here instead of dropping them.
            allowsInlineMediaPlayback // iOS: otherwise every video forces the fullscreen player.
            mediaPlaybackRequiresUserAction // Videos need a tap to play: no autoplay.
            webviewDebuggingEnabled={__DEV__} // chrome://inspect / Safari Web Inspector, dev only.
            // --- Lifecycle ---
            onNavigationStateChange={onNavigationStateChange}
            onLoadProgress={(e: WebViewProgressEvent) => setProgress(e.nativeEvent.progress)}
            onLoad={() => setLoadError(null)}
            onError={(e: WebViewErrorEvent) =>
              setLoadError(e.nativeEvent.description || 'Check your connection and try again.')
            }
            // iOS can kill the web content process under memory pressure, leaving a blank page.
            onContentProcessDidTerminate={recreateWebView}
            // Android: an unhandled renderer crash would take the whole app down with it.
            onRenderProcessGone={recreateWebView}
          />
        )}
        {progress > 0 && progress < 1 && (
          <View
            pointerEvents="none"
            style={[styles.progress, { width: `${progress * 100}%`, backgroundColor: theme.accent }]}
          />
        )}
        {loadError !== null && <LoadErrorView platformName={platform.name} description={loadError} onRetry={reload} />}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  progress: { position: 'absolute', top: 0, left: 0, height: 2 },
});
