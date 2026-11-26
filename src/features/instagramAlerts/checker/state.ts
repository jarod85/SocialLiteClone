/**
 * What the iOS checker remembers between checks (Android: AlertPrefs.kt), kept on
 * the phone in AsyncStorage. A background check rehydrates it before running.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface AlertsState {
  enabled: boolean;
  intervalMinutes: number;
  /** Newest direct message handled so far (ms). */
  dmWatermark: number;
  /** Newest activity item handled so far (ms). */
  activityWatermark: number;
  /** Last unread count seen. */
  badge: number;
  /** Conversations with an alert showing. */
  notifiedThreads: string[];
  /** JSON of the last check's result. */
  lastResult: string | null;
  lastCheckAt: number;
  lastBackgroundAt: number | null;
  /** instagram.com's page tokens for this account, kept a few hours. */
  webTokens: { owner: string | null; json: string; at: number } | null;
  wwwClaim: string | null;
  /** The inbox reader that worked last ('graphql' or 'rest'). */
  inboxReader: string | null;
  /** The first inbox read only notes where it stands. */
  inboxBaselined: boolean;
  /** Notifications allowed, as last asked (iOS only answers asynchronously). */
  canNotify: boolean;
  /** The in-app browser's user agent, so requests look like it. */
  userAgent: string | null;
}

const initial: AlertsState = {
  enabled: false,
  intervalMinutes: 15,
  dmWatermark: 0,
  activityWatermark: 0,
  badge: 0,
  notifiedThreads: [],
  lastResult: null,
  lastCheckAt: 0,
  lastBackgroundAt: null,
  webTokens: null,
  wwwClaim: null,
  inboxReader: null,
  inboxBaselined: false,
  canNotify: false,
  userAgent: null,
};

export const useAlertsState = create<AlertsState>()(
  persist(() => initial, { name: 'lite-social.instagram-alerts', version: 1, storage: createJSONStorage(() => AsyncStorage) }),
);

/** Start from "now": only what arrives after alerts were switched on is announced (AlertPrefs.resetWatermarks). */
export function resetWatermarks(now = Date.now()): void {
  useAlertsState.setState({
    dmWatermark: now,
    activityWatermark: now,
    badge: Number.MAX_SAFE_INTEGER, // The first unread count read becomes the baseline.
    notifiedThreads: [],
    inboxBaselined: true,
  });
}
