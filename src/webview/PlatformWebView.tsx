import { useIsFocused } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type {
  ShouldStartLoadRequest,
  WebViewErrorEvent,
  WebViewNavigation,
  WebViewProgressEvent,
} from 'react-native-webview/lib/WebViewTypes';

import { decideNavigation, initialUrl, type NavigationContext } from '@/core/navigationPolicy';
import { compileRoutes } from '@/core/routeMatcher';
import { hostMatches, parseUrl, stripQueryAndHash } from '@/core/urls';
import { DailyLimitGate } from '@/features/timeLimit/DailyLimitGate';
import type { PlatformConfig } from '@/platforms/types';
import { useRules } from '@/rules/rulesStore';
import { platformRules } from '@/rules/schema';
import { useLeaks } from '@/state/leakStore';
import { useSettings, useToggles } from '@/state/settingsStore';
import { useTheme } from '@/ui/theme';

import { BlockedOverlay } from './BlockedOverlay';
import { BrowserToolbar } from './BrowserToolbar';
import {
  applyScript,
  bootScript,
  buildPayload,
  PAUSE_MEDIA_SCRIPT,
  parsePageMessage,
  ruleIds,
  statsScript,
} from './engineBridge';
import { LoadErrorView } from './LoadErrorView';
import { useAndroidBack } from './useAndroidBack';
import { useBrowserUserAgent } from './useBrowserUserAgent';

interface Props {
  platform: PlatformConfig;
  onClose: () => void;
  onOpenSettings: () => void;
}

type StatsCallback = (counts: Record<string, number> | null) => void;

/**
 * The controlled browser a platform's mobile site runs in, with all three
 * blocking layers:
 *   1. Navigation interception: onShouldStartLoadWithRequest + core/navigationPolicy.
 *   2. Injected CSS:            the engine's stylesheet (core/cssBuilder).
 *   3. Injected JS:             the engine's MutationObserver and SPA navigation hooks.
 *
 * The user logs in on the real site inside this WebView. The app never sees
 * credentials, cookies or page content.
 */
export function PlatformWebView({ platform, onClose, onOpenSettings }: Props) {
  const theme = useTheme();
  const webViewRef = useRef<WebView>(null);
  const userAgent = useBrowserUserAgent(platform.userAgent);
  const isFocused = useIsFocused();

  // ---- Settings and rules -> what the layers need -------------------------
  const toggles = useToggles(platform);
  const feedLimit = useSettings((s) => s.feedLimit);
  const webInspection = useSettings((s) => s.webInspection);
  const rulesFile = useRules((s) => s.rules);
  const rules = useMemo(() => platformRules(rulesFile, platform.id), [rulesFile, platform.id]);

  const navContext = useMemo<NavigationContext>(
    () => ({
      allowedHosts: platform.allowedHosts,
      siteHosts: platform.siteHosts,
      baseUrl: platform.baseUrl,
      routes: compileRoutes(rules.routes, platform.neverBlock),
      toggles,
    }),
    [platform, rules, toggles],
  );
  const homeUrl = useMemo(() => initialUrl(navContext), [navContext]);
  // The first page only. Later changes are applied to the live page instead of reloading it.
  const [startUrl] = useState(homeUrl);

  const payload = useMemo(
    () => buildPayload(platform, rules, toggles, feedLimit, platform.baseUrl),
    [platform, rules, toggles, feedLimit],
  );
  const boot = useMemo(() => bootScript(payload), [payload]);

  // Callbacks handed to the WebView read these through refs, so they never go stale.
  const navContextRef = useRef(navContext);
  const knownRuleIdsRef = useRef(ruleIds(rules));
  useEffect(() => {
    navContextRef.current = navContext;
    knownRuleIdsRef.current = ruleIds(rules);
  }, [navContext, rules]);

  // Settings changed while a page is open (e.g. from the Settings screen on top): apply live.
  const appliedPayloadRef = useRef(payload);
  useEffect(() => {
    if (appliedPayloadRef.current === payload) return;
    appliedPayloadRef.current = payload;
    webViewRef.current?.injectJavaScript(applyScript(payload));
  }, [payload]);

  // ---- Browser state -------------------------------------------------------
  const [canGoBack, setCanGoBack] = useState(false);
  const canGoBackRef = useRef(false);
  const currentUrlRef = useRef(startUrl);
  const [progress, setProgress] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [blockedRuleId, setBlockedRuleId] = useState<string | null>(null);
  // Changing the key remounts the WebView. Used when the OS kills its web content process.
  const [instanceKey, setInstanceKey] = useState(0);

  const onNavigationStateChange = useCallback((nav: WebViewNavigation) => {
    // Fires for full page loads and, on both platforms, for in-page history.pushState
    // navigation, so this stays accurate inside single-page apps like Instagram.
    canGoBackRef.current = nav.canGoBack;
    setCanGoBack(nav.canGoBack);
    currentUrlRef.current = nav.url;
  }, []);

  // ---- Layer 1: navigation interception -----------------------------------
  const onShouldStartLoadWithRequest = useCallback((request: ShouldStartLoadRequest) => {
    // Android doesn't report isTopFrame; it only asks about main-frame navigations there.
    const decision = decideNavigation(request.url, request.isTopFrame ?? true, navContextRef.current);
    switch (decision.type) {
      case 'allow':
        return true;
      case 'deny':
        return false;
      case 'external':
        Linking.openURL(decision.url).catch(() => undefined);
        return false;
      case 'block':
        setBlockedRuleId(decision.ruleId);
        return false;
      case 'redirect':
        webViewRef.current?.injectJavaScript(`window.location.replace(${JSON.stringify(decision.url)});true;`);
        return false;
    }
  }, []);

  // ---- Messages from the page (layer 3 reports) ----------------------------
  const pendingStatsRef = useRef(new Map<string, StatsCallback>());
  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      // Only listen to our engine on the platform's own pages.
      const origin = parseUrl(event.nativeEvent.url);
      if (!origin || !hostMatches(origin.host, platform.siteHosts)) return;
      const message = parsePageMessage(event.nativeEvent.data, knownRuleIdsRef.current);
      if (message?.type === 'blocked') setBlockedRuleId(message.ruleId);
      else if (message?.type === 'stats') pendingStatsRef.current.get(message.requestId)?.(message.counts);
    },
    [platform.siteHosts],
  );

  const requestStats = useCallback(
    () =>
      new Promise<Record<string, number> | null>((resolve) => {
        const requestId = Math.random().toString(36).slice(2);
        const done: StatsCallback = (counts) => {
          clearTimeout(timeout);
          pendingStatsRef.current.delete(requestId);
          resolve(counts);
        };
        const timeout = setTimeout(() => done(null), 1500);
        pendingStatsRef.current.set(requestId, done);
        webViewRef.current?.injectJavaScript(statsScript(requestId));
      }),
    [],
  );

  // ---- Report a leak --------------------------------------------------------
  const addLeak = useLeaks((s) => s.add);
  const reportLeak = useCallback(async () => {
    const counts = await requestStats();
    addLeak({
      platformId: platform.id,
      url: stripQueryAndHash(currentUrlRef.current),
      rulesRevision: rulesFile.revision,
      counts,
    });
    Alert.alert(
      'Leak reported',
      'Saved on this phone: the page address (without query) and how many items each rule caught there. ' +
        'Nothing is sent anywhere. You can review or share it under Settings → Leak reports.',
    );
  }, [requestStats, addLeak, platform.id, rulesFile.revision]);

  const pauseMedia = useCallback(() => webViewRef.current?.injectJavaScript(PAUSE_MEDIA_SCRIPT), []);

  // ---- Toolbar actions ------------------------------------------------------
  const goBack = useCallback(() => webViewRef.current?.goBack(), []);

  const reload = useCallback(() => {
    setLoadError(null);
    webViewRef.current?.reload();
  }, []);

  const goHome = useCallback(() => {
    setLoadError(null);
    setBlockedRuleId(null);
    // react-native-webview has no loadUrl(); assigning location from the page is the
    // supported way to navigate while keeping back/forward history intact.
    webViewRef.current?.injectJavaScript(`window.location.assign(${JSON.stringify(homeUrl)});true;`);
  }, [homeUrl]);

  const recreateWebView = useCallback(() => {
    setLoadError(null);
    setInstanceKey((key) => key + 1);
  }, []);

  const blockedOverlayVisibleRef = useRef(false);
  useEffect(() => {
    blockedOverlayVisibleRef.current = blockedRuleId !== null;
  }, [blockedRuleId]);
  useAndroidBack(
    useCallback(() => {
      if (blockedOverlayVisibleRef.current) {
        setBlockedRuleId(null);
        return true;
      }
      if (!canGoBackRef.current) return false; // Let the router close the screen.
      webViewRef.current?.goBack();
      return true;
    }, []),
  );

  const blockedReason = useMemo(() => {
    if (!blockedRuleId) return '';
    const rule = rules.routes.find((r) => r.id === blockedRuleId);
    return platform.toggles.find((t) => t.id === rule?.toggle)?.label ?? 'a Lite Social rule';
  }, [blockedRuleId, rules, platform.toggles]);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top', 'bottom', 'left', 'right']}>
      <BrowserToolbar
        title={platform.name}
        canGoBack={canGoBack}
        onBack={goBack}
        onHome={goHome}
        onReload={reload}
        onClose={onClose}
        onReportLeak={reportLeak}
        onOpenSettings={onOpenSettings}
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
            source={{ uri: startUrl }}
            userAgent={userAgent}
            style={{ backgroundColor: theme.background }}
            // --- Blocking ---
            // Send every URL through our policy. The default whitelist hands non-http
            // links (instagram://, intent://) to the OS, which would open the real app.
            originWhitelist={['*']}
            onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
            injectedJavaScriptBeforeContentLoaded={boot}
            injectedJavaScript={boot}
            onMessage={onMessage}
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
            setSupportMultipleWindows={false} // Android: open target="_blank" links here (and through our policy).
            allowsInlineMediaPlayback // iOS: otherwise every video forces the fullscreen player.
            mediaPlaybackRequiresUserAction // Videos need a tap to play: no autoplay.
            webviewDebuggingEnabled={__DEV__ || webInspection} // chrome://inspect / Safari Web Inspector.
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
        {blockedRuleId !== null && (
          <BlockedOverlay
            reason={blockedReason}
            platformName={platform.name}
            onDismiss={() => setBlockedRuleId(null)}
            onOpenSettings={() => {
              setBlockedRuleId(null);
              onOpenSettings();
            }}
          />
        )}
        <DailyLimitGate active={isFocused} onLock={pauseMedia} onClose={onClose} />
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
