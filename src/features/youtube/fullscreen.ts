/**
 * The watch screen's own full screen (modules/youtube Fullscreen.kt): the app
 * turns sideways and hides the system bars, and the video fills the screen
 * with the app's quality and captions buttons still on it. (The player's
 * built-in full screen has neither.)
 */
import { AppState } from 'react-native';
import { create } from 'zustand';

import { youtube, youtubeAvailable } from './native';

export const useFullscreen = create<{ on: boolean }>()(() => ({ on: false }));

let listening = false;

function listen(): void {
  if (listening || !youtubeAvailable) return;
  listening = true;
  youtube().addListener('onFullscreenExitRequest', () => exitFullscreen());
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
