import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useSettings } from '@/state/settingsStore';
import { localDay, MAX_SNOOZES_PER_DAY, useUsage } from '@/state/usageStore';

/**
 * Adds foreground time to today's total while `active` (the browser screen is
 * focused and not locked). Counts only while the app is in the foreground.
 */
export function useUsageTracking(active: boolean) {
  const addSeconds = useUsage((s) => s.addSeconds);
  useEffect(() => {
    if (!active) return;
    let since: number | null = AppState.currentState === 'active' ? Date.now() : null;
    const flush = () => {
      if (since === null) return;
      const now = Date.now();
      addSeconds((now - since) / 1000);
      since = now;
    };
    // App-side bookkeeping only; nothing here runs inside the page.
    const interval = setInterval(flush, 5000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        since = Date.now();
      } else {
        flush();
        since = null;
      }
    });
    return () => {
      flush();
      clearInterval(interval);
      subscription.remove();
    };
  }, [active, addSeconds]);
}

export interface DailyLimit {
  /** 0 when no limit is set. */
  limitMinutes: number;
  usedSeconds: number;
  locked: boolean;
  canSnooze: boolean;
  snooze: () => void;
}

export function useDailyLimit(): DailyLimit {
  const limitMinutes = useSettings((s) => s.dailyLimitMinutes);
  const day = useUsage((s) => s.day);
  const seconds = useUsage((s) => s.seconds);
  const bonusSeconds = useUsage((s) => s.bonusSeconds);
  const snoozes = useUsage((s) => s.snoozes);
  const snooze = useUsage((s) => s.snooze);

  const isToday = day === localDay();
  const usedSeconds = isToday ? seconds : 0;
  const allowance = limitMinutes * 60 + (isToday ? bonusSeconds : 0);
  return {
    limitMinutes,
    usedSeconds,
    locked: limitMinutes > 0 && usedSeconds >= allowance,
    canSnooze: (isToday ? snoozes : 0) < MAX_SNOOZES_PER_DAY,
    snooze,
  };
}
