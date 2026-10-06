/**
 * Instagram message alerts (Android only).
 *
 * Lite Social can't get push notifications itself: the site runs in a WebView,
 * and Android's WebView has no web push. Instead, the Instagram app keeps
 * receiving message notifications, and a notification listener in
 * modules/message-alerts swaps each one for a Lite Social notification that
 * opens the inbox here rather than in the Instagram app.
 *
 * The native module is missing on iOS and in Expo Go; everything here then
 * reports "unsupported" and does nothing.
 */
import { requireOptionalNativeModule } from 'expo';
import { PermissionsAndroid, Platform } from 'react-native';

interface MessageAlertsModule {
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
  hasListenerAccess(): boolean;
  canPostNotifications(): boolean;
  openListenerSettings(): void;
  openAppSettings(): void;
}

const native = Platform.OS === 'android' ? requireOptionalNativeModule<MessageAlertsModule>('MessageAlerts') : null;

export interface MessageAlertsStatus {
  supported: boolean;
  /** The switch in Lite Social's settings. */
  enabled: boolean;
  /** Android's "Notification access" for Lite Social, which lets it see Instagram's notifications. */
  listenerAccess: boolean;
  /** Lite Social may post notifications (Android 13+ asks; the user can also turn them off). */
  canNotify: boolean;
}

export function getStatus(): MessageAlertsStatus {
  if (!native) return { supported: false, enabled: false, listenerAccess: false, canNotify: false };
  return {
    supported: true,
    enabled: native.isEnabled(),
    listenerAccess: native.hasListenerAccess(),
    canNotify: native.canPostNotifications(),
  };
}

export function setEnabled(enabled: boolean): void {
  native?.setEnabled(enabled);
}

/** Android 13+ asks before an app may post notifications; older versions allow it by default. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== 'android' || (Platform.Version as number) < 33) return true;
  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

export function openListenerSettings(): void {
  native?.openListenerSettings();
}

export function openAppSettings(): void {
  native?.openAppSettings();
}
