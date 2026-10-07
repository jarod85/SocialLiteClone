/**
 * Instagram alerts (Android only).
 *
 * Lite Social can't receive Instagram's push notifications: the site runs in a
 * WebView, and Android's WebView has no web push. Instead, a background job in
 * modules/instagram-alerts checks Instagram every 15+ minutes with the login
 * from the in-app browser (the same web API instagram.com itself calls) and
 * posts a Lite Social notification for each new message and activity item.
 *
 * The native module is missing on iOS and in Expo Go; everything here then
 * reports "unsupported" and does nothing.
 */
import { requireOptionalNativeModule } from 'expo';
import { PermissionsAndroid, Platform } from 'react-native';

interface InstagramAlertsModule {
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
  getIntervalMinutes(): number;
  setIntervalMinutes(minutes: number): void;
  getLastResult(): string | null;
  checkNow(): Promise<string>;
  hasSession(): Promise<boolean>;
  canPostNotifications(): boolean;
  isIgnoringBatteryOptimizations(): boolean;
  requestIgnoreBatteryOptimizations(): void;
  openAppSettings(): void;
}

const native = Platform.OS === 'android' ? requireOptionalNativeModule<InstagramAlertsModule>('InstagramAlerts') : null;

/** Android runs periodic background work at most every 15 minutes. */
export const CHECK_INTERVAL_OPTIONS = [15, 30, 60] as const;

export interface CheckResult {
  checkedAt: number;
  loggedIn: boolean;
  /** "OK" or what went wrong. */
  messages: string;
  activity: string;
  newMessages: number;
  newActivity: number;
  unreadConversations: number;
}

export interface InstagramAlertsStatus {
  supported: boolean;
  enabled: boolean;
  intervalMinutes: number;
  /** Lite Social may post notifications (Android 13+ asks; the user can also turn them off). */
  canNotify: boolean;
  /** Battery optimization off, so Android doesn't hold the checks back for hours. */
  unrestricted: boolean;
  lastResult: CheckResult | null;
}

export function parseCheckResult(json: string | null | undefined): CheckResult | null {
  if (!json) return null;
  try {
    const value = JSON.parse(json) as Partial<CheckResult>;
    if (typeof value.checkedAt !== 'number') return null;
    return {
      checkedAt: value.checkedAt,
      loggedIn: value.loggedIn === true,
      messages: String(value.messages ?? ''),
      activity: String(value.activity ?? ''),
      newMessages: Number(value.newMessages ?? 0),
      newActivity: Number(value.newActivity ?? 0),
      unreadConversations: Number(value.unreadConversations ?? 0),
    };
  } catch {
    return null;
  }
}

export function getStatus(): InstagramAlertsStatus {
  if (!native) {
    return { supported: false, enabled: false, intervalMinutes: 15, canNotify: false, unrestricted: false, lastResult: null };
  }
  return {
    supported: true,
    enabled: native.isEnabled(),
    intervalMinutes: native.getIntervalMinutes(),
    canNotify: native.canPostNotifications(),
    unrestricted: native.isIgnoringBatteryOptimizations(),
    lastResult: parseCheckResult(native.getLastResult()),
  };
}

export function setEnabled(enabled: boolean): void {
  native?.setEnabled(enabled);
}

export function setIntervalMinutes(minutes: number): void {
  native?.setIntervalMinutes(minutes);
}

export async function checkNow(): Promise<CheckResult | null> {
  if (!native) return null;
  return parseCheckResult(await native.checkNow());
}

export async function hasSession(): Promise<boolean> {
  return native ? native.hasSession() : false;
}

/** Android 13+ asks before an app may post notifications; older versions allow it by default. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== 'android' || (Platform.Version as number) < 33) return true;
  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

export function requestUnrestrictedBattery(): void {
  native?.requestIgnoreBatteryOptimizations();
}

export function openAppSettings(): void {
  native?.openAppSettings();
}
