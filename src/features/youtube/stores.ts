/**
 * Persisted YouTube state: subscriptions, the cached feed, and download
 * settings. All of it stays on this phone; there is no YouTube account.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { mergeFeed } from './feed';
import { youtube } from './native';
import type { MusicFolder, Subscription, Video } from './types';

// ---------------------------------------------------------------- subscriptions

interface SubscriptionsState {
  channels: Subscription[];
  subscribe: (channel: Subscription) => void;
  unsubscribe: (id: string) => void;
  /** Adds the ones not there yet; returns how many were new. */
  importMany: (channels: Subscription[]) => number;
}

export const useSubscriptions = create<SubscriptionsState>()(
  persist(
    (set, get) => ({
      channels: [],
      subscribe: (channel) =>
        set((s) => (s.channels.some((c) => c.id === channel.id) ? s : { channels: sortByTitle([...s.channels, channel]) })),
      unsubscribe: (id) => set((s) => ({ channels: s.channels.filter((c) => c.id !== id) })),
      importMany: (channels) => {
        const known = new Set(get().channels.map((c) => c.id));
        const fresh = channels.filter((c) => !known.has(c.id));
        if (fresh.length > 0) set((s) => ({ channels: sortByTitle([...s.channels, ...fresh]) }));
        return fresh.length;
      },
    }),
    { name: 'lite-social.youtube.subscriptions', version: 1, storage: createJSONStorage(() => AsyncStorage) },
  ),
);

function sortByTitle(channels: Subscription[]): Subscription[] {
  return [...channels].sort((a, b) => a.title.localeCompare(b.title));
}

// ------------------------------------------------------------------------- feed

interface FeedState {
  items: Video[];
  updatedAt: number | null;
  /** The subscriptions the feed was last loaded for (see subscriptionsKey). */
  channelsKey: string;
  refreshing: boolean;
  /** Channels whose newest videos couldn't be loaded last time (their earlier videos stay). */
  failed: { channelId: string; error: string }[];
  error: string | null;
  refresh: () => Promise<void>;
}

/** Identifies a set of subscriptions, to notice when the feed needs reloading. */
export function subscriptionsKey(channels: Subscription[]): string {
  return channels
    .map((c) => c.id)
    .sort()
    .join(',');
}

/** Feed older than this is refreshed when the feed screen opens. */
export const FEED_MAX_AGE_MS = 20 * 60 * 1000;

export const useFeed = create<FeedState>()(
  persist(
    (set, get) => ({
      items: [],
      updatedAt: null,
      channelsKey: '',
      refreshing: false,
      failed: [],
      error: null,
      refresh: async () => {
        if (get().refreshing) return;
        const channels = useSubscriptions.getState().channels;
        if (channels.length === 0) {
          set({ items: [], updatedAt: Date.now(), channelsKey: '', failed: [], error: null });
          return;
        }
        set({ refreshing: true, error: null });
        try {
          const ids = channels.map((c) => c.id);
          const result = await youtube().feed(ids);
          set({
            items: mergeFeed(get().items, result.items, ids, result.failed.map((f) => f.channelId)),
            updatedAt: Date.now(),
            channelsKey: subscriptionsKey(channels),
            failed: result.failed,
            refreshing: false,
          });
        } catch (e) {
          set({ refreshing: false, error: e instanceof Error ? e.message : String(e) });
        }
      },
    }),
    {
      name: 'lite-social.youtube.feed',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ items: s.items, updatedAt: s.updatedAt, channelsKey: s.channelsKey }),
    },
  ),
);

// --------------------------------------------------------------------- settings

export const MP3_BITRATES = [128, 192, 256, 320] as const;
export const VIDEO_HEIGHTS = [480, 720, 1080] as const;
/** Playback quality choices in Settings; the player itself offers every height a video has. */
export const PLAYBACK_HEIGHTS = ['auto', 360, 480, 720, 1080] as const;

interface YouTubeSettingsState {
  /** Where MP3s go: the folder Musicolet plays from. */
  musicFolder: MusicFolder | null;
  /** Subfolder used last time, offered first next time. */
  lastFolderPath: string[];
  mp3Kbps: number;
  videoMaxHeight: number;
  /** Quality picked in the player, kept for the next videos. Null: automatic. */
  playbackHeight: number | null;
  /** Language of the captions picked in the player (e.g. "zh-CN"), turned on again where a video has it. Null: off. */
  captionLanguage: string | null;
  setMusicFolder: (folder: MusicFolder | null) => void;
  setLastFolderPath: (path: string[]) => void;
  setMp3Kbps: (kbps: number) => void;
  setVideoMaxHeight: (height: number) => void;
  setPlaybackHeight: (height: number | null) => void;
  setCaptionLanguage: (language: string | null) => void;
}

export const useYouTubeSettings = create<YouTubeSettingsState>()(
  persist(
    (set) => ({
      musicFolder: null,
      lastFolderPath: [],
      mp3Kbps: 192,
      videoMaxHeight: 1080,
      playbackHeight: null,
      captionLanguage: null,
      setMusicFolder: (musicFolder) => set({ musicFolder, lastFolderPath: [] }),
      setLastFolderPath: (lastFolderPath) => set({ lastFolderPath }),
      setMp3Kbps: (mp3Kbps) => set({ mp3Kbps }),
      setVideoMaxHeight: (videoMaxHeight) => set({ videoMaxHeight }),
      setPlaybackHeight: (playbackHeight) => set({ playbackHeight }),
      setCaptionLanguage: (captionLanguage) => set({ captionLanguage }),
    }),
    { name: 'lite-social.youtube.settings', version: 1, storage: createJSONStorage(() => AsyncStorage) },
  ),
);
