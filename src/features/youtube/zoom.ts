/**
 * Pinch to zoom on the watch screen's video (modules/youtube VideoZoom.kt).
 * The gesture runs natively on the player; this mirrors the zoom level so the
 * screen can offer a way back to 1×.
 */
import { findNodeHandle } from 'react-native';
import { create } from 'zustand';

import { youtube, youtubeAvailable } from './native';

export const useZoom = create<{ scale: number }>()(() => ({ scale: 1 }));

let listening = false;

/** Turns on pinch to zoom for a mounted VideoView (pass its ref). */
export function attachZoom(view: Parameters<typeof findNodeHandle>[0]): void {
  if (!youtubeAvailable || !view) return;
  if (!listening) {
    listening = true;
    youtube().addListener('onZoomChange', ({ scale }) => useZoom.setState({ scale }));
  }
  const tag = findNodeHandle(view);
  if (tag != null) void youtube().attachZoom(tag).catch(() => undefined);
}

export function resetZoom(): void {
  useZoom.setState({ scale: 1 });
  if (youtubeAvailable) void youtube().resetZoom().catch(() => undefined);
}
