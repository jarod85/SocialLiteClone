import { useIsFocused } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type {
  ShouldStartLoadRequest,
  WebViewErrorEvent,
  WebViewNavigation,
  WebViewNavigationEvent,
  WebViewOpenWindowEvent,
  WebViewProgressEvent,
} from 'react-native-webview/lib/WebViewTypes';

import { decideNavigation, initialUrl, type NavigationContext, resolveSitePath } from '@/core/navigationPolicy';
import { compileRoutes } from '@/core/routeMatcher';
import type { PageMessage } from '@/core/types';
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
  PHONE_LAYOUT_SCRIPT,
  parsePageMessage,
  ruleIds,
  statsScript,
} from './engineBridge';
import { LoadErrorView } from './LoadErrorView';
import { ReelViewer, type ReelState } from './ReelViewer';
import { useAndroidBack } from './useAndroidBack';
import { useBrowserUserAgent } from './useBrowserUserAgent';
import { toTabletUserAgent, wantsTabletUserAgent } from './userAgent';

interface Props {
  platform: PlatformConfig;
  /** Start on this site path instead of home (e.g. the inbox, from a message alert). */
  openPath?: string;
  /** Changes when the same path is asked for again while the page is open (another alert tapped). */
  openKey?: string;
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
export function PlatformWebView({ platform, openPath, openKey, onClose, onOpenSettings }: Props) {
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
  const [startUrl] = useState(() => (openPath ? resolveSitePath(platform.baseUrl, openPath) : homeUrl));

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

  // ---- Tablet user agent (Android) -------------------------------------------
  // Instagram only offers calls to browsers it doesn't take for a phone, judged from the
  // user agent when a page loads, so DM pages load as Chrome on a tablet. The call window
  // they open is shown by the patched react-native-webview (patches/).
  const tabletPaths = Platform.OS === 'android' ? platform.tabletUserAgentPaths : undefined;
  const tabletUserAgent = useMemo(
    () => (userAgent && tabletPaths ? toTabletUserAgent(userAgent) : null),
    [userAgent, tabletPaths],
  );
  const [tabletMode, setTabletMode] = useState(
    () => !!tabletPaths && wantsTabletUserAgent(startUrl, platform.siteHosts, tabletPaths) === true,
  );
  const appliedTabletModeRef = useRef(tabletMode);
  useEffect(() => {
    if (appliedTabletModeRef.current === tabletMode) return;
    appliedTabletModeRef.current = tabletMode;
    // A new user agent only applies to later requests: load the page again so the site sees it.
    // Not reload(): mid-navigation that would reload the page being left.
    webViewRef.current?.injectJavaScript(`window.location.replace(${JSON.stringify(currentUrlRef.current)});true;`);
  }, [tabletMode]);

  // Phone layout for tablet pages (platform.phoneLayoutPaths). Once such a page has loaded as a
  // tablet, the WebView goes back to the phone user agent and the page fetches its view again,
  // now laid out for a phone; it keeps what the site decided at load (Instagram: calls). Pages
  // loaded after that are held until the tablet agent is back on, so they load as a tablet too.
  const phoneLayoutPaths = tabletPaths ? platform.phoneLayoutPaths : undefined;
  const [phoneLayout, setPhoneLayout] = useState(false);
  const phoneLayoutRef = useRef(false);
  const updatePhoneLayout = useCallback((on: boolean) => {
    phoneLayoutRef.current = on;
    setPhoneLayout(on);
  }, []);
  /** Whether the page loading now started while the tablet agent was on. */
  const tabletPageLoadingRef = useRef(tabletMode);
  const heldLoadRef = useRef<{ url: string; replace: boolean } | null>(null);
  const loadAsTablet = useCallback(
    (url: string, replace: boolean) => {
      heldLoadRef.current = { url, replace };
      updatePhoneLayout(false);
    },
    [updatePhoneLayout],
  );
  useEffect(() => {
    // Runs once the tablet agent is back in the WebView's props.
    const held = heldLoadRef.current;
    if (phoneLayout || !held) return;
    heldLoadRef.current = null;
    const method = held.replace ? 'replace' : 'assign';
    webViewRef.current?.injectJavaScript(`window.location.${method}(${JSON.stringify(held.url)});true;`);
  }, [phoneLayout]);

  // In tablet mode the WebView opens new windows. Sized popups (the call window) are shown by
  // the patched library; plain new tabs (target="_blank" links) load here, through the policy.
  const onOpenWindow = useCallback((event: WebViewOpenWindowEvent) => {
    const url = event.nativeEvent.targetUrl;
    if (/^(https?|mailto|tel|sms):/i.test(url))
      webViewRef.current?.injectJavaScript(`window.location.assign(${JSON.stringify(url)});true;`);
  }, []);

  const [progress, setProgress] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [blockedRuleId, setBlockedRuleId] = useState<string | null>(null);
  // Changing the key remounts the WebView. Used when the OS kills its web content process.
  const [instanceKey, setInstanceKey] = useState(0);

  // Also fires for in-page navigation, which takes the user agent of the page it's in.
  const onLoadStart = useCallback(() => {
    tabletPageLoadingRef.current = appliedTabletModeRef.current && !phoneLayoutRef.current;
  }, []);

  const onLoad = useCallback(
    (event: WebViewNavigationEvent) => {
      setLoadError(null);
      const tabletPage = tabletPageLoadingRef.current;
      tabletPageLoadingRef.current = false;
      if (!tabletPage || !phoneLayoutPaths) return;
      if (wantsTabletUserAgent(event.nativeEvent.url, platform.siteHosts, phoneLayoutPaths) !== true) return;
      updatePhoneLayout(true);
      webViewRef.current?.injectJavaScript(PHONE_LAYOUT_SCRIPT);
    },
    [phoneLayoutPaths, platform.siteHosts, updatePhoneLayout],
  );

  const onNavigationStateChange = useCallback((nav: WebViewNavigation) => {
    // Fires for full page loads and, on both platforms, for in-page history.pushState
    // navigation, so this stays accurate inside single-page apps like Instagram.
    canGoBackRef.current = nav.canGoBack;
    setCanGoBack(nav.canGoBack);
    currentUrlRef.current = nav.url;
    if (tabletPaths) {
      const wanted = wantsTabletUserAgent(nav.url, platform.siteHosts, tabletPaths);
      if (wanted !== null) setTabletMode(wanted);
      if (wanted === false) updatePhoneLayout(false); // The next tablet page starts as a tablet again.
    }
  }, [platform.siteHosts, tabletPaths, updatePhoneLayout]);

  // ---- Layer 1: navigation interception -----------------------------------
  const onShouldStartLoadWithRequest = useCallback((request: ShouldStartLoadRequest) => {
    // Android doesn't report isTopFrame; it only asks about main-frame navigations there.
    const decision = decideNavigation(request.url, request.isTopFrame ?? true, navContextRef.current);
    switch (decision.type) {
      case 'allow':
        // On the phone agent for a page's layout: a new page that would load as a tablet waits for it.
        if (
          phoneLayoutRef.current &&
          tabletPaths &&
          wantsTabletUserAgent(request.url, platform.siteHosts, tabletPaths) !== false
        ) {
          loadAsTablet(request.url, false);
          return false;
        }
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
  }, [loadAsTablet, platform.siteHosts, tabletPaths]);

  // ---- Full-screen reels (injected/reelViewer.ts) ---------------------------
  const [reel, setReel] = useState<ReelState | null>(null);
  const onReelMessage = useCallback((message: Extract<PageMessage, { type: 'reel' }>) => {
    if (message.state === 'loading') setReel({ requestId: message.requestId, state: 'loading' });
    else
      // Only for the reel being opened: one closed meanwhile stays closed.
      setReel((current) =>
        current?.requestId !== message.requestId ? current : message.state === 'ready' ? { requestId: message.requestId, state: 'ready', reel: message.reel } : null,
      );
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
      else if (message?.type === 'reel' && toggles.fullscreenReels) onReelMessage(message);
    },
    [platform.siteHosts, onReelMessage, toggles.fullscreenReels],
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
    if (phoneLayoutRef.current) loadAsTablet(currentUrlRef.current, true);
    else webViewRef.current?.reload();
  }, [loadAsTablet]);

  const goHome = useCallback(() => {
    setLoadError(null);
    setBlockedRuleId(null);
    // react-native-webview has no loadUrl(); assigning location from the page is the
    // supported way to navigate while keeping back/forward history intact.
    webViewRef.current?.injectJavaScript(`window.location.assign(${JSON.stringify(homeUrl)});true;`);
  }, [homeUrl]);

  // A message alert tapped while this page is already open: clear any overlay (during render,
  // as React recommends for prop changes), then go to the inbox.
  const [shownOpenKey, setShownOpenKey] = useState(openKey);
  if (openKey !== shownOpenKey) {
    setShownOpenKey(openKey);
    if (openPath) {
      setLoadError(null);
      setBlockedRuleId(null);
    }
  }
  const openedKeyRef = useRef(openKey);
  useEffect(() => {
    if (openKey === openedKeyRef.current) return;
    openedKeyRef.current = openKey;
    if (!openPath) return;
    const url = resolveSitePath(platform.baseUrl, openPath);
    webViewRef.current?.injectJavaScript(`window.location.assign(${JSON.stringify(url)});true;`);
  }, [openKey, openPath, platform.baseUrl]);

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
            userAgent={tabletMode && tabletUserAgent && !phoneLayout ? tabletUserAgent : userAgent}
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
            // Android: open target="_blank" links here (and through our policy). In tablet mode
            // through onOpenWindow, so the call window can open as a real popup.
            setSupportMultipleWindows={tabletMode}
            onOpenWindow={tabletMode ? onOpenWindow : undefined}
            allowsInlineMediaPlayback // iOS: otherwise every video forces the fullscreen player.
            mediaPlaybackRequiresUserAction // Videos need a tap to play: no autoplay.
            webviewDebuggingEnabled={__DEV__ || webInspection} // chrome://inspect / Safari Web Inspector.
            // --- Lifecycle ---
            onNavigationStateChange={onNavigationStateChange}
            onLoadProgress={(e: WebViewProgressEvent) => setProgress(e.nativeEvent.progress)}
            onLoadStart={onLoadStart}
            onLoad={onLoad}
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
        <DailyLimitGate
          active={isFocused}
          onLock={() => {
            pauseMedia();
            setReel(null);
          }}
          onClose={onClose}
        />
        {reel !== null && isFocused ? <ReelViewer reel={reel} onClose={() => setReel(null)} /> : null}
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
