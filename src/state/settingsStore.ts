import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMemo } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { Toggles } from '@/core/types';
import { effectiveToggles } from '@/platforms/toggles';
import type { PlatformConfig } from '@/platforms/types';

export const FEED_LIMIT_OPTIONS = [10, 20, 30, 50] as const;
/** Minutes per day; 0 means no limit. */
export const DAILY_LIMIT_OPTIONS = [0, 15, 30, 45, 60, 90, 120] as const;

interface SettingsState {
  /** Only the toggles the user changed. Everything else falls back to the platform's defaults, so new toggles get sensible values. */
  toggleOverrides: Record<string, Record<string, boolean>>;
  feedLimit: number;
  dailyLimitMinutes: number;
  /** Lets chrome://inspect / Safari Web Inspector attach to the WebView, for fixing broken rules. */
  webInspection: boolean;
  setToggle: (platformId: string, toggleId: string, value: boolean) => void;
  setFeedLimit: (posts: number) => void;
  setDailyLimitMinutes: (minutes: number) => void;
  setWebInspection: (enabled: boolean) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      toggleOverrides: {},
      feedLimit: 30,
      dailyLimitMinutes: 0,
      webInspection: false,
      setToggle: (platformId, toggleId, value) =>
        set((s) => ({
          toggleOverrides: { ...s.toggleOverrides, [platformId]: { ...s.toggleOverrides[platformId], [toggleId]: value } },
        })),
      setFeedLimit: (feedLimit) => set({ feedLimit }),
      setDailyLimitMinutes: (dailyLimitMinutes) => set({ dailyLimitMinutes }),
      setWebInspection: (webInspection) => set({ webInspection }),
    }),
    {
      name: 'lite-social.settings',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);

/** The platform's toggles with the user's overrides applied. Stable between unrelated settings changes. */
export function useToggles(platform: PlatformConfig): Toggles {
  const overrides = useSettings((s) => s.toggleOverrides[platform.id]);
  return useMemo(() => effectiveToggles(platform, overrides), [platform, overrides]);
}
