import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

const MAX_REPORTS = 100;

/**
 * A note that something slipped through. Stored only on this device; nothing
 * is sent anywhere unless you share it yourself.
 */
export interface LeakReport {
  id: string;
  createdAt: number;
  platformId: string;
  /** Page address without query or fragment (those can carry tokens). */
  url: string;
  rulesRevision: number;
  /** How many elements each active rule matched on that page: which rule broke, without any page content. */
  counts: Record<string, number> | null;
}

interface LeakState {
  reports: LeakReport[];
  add: (report: Omit<LeakReport, 'id' | 'createdAt'>) => void;
  remove: (id: string) => void;
  clear: () => void;
}

export const useLeaks = create<LeakState>()(
  persist(
    (set) => ({
      reports: [],
      add: (report) =>
        set((s) => ({
          reports: [
            { ...report, id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, createdAt: Date.now() },
            ...s.reports,
          ].slice(0, MAX_REPORTS),
        })),
      remove: (id) => set((s) => ({ reports: s.reports.filter((r) => r.id !== id) })),
      clear: () => set({ reports: [] }),
    }),
    {
      name: 'lite-social.leaks',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);

export function formatLeakReport(report: LeakReport): string {
  const counts = report.counts
    ? Object.entries(report.counts)
        .map(([rule, n]) => `  ${rule}: ${n}`)
        .join('\n')
    : '  (page did not answer)';
  return [
    `${new Date(report.createdAt).toISOString()}  ${report.platformId}  rules r${report.rulesRevision}`,
    `  ${report.url}`,
    counts,
  ].join('\n');
}
