/**
 * Android (and other) builds: nothing. The iOS implementation is iosAlerts.ios.ts,
 * which Metro picks on iOS; keeping it out of Android builds keeps expo-notifications
 * and expo-background-task out of the Android app, which has its own native module.
 */
import type { InstagramAlertsModule } from './instagramAlerts';

export const iosAlertsModule: InstagramAlertsModule | null = null;
export const requestIosNotificationPermission = async (): Promise<boolean> => true;
export const alertsPlatformNote: string | null = null;
export const startIosAlerts = (): (() => void) => () => undefined;
