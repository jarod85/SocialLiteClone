/**
 * The one YouTube player, shared by the watch screen and the mini player.
 *
 * It outlives screens on purpose: leaving the watch screen, the YouTube
 * section or the app keeps the sound going ("play as you go"), with the
 * now-playing notification and lock-screen controls. With the screen off it
 * keeps playing too (expo-video's background playback service).
 */
import { createVideoPlayer, type VideoPlayer, type VideoSource } from 'expo-video';
import { create } from 'zustand';

import type { VideoDetails } from './types';

interface PlayerState {
  current: VideoDetails | null;
  /** Which of current.sources is playing; the next one is tried if it fails. */
  sourceIndex: number;
  error: string | null;
}

export const usePlayer = create<PlayerState>()(() => ({ current: null, sourceIndex: 0, error: null }));

let player: VideoPlayer | null = null;

export function getPlayer(): VideoPlayer {
  if (player) return player;
  const p = createVideoPlayer(null);
  p.staysActiveInBackground = true;
  p.showNowPlayingNotification = true;
  p.timeUpdateEventInterval = 1;
  p.audioMixingMode = 'doNotMix';
  p.addListener('statusChange', ({ status, error }) => {
    if (status === 'error') void tryNextSource(error?.message);
  });
  player = p;
  return p;
}

function sourceFor(details: VideoDetails, index: number): VideoSource {
  const source = details.sources[index];
  return {
    uri: source.uri,
    contentType: source.contentType,
    metadata: {
      title: details.title,
      artist: details.channelName ?? undefined,
      artwork: details.thumbnail ?? undefined,
    },
  };
}

/** Starts a video (or keeps it going if it's already the current one). */
export async function play(details: VideoDetails): Promise<void> {
  const p = getPlayer();
  const { current } = usePlayer.getState();
  if (current?.id === details.id && p.status !== 'error') {
    p.play();
    return;
  }
  if (details.sources.length === 0) {
    usePlayer.setState({ current: details, sourceIndex: 0, error: 'No playable version of this video was found.' });
    return;
  }
  usePlayer.setState({ current: details, sourceIndex: 0, error: null });
  await p.replaceAsync(sourceFor(details, 0));
  p.play();
}

async function tryNextSource(message: string | undefined): Promise<void> {
  const { current, sourceIndex } = usePlayer.getState();
  if (!current || !player) return;
  const next = sourceIndex + 1;
  if (next >= current.sources.length) {
    usePlayer.setState({ error: message ? `Couldn't play this video: ${message}` : "Couldn't play this video." });
    return;
  }
  const position = player.currentTime;
  usePlayer.setState({ sourceIndex: next });
  await player.replaceAsync(sourceFor(current, next));
  if (position > 0) player.currentTime = position;
  player.play();
}

/** Stops playback and removes the mini player and notification. */
export function stop(): void {
  if (player) {
    player.pause();
    void player.replaceAsync(null);
  }
  usePlayer.setState({ current: null, sourceIndex: 0, error: null });
}

export function pause(): void {
  player?.pause();
}
