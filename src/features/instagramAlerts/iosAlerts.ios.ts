/**
 * Instagram notifications on iOS, with the same calls as the Android module
 * (modules/instagram-alerts), so instagramAlerts.ts and Settings treat both alike.
 * Only iOS builds include this file (Metro's .ios.ts); Android gets iosAlerts.ts.
 */
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { Linking } from 'react-native';

import { toMobileBrowserUserAgent } from '@/webview/userAgent';

import { session } from './checker/bridge';
import { run } from './checker/checker';
import * as notify from './checker/notify';
import { resetWatermarks, useAlertsState } from './checker/state';
import { schedule, unschedule } from './checker/task';
import type { InstagramAlertsModule } from './instagramAlerts';

/** Requests look like the in-app browser's own (src/webview/userAgent.ts). */
async function rememberUserAgent(): Promise<void> {
  const ua = await Constants.getWebViewUserAgentAsync().catch(() => null);
  useAlertsState.setState({ userAgent: toMobileBrowserUserAgent(ua, 'ios') });
}

async function refreshPermission(): Promise<void> {
  useAlertsState.setState({ canNotify: await notify.canPost().catch(() => false) });
}

export const iosAlertsModule: InstagramAlertsModule = {
  isEnabled: () => useAlertsState.getState().enabled,
  setEnabled(enabled) {
    useAlertsState.setState({ enabled });
    if (enabled) {
      resetWatermarks();
      void rememberUserAgent();
      void schedule(useAlertsState.getState().intervalMinutes).catch(() => undefined);
    } else {
      void unschedule().catch(() => undefined);
    }
  },
  getIntervalMinutes: () => useAlertsState.getState().intervalMinutes,
  setIntervalMinutes(minutes) {
    useAlertsState.setState({ intervalMinutes: minutes });
    if (useAlertsState.getState().enabled) void schedule(minutes).catch(() => undefined);
  },
  getLastResult: () => useAlertsState.getState().lastResult,
  getLastBackgroundCheckAt: () => useAlertsState.getState().lastBackgroundAt,
  sendTestNotification: () => void notify.postTest(),
  async checkNow() {
    await rememberUserAgent();
    return JSON.stringify(await run());
  },
  hasSession: async () => (await session()).loggedIn,
  canPostNotifications: () => useAlertsState.getState().canNotify,
  // iOS has no battery optimization to turn off; it decides when background checks run.
  isIgnoringBatteryOptimizations: () => true,
  requestIgnoreBatteryOptimizations: () => undefined,
  openAppSettings: () => void Linking.openSettings(),
};

export async function requestIosNotificationPermission(): Promise<boolean> {
  const granted = await notify.requestPermission();
  await refreshPermission();
  return granted;
}

export const alertsPlatformNote: string | null =
  'iOS decides when background checks run: at most every 15 minutes, often less, and not after you swipe Lite Social away.';

/** Shows alerts while the app is open too, and opens the conversation (or activity) when one is tapped. */
export function startIosAlerts(): () => void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
  void refreshPermission();
  const open = (response: Notifications.NotificationResponse | null) => {
    const url = response?.notification.request.content.data?.url;
    // Only the app's own links (notify.ts makes them); the route checks the rest (platforms/registry.ts startPath).
    if (typeof url === 'string' && url.startsWith('litesocial://browse/')) router.push(url.replace('litesocial://', '/') as never);
  };
  const subscription = Notifications.addNotificationResponseReceivedListener(open);
  open(Notifications.getLastNotificationResponse());
  return () => subscription.remove();
}
