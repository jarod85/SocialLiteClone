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

import { pickQuality } from './quality';
import { useYouTubeSettings } from './stores';
import type { PlaybackSource, VideoDetails } from './types';

interface PlayerState {
  current: VideoDetails | null;
  /** Which of current.sources is playing; the next one is tried if it fails. */
  sourceIndex: number;
  /** Height of the quality picked by hand (one of current.qualities), or null for automatic. */
  quality: number | null;
  /** Play the current video again from the start when it ends. Off for each new video. */
  loop: boolean;
  error: string | null;
}

const idle = { current: null, sourceIndex: 0, quality: null, loop: false, error: null };

export const usePlayer = create<PlayerState>()(() => ({ ...idle }));

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

function sourceFor(details: VideoDetails, source: PlaybackSource): VideoSource {
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
  p.loop = false;
  if (details.sources.length === 0) {
    usePlayer.setState({ ...idle, current: details, error: 'No playable version of this video was found.' });
    return;
  }
  const quality = pickQuality(details.qualities, useYouTubeSettings.getState().playbackHeight);
  usePlayer.setState({ ...idle, current: details, quality: quality?.height ?? null });
  await p.replaceAsync(sourceFor(details, quality ? { uri: quality.uri, contentType: 'dash' } : details.sources[0]));
  p.play();
}

/**
 * Keeps a quality (a height, or null for automatic) for the next videos and
 * switches the current one to it, or the nearest below, where it is.
 */
export async function setQuality(height: number | null): Promise<void> {
  useYouTubeSettings.getState().setPlaybackHeight(height);
  const { current } = usePlayer.getState();
  if (!current || !player) return;
  const quality = pickQuality(current.qualities, height);
  const source = quality ? { uri: quality.uri, contentType: 'dash' as const } : current.sources[0];
  if (!source) return;
  const position = player.currentTime;
  const wasPlaying = player.playing;
  usePlayer.setState({ quality: quality?.height ?? null, sourceIndex: 0, error: null });
  await player.replaceAsync(sourceFor(current, source));
  if (position > 0) player.currentTime = position;
  if (wasPlaying) player.play();
}

export function setLoop(loop: boolean): void {
  getPlayer().loop = loop;
  usePlayer.setState({ loop });
}

async function tryNextSource(message: string | undefined): Promise<void> {
  const { current, sourceIndex, quality } = usePlayer.getState();
  if (!current || !player) return;
  // A hand-picked quality that fails falls back to automatic, then down the usual list.
  const next = quality != null ? 0 : sourceIndex + 1;
  if (next >= current.sources.length) {
    usePlayer.setState({ error: message ? `Couldn't play this video: ${message}` : "Couldn't play this video." });
    return;
  }
  const position = player.currentTime;
  usePlayer.setState({ sourceIndex: next, quality: null });
  await player.replaceAsync(sourceFor(current, current.sources[next]));
  if (position > 0) player.currentTime = position;
  player.play();
}

/** Stops playback and removes the mini player and notification. */
export function stop(): void {
  if (player) {
    player.pause();
    player.loop = false;
    void player.replaceAsync(null);
  }
  usePlayer.setState({ ...idle });
}

export function pause(): void {
  player?.pause();
}
