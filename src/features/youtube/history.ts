/**
 * Watch history: the videos you opened, newest first, with how far you got.
 * Stored on this phone only (there is no YouTube account). The player resumes
 * a video where you left it and the video lists show how much you've watched.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { Video, VideoDetails } from './types';

export interface HistoryEntry {
  id: string;
  title: string;
  channelName?: string | null;
  channelId?: string | null;
  thumbnail?: string | null;
  durationSeconds?: number | null;
  /** When it was last opened, milliseconds since epoch. */
  watchedAt: number;
  /** Seconds watched (where it stopped last time). */
  position: number;
}

/** Older entries beyond this are dropped. */
export const MAX_HISTORY = 500;
/** Closer than this to the end counts as watched to the end: the next play starts over. */
const END_MARGIN_S = 15;
/** Resume only past this point; before it, starting over loses nothing. */
const RESUME_MIN_S = 10;

interface HistoryState {
  entries: Record<string, HistoryEntry>;
  /** A video was opened: it moves to the top, keeping its last position. */
  record: (video: VideoDetails) => void;
  savePosition: (id: string, position: number) => void;
  remove: (id: string) => void;
  clear: () => void;
}

export const useHistory = create<HistoryState>()(
  persist(
    (set) => ({
      entries: {},
      record: (video) =>
        set((s) => {
          const previous = s.entries[video.id];
          const entry: HistoryEntry = {
            id: video.id,
            title: video.title,
            channelName: video.channelName,
            channelId: video.channelId,
            thumbnail: video.thumbnail,
            durationSeconds: video.durationSeconds ?? previous?.durationSeconds,
            watchedAt: Date.now(),
            position: previous?.position ?? 0,
          };
          return { entries: trim({ ...s.entries, [video.id]: entry }) };
        }),
      savePosition: (id, position) =>
        set((s) => {
          const entry = s.entries[id];
          if (!entry || !Number.isFinite(position) || Math.abs(entry.position - position) < 1) return s;
          return { entries: { ...s.entries, [id]: { ...entry, position: Math.max(0, position) } } };
        }),
      remove: (id) =>
        set((s) => {
          const entries = { ...s.entries };
          delete entries[id];
          return { entries };
        }),
      clear: () => set({ entries: {} }),
    }),
    { name: 'lite-social.youtube.history', version: 1, storage: createJSONStorage(() => AsyncStorage) },
  ),
);

function trim(entries: Record<string, HistoryEntry>): Record<string, HistoryEntry> {
  const list = Object.values(entries);
  if (list.length <= MAX_HISTORY) return entries;
  return Object.fromEntries(newestFirst(list).slice(0, MAX_HISTORY).map((e) => [e.id, e]));
}

export function newestFirst(entries: HistoryEntry[]): HistoryEntry[] {
  return [...entries].sort((a, b) => b.watchedAt - a.watchedAt);
}

/** Where to start a video: where you stopped, unless that was near the start or the end. */
export function resumePosition(entry: Pick<HistoryEntry, 'position' | 'durationSeconds'> | undefined): number {
  if (!entry || entry.position < RESUME_MIN_S) return 0;
  if (entry.durationSeconds && entry.position > entry.durationSeconds - END_MARGIN_S) return 0;
  return entry.position;
}

/** 0..1 of the video watched, for the bar on thumbnails; null when there's nothing to show. */
export function watchedFraction(entry: Pick<HistoryEntry, 'position' | 'durationSeconds'> | undefined): number | null {
  if (!entry || !entry.durationSeconds || entry.durationSeconds <= 0 || entry.position < 1) return null;
  if (entry.position > entry.durationSeconds - END_MARGIN_S) return 1;
  return Math.min(1, entry.position / entry.durationSeconds);
}

/** A history entry in the shape the video lists use. */
export function historyVideo(entry: HistoryEntry): Video {
  return {
    type: 'video',
    id: entry.id,
    url: `https://www.youtube.com/watch?v=${entry.id}`,
    title: entry.title,
    channelName: entry.channelName,
    channelId: entry.channelId,
    thumbnail: entry.thumbnail,
    durationSeconds: entry.durationSeconds,
  };
}

/** "Today", "Yesterday", "This week", "Earlier": the groups the history screen shows. */
export function historyGroup(watchedAt: number, now = Date.now()): string {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const day = 24 * 60 * 60 * 1000;
  if (watchedAt >= startOfToday.getTime()) return 'Today';
  if (watchedAt >= startOfToday.getTime() - day) return 'Yesterday';
  if (watchedAt >= startOfToday.getTime() - 6 * day) return 'This week';
  return 'Earlier';
}
