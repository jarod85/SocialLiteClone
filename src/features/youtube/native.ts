/**
 * Typed access to the native YouTube module (modules/youtube, Android only).
 * Missing on iOS and in Expo Go: `youtubeAvailable` is then false and calls throw.
 */
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import type { ChannelPage, DownloadFormat, DownloadUpdate, FeedResult, MusicFolder, Page, SearchItem, Video, VideoDetails } from './types';

interface YouTubeNativeModule {
  search(query: string, kind: 'all' | 'videos' | 'channels'): Promise<Page<SearchItem>>;
  more(token: string): Promise<Page<SearchItem>>;
  channel(idOrUrl: string): Promise<ChannelPage>;
  feed(channelIds: string[]): Promise<FeedResult>;
  video(url: string): Promise<VideoDetails>;
  parseVideoId(url: string): string | null;
  startDownload(options: {
    url: string;
    title: string;
    format: DownloadFormat;
    maxHeight: number;
    mp3Kbps: number;
    folderTree?: string;
    folderPath?: string[];
  }): string;
  cancelDownload(id: string): void;
  getDownloads(): DownloadUpdate[];
  clearFinishedDownloads(): void;
  pickMusicFolder(): Promise<MusicFolder | null>;
  hasMusicFolderAccess(tree: string): boolean;
  listFolders(tree: string, path: string[]): Promise<string[]>;
  /** Resolves to the folder name as stored (unsupported characters replaced). */
  createFolder(tree: string, path: string[], name: string): Promise<string>;
  describeFolder(tree: string, path: string[]): string;
  isMusicoletInstalled(): boolean;
  addListener(event: 'onDownloadUpdate', listener: (update: DownloadUpdate) => void): { remove(): void };
}

const module = Platform.OS === 'android' ? requireOptionalNativeModule<YouTubeNativeModule>('LiteSocialYouTube') : null;

export const youtubeAvailable = module !== null;

export function youtube(): YouTubeNativeModule {
  if (!module) throw new Error('YouTube needs the Android app (it is not available in Expo Go or on iOS).');
  return module;
}

export const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

export function videoPage(items: SearchItem[]): Video[] {
  return items.filter((i): i is Video => i.type === 'video');
}
