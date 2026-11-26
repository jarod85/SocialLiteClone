/**
 * The watch screen's own full screen (modules/youtube Fullscreen.kt): the app
 * turns sideways and hides the system bars, and the video fills the screen
 * with the app's quality and captions buttons still on it. (The player's
 * built-in full screen has neither.) Swipes on the video set the brightness
 * (left half) and volume (right half) there (modules/youtube SwipeAdjust.kt).
 */
import * as ScreenOrientation from 'expo-screen-orientation';
import { setStatusBarHidden } from 'expo-status-bar';
import { AppState } from 'react-native';
import { create } from 'zustand';

import { youtube, youtubeAvailable, youtubeFeatures } from './native';
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

/** iOS: sideways without the status bar, or back upright (the app is otherwise portrait only). */
function setIosFullscreen(enabled: boolean): void {
  setStatusBarHidden(enabled, 'fade');
  const lock = enabled ? ScreenOrientation.OrientationLock.LANDSCAPE : ScreenOrientation.OrientationLock.PORTRAIT_UP;
  void ScreenOrientation.lockAsync(lock).catch(() => undefined);
}

export function enterFullscreen(): void {
  if (!youtubeAvailable) return;
  useFullscreen.setState({ on: true });
  if (!youtubeFeatures.nativeFullscreen) return setIosFullscreen(true);
  listen();
  void youtube().setFullscreen(true);
}

export function exitFullscreen(): void {
  if (!useFullscreen.getState().on) return;
  useFullscreen.setState({ on: false });
  if (!youtubeFeatures.nativeFullscreen) return setIosFullscreen(false);
  if (youtubeAvailable) void youtube().setFullscreen(false);
}
