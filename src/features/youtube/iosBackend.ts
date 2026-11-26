/**
 * The YouTube backend on iOS: Lite Social's own TypeScript engine (innertube/) for
 * everything YouTube serves, and the iOS side of modules/youtube for what needs the
 * device. It has the same shape as the Android module, so screens don't care which runs.
 */
import type { VideoPlayer } from 'expo-video';

import { engine } from './innertube';
import type { DownloadUpdate } from './types';

/** The Swift module (modules/youtube/ios). */
export interface IosYouTubeModule {
  /** Caps the height AVPlayer picks from the HLS manifest; null lets it pick freely. */
  capVideoHeight(player: VideoPlayer, height: number | null): Promise<void>;
  addListener(event: string, listener: (event: any) => void): { remove(): void };
  emit(event: string, payload: unknown): void;
}

const unsupported = (what: string) => () => {
  throw new Error(`${what} isn't available on iPhone.`);
};

export function createIosBackend(native: IosYouTubeModule) {
  return {
    ...engine,
    // Downloads: modules/youtube/ios (next step of the iOS port).
    startDownload: unsupported('Downloading') as (options: object) => string,
    cancelDownload: (_id: string) => undefined,
    getDownloads: (): DownloadUpdate[] => [],
    clearFinishedDownloads: () => undefined,
    // Musicolet folders are Android-only: iOS saves audio to the Files app.
    pickMusicFolder: async () => null,
    hasMusicFolderAccess: (_tree: string) => false,
    listFolders: unsupported('Choosing a music folder') as () => Promise<string[]>,
    createFolder: unsupported('Choosing a music folder') as () => Promise<string>,
    describeFolder: (_tree: string, _path: string[]) => '',
    isMusicoletInstalled: () => false,
    // Full screen and zoom run in JavaScript on iOS (fullscreen.ts, ZoomableVideo).
    setFullscreen: async (_enabled: boolean) => undefined,
    attachZoom: async (_viewTag: number) => false,
    resetZoom: async () => undefined,
    addListener: (event: string, listener: (event: any) => void) => native.addListener(event, listener),
  };
}
