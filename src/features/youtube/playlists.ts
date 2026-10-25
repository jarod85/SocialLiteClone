/**
 * Playlists you make, stored on this phone like subscriptions (there is no
 * YouTube account, so they aren't YouTube's playlists). A video is in a
 * playlist at most once.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { Video, VideoDetails } from './types';

export interface Playlist {
  id: string;
  title: string;
  /** In play order. */
  videos: Video[];
  createdAt: number;
  updatedAt: number;
}

interface PlaylistsState {
  /** Newest first. */
  playlists: Playlist[];
  /** Makes an empty playlist (or one with `video` in it) and returns its id. */
  create: (title: string, video?: Video) => string;
  rename: (id: string, title: string) => void;
  remove: (id: string) => void;
  /** Adds at the end, unless it's in there already. */
  addVideo: (id: string, video: Video) => void;
  removeVideo: (id: string, videoId: string) => void;
  /** Moves the video at `from` to `to`, shifting the ones between. */
  moveVideo: (id: string, from: number, to: number) => void;
}

export const usePlaylists = create<PlaylistsState>()(
  persist(
    (set) => {
      const update = (id: string, change: (playlist: Playlist) => Playlist) =>
        set((s) => ({ playlists: s.playlists.map((p) => (p.id === id ? { ...change(p), updatedAt: Date.now() } : p)) }));
      return {
        playlists: [],
        create: (title, video) => {
          const now = Date.now();
          const playlist: Playlist = { id: newId(), title: cleanTitle(title), videos: video ? [video] : [], createdAt: now, updatedAt: now };
          set((s) => ({ playlists: [playlist, ...s.playlists] }));
          return playlist.id;
        },
        rename: (id, title) => update(id, (p) => ({ ...p, title: cleanTitle(title) })),
        remove: (id) => set((s) => ({ playlists: s.playlists.filter((p) => p.id !== id) })),
        addVideo: (id, video) => update(id, (p) => (p.videos.some((v) => v.id === video.id) ? p : { ...p, videos: [...p.videos, video] })),
        removeVideo: (id, videoId) => update(id, (p) => ({ ...p, videos: p.videos.filter((v) => v.id !== videoId) })),
        moveVideo: (id, from, to) => update(id, (p) => ({ ...p, videos: moveItem(p.videos, from, to) })),
      };
    },
    { name: 'lite-social.youtube.playlists', version: 1, storage: createJSONStorage(() => AsyncStorage) },
  ),
);

export function findPlaylist(id: string): Playlist | undefined {
  return usePlaylists.getState().playlists.find((p) => p.id === id);
}

function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function cleanTitle(title: string): string {
  return title.trim().slice(0, 150) || 'Playlist';
}

export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= items.length || to < 0 || to >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** What a playlist keeps of a video that is open in the player. */
export function videoFromDetails(details: VideoDetails): Video {
  return {
    type: 'video',
    id: details.id,
    url: details.url,
    title: details.title,
    channelName: details.channelName,
    channelId: details.channelId,
    thumbnail: details.thumbnail,
    durationSeconds: details.durationSeconds,
    uploadedAt: details.uploadedAt,
    viewCount: details.viewCount,
    isLive: details.isLive,
  };
}

/**
 * Position in a playlist one step on (1) or back (-1) from the video playing,
 * or null past either end. With `loop`, the ends wrap around instead.
 *
 * `index` is where the video was when it started: if it has been taken out of
 * the playlist since, the video after it has moved into that place.
 */
export function stepInPlaylist(videoIds: string[], videoId: string, index: number, step: 1 | -1, loop: boolean): number | null {
  const length = videoIds.length;
  if (length === 0) return null;
  const at = videoIds.indexOf(videoId);
  let target = at >= 0 ? at + step : step === 1 ? index : index - 1;
  if (target < 0 || target >= length) {
    if (!loop) return null;
    target = ((target % length) + length) % length;
  }
  return target;
}
