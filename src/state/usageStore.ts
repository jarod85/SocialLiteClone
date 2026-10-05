import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/** One "5 more minutes" per day: a gentle limit, not a wall. */
export const SNOOZE_SECONDS = 5 * 60;
export const MAX_SNOOZES_PER_DAY = 1;

/**
 * Time spent in the platform browser today. Only a running total is stored:
 * no history, no per-page data.
 */
interface UsageState {
  /** Local date (YYYY-MM-DD) the counters below belong to. */
  day: string;
  seconds: number;
  bonusSeconds: number;
  snoozes: number;
  addSeconds: (seconds: number) => void;
  snooze: () => void;
}

export function localDay(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Counters for today, treating a stored earlier day as zero. */
export function today(state: Pick<UsageState, 'day' | 'seconds' | 'bonusSeconds' | 'snoozes'>) {
  return state.day === localDay() ? state : { day: localDay(), seconds: 0, bonusSeconds: 0, snoozes: 0 };
}

export const useUsage = create<UsageState>()(
  persist(
    (set) => ({
      day: localDay(),
      seconds: 0,
      bonusSeconds: 0,
      snoozes: 0,
      addSeconds: (seconds) =>
        set((s) => {
          const t = today(s);
          return { ...t, seconds: t.seconds + seconds };
        }),
      snooze: () =>
        set((s) => {
          const t = today(s);
          if (t.snoozes >= MAX_SNOOZES_PER_DAY) return t;
          return { ...t, snoozes: t.snoozes + 1, bonusSeconds: t.bonusSeconds + SNOOZE_SECONDS };
        }),
    }),
    {
      name: 'lite-social.usage',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
