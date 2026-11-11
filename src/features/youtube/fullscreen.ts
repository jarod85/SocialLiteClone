/**
 * The watch screen's own full screen (modules/youtube Fullscreen.kt): the app
 * turns sideways and hides the system bars, and the video fills the screen
 * with the app's quality and captions buttons still on it. (The player's
 * built-in full screen has neither.) Swipes on the video set the brightness
 * (left half) and volume (right half) there (modules/youtube SwipeAdjust.kt).
 */
import { AppState } from 'react-native';
import { create } from 'zustand';

import { youtube, youtubeAvailable } from './native';
import type { SwipeLevel } from './types';

export const useFullscreen = create<{ on: boolean }>()(() => ({ on: false }));

/** The level the last swipe set, while it shows on the video (until shortly after the swipe). */
export const useSwipeLevel = create<{ swipe: SwipeLevel | null }>()(() => ({ swipe: null }));

const SWIPE_LEVEL_MS = 800;

let listening = false;
let swipeTimer: ReturnType<typeof setTimeout> | undefined;

function listen(): void {
  if (listening || !youtubeAvailable) return;
  listening = true;
  youtube().addListener('onFullscreenExitRequest', () => exitFullscreen());
  youtube().addListener('onSwipeAdjust', (swipe) => {
    useSwipeLevel.setState({ swipe });
    clearTimeout(swipeTimer);
    swipeTimer = setTimeout(() => useSwipeLevel.setState({ swipe: null }), SWIPE_LEVEL_MS);
  });
  // Coming back to the app can bring the system bars back.
  AppState.addEventListener('change', (state) => {
    if (state === 'active' && useFullscreen.getState().on) void youtube().setFullscreen(true);
  });
}

export function enterFullscreen(): void {
  if (!youtubeAvailable) return;
  listen();
  useFullscreen.setState({ on: true });
  void youtube().setFullscreen(true);
}

export function exitFullscreen(): void {
  if (!useFullscreen.getState().on) return;
  useFullscreen.setState({ on: false });
  if (youtubeAvailable) void youtube().setFullscreen(false);
}
