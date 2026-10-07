/**
 * Download state for the UI. The work itself runs in the native
 * DownloadService (a foreground service), which keeps going with the app
 * closed; this store just mirrors its progress events.
 */
import { create } from 'zustand';

import { youtube, youtubeAvailable } from './native';
import { useYouTubeSettings } from './stores';
import type { DownloadFormat, DownloadUpdate } from './types';

interface DownloadsState {
  byId: Record<string, DownloadUpdate>;
}

export const useDownloads = create<DownloadsState>()(() => ({ byId: {} }));

let listening = false;

/** Starts mirroring native download events. Safe to call more than once. */
export function listenToDownloads(): void {
  if (listening || !youtubeAvailable) return;
  listening = true;
  const byId: Record<string, DownloadUpdate> = {};
  for (const d of youtube().getDownloads()) byId[d.id] = d;
  useDownloads.setState({ byId });
  youtube().addListener('onDownloadUpdate', (update) => {
    useDownloads.setState((s) => ({ byId: { ...s.byId, [update.id]: update } }));
  });
}

export function startDownload(video: { url: string; title: string }, format: DownloadFormat, folderPath: string[] = []): string {
  const settings = useYouTubeSettings.getState();
  const id = youtube().startDownload({
    url: video.url,
    title: video.title,
    format,
    maxHeight: settings.videoMaxHeight,
    mp3Kbps: settings.mp3Kbps,
    folderTree: format === 'mp3' ? settings.musicFolder?.uri : undefined,
    folderPath: format === 'mp3' ? folderPath : undefined,
  });
  useDownloads.setState((s) => ({
    byId: { ...s.byId, [id]: { id, title: video.title, format, state: 'queued', progress: 0 } },
  }));
  return id;
}

export function cancelDownload(id: string): void {
  youtube().cancelDownload(id);
}

export function clearFinished(): void {
  youtube().clearFinishedDownloads();
  useDownloads.setState((s) => ({
    byId: Object.fromEntries(Object.entries(s.byId).filter(([, d]) => !isFinished(d))),
  }));
}

export function isFinished(d: DownloadUpdate): boolean {
  return d.state === 'done' || d.state === 'failed' || d.state === 'cancelled';
}
