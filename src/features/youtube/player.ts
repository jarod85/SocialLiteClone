/**
 * The one YouTube player, shared by the watch screen and the mini player.
 *
 * It outlives screens on purpose: leaving the watch screen, the YouTube
 * section or the app keeps the sound going ("play as you go"), with the
 * now-playing notification and lock-screen controls. With the screen off it
 * keeps playing too (expo-video's background playback service).
 *
 * Started from a playlist, it goes on to the playlist's next video when one
 * ends (with Autoplay on), and from the last back to the first with Loop
 * playlist on. Nothing else ever plays by itself.
 */
import { createVideoPlayer, type SubtitleTrack, type VideoPlayer, type VideoSource } from 'expo-video';
import { create } from 'zustand';

import { pickCaption } from './captions';
import { watchUrl, youtube } from './native';
import { findPlaylist, stepInPlaylist, type Playlist } from './playlists';
import { pickQuality } from './quality';
import { useYouTubeSettings } from './stores';
import type { PlaybackSource, VideoDetails } from './types';

/** The playlist a video was started from. */
export interface Queue {
  playlistId: string;
  /** The playlist video playing, or loading to play next. */
  videoId: string;
  /** Where it was in the playlist when it started (it may have been moved or taken out since). */
  index: number;
  /** The video that was playing when the playlist went on to this one, so a watch screen showing it can follow. */
  from: string | null;
}

interface PlayerState {
  current: VideoDetails | null;
  /** Which of current.sources is playing; the next one is tried if it fails. */
  sourceIndex: number;
  /** Height of the quality picked by hand (one of current.qualities), or null for automatic. */
  quality: number | null;
  /** Id of the captions showing (one of current.captions), or null when off. */
  caption: string | null;
  /** The playing source carries the video's captions (only Lite Social's own DASH manifests do). */
  captionsAvailable: boolean;
  /** Set when captions were turned off because the video stopped with them. */
  captionError: string | null;
  /** Play the current video again from the start when it ends. Off for each new video. */
  loop: boolean;
  /** Set while playing a playlist; null for a video opened on its own. */
  queue: Queue | null;
  /** Set when a playlist video couldn't be played and was skipped. */
  queueError: string | null;
  error: string | null;
}

const idle = {
  current: null,
  sourceIndex: 0,
  quality: null,
  caption: null,
  captionsAvailable: false,
  captionError: null,
  loop: false,
  queue: null,
  queueError: null,
  error: null,
};

export const usePlayer = create<PlayerState>()(() => ({ ...idle }));

let player: VideoPlayer | null = null;
/** The source loaded into the player, to reload it in place. */
let loaded: PlaybackSource | null = null;
/**
 * Captions to show (an id from current.captions); applied whenever the
 * player's tracks change. The app is the only one that picks captions (the
 * player's own CC button is hidden), so this is always what's showing.
 */
let wantedCaption: string | null = null;
/** Counts loaded sources; with the caption id it tells whether the captions are set for this source yet. */
let generation = 0;
let appliedCaption = '';
/** The generation that played to the end, so one ending moves a playlist on only once. */
let endedGeneration = -1;

export function getPlayer(): VideoPlayer {
  if (player) return player;
  const p = createVideoPlayer(null);
  p.staysActiveInBackground = true;
  p.showNowPlayingNotification = true;
  p.timeUpdateEventInterval = 1;
  p.audioMixingMode = 'doNotMix';
  p.addListener('statusChange', ({ status, error }) => {
    if (status === 'error') void recover(error?.message);
  });
  p.addListener('availableSubtitleTracksChange', ({ availableSubtitleTracks }) => applyCaption(availableSubtitleTracks));
  p.addListener('playToEnd', () => void playedToEnd());
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

/** Puts a source into the player, keeping the position if asked, and restores the captions. */
async function load(details: VideoDetails, source: PlaybackSource, position = 0, playAfter = true): Promise<void> {
  const p = getPlayer();
  loaded = source;
  generation++;
  await p.replaceAsync(sourceFor(details, source));
  if (position > 0) p.currentTime = position;
  if (playAfter) p.play();
  usePlayer.setState({ captionsAvailable: source.contentType === 'dash' && details.captions.length > 0 && !details.isLive });
  applyCaption(p.availableSubtitleTracks);
}

/** Shows the wanted captions once the player lists them; hides captions when none are wanted. */
function applyCaption(tracks: SubtitleTrack[]): void {
  if (!player) return;
  if (wantedCaption === null) {
    appliedCaption = '';
    if (player.subtitleTrack) player.subtitleTrack = null;
    usePlayer.setState({ caption: null });
    return;
  }
  const track = tracks.find((t) => t.id === wantedCaption);
  if (!track) return;
  // Once per source, even if it seems set already: after a source change the player can still report the old source's track.
  const key = `${generation}:${track.id}`;
  if (appliedCaption === key) return;
  appliedCaption = key;
  player.subtitleTrack = track;
  usePlayer.setState({ caption: track.id });
}

/** Keeps the language of picked captions for the next videos (null: off). */
function rememberCaption(id: string | null): void {
  wantedCaption = id;
  const track = usePlayer.getState().current?.captions.find((c) => c.id === id);
  useYouTubeSettings.getState().setCaptionLanguage(track?.language ?? null);
}

/**
 * Starts a video (or keeps it going if it's already the current one). A video
 * that isn't the playlist's next one leaves the playlist.
 */
export async function play(details: VideoDetails): Promise<void> {
  const p = getPlayer();
  const { current, queue, queueError } = usePlayer.getState();
  if (current?.id === details.id && p.status !== 'error') {
    p.play();
    return;
  }
  p.loop = false;
  const inPlaylist = queue?.videoId === details.id ? { queue, queueError } : {};
  if (details.sources.length === 0) {
    usePlayer.setState({ ...idle, ...inPlaylist, current: details, error: 'No playable version of this video was found.' });
    return;
  }
  const settings = useYouTubeSettings.getState();
  const quality = pickQuality(details.qualities, settings.playbackHeight);
  const video = { ...details, captions: details.captions ?? [] };
  wantedCaption = pickCaption(video.captions, settings.captionLanguage)?.id ?? null;
  usePlayer.setState({ ...idle, ...inPlaylist, current: video, quality: quality?.height ?? null });
  await load(video, quality ? { uri: quality.uri, contentType: 'dash' } : video.sources[0]);
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
  await load(current, source, position, wasPlaying);
}

/** Shows captions (an id from current.captions) or hides them (null); the language is kept for the next videos. */
export function setCaption(id: string | null): void {
  rememberCaption(id);
  usePlayer.setState({ captionError: null });
  if (player) applyCaption(player.availableSubtitleTracks);
}

export function setLoop(loop: boolean): void {
  getPlayer().loop = loop;
  usePlayer.setState({ loop });
}

/**
 * After a playback error: if captions were on, they may be what failed to
 * load, so the same version plays again without them first. Otherwise a
 * hand-picked quality falls back to automatic, then down the list of sources.
 */
async function recover(message: string | undefined): Promise<void> {
  const { current, sourceIndex, quality, caption } = usePlayer.getState();
  if (!current || !player) return;
  const position = player.currentTime;
  if (caption !== null && loaded) {
    wantedCaption = null;
    usePlayer.setState({ caption: null, captionError: "Playback failed with captions on, so they were turned off." });
    await load(current, loaded, position);
    return;
  }
  const next = quality != null ? 0 : sourceIndex + 1;
  if (next >= current.sources.length) {
    usePlayer.setState({ error: message ? `Couldn't play this video: ${message}` : "Couldn't play this video." });
    // In a playlist with Autoplay on, go on rather than stop at this one.
    if (usePlayer.getState().queue?.videoId === current.id && useYouTubeSettings.getState().autoplay) {
      await skip(1, `Skipped "${current.title}": ${message ?? "it couldn't be played"}`);
    }
    return;
  }
  usePlayer.setState({ sourceIndex: next, quality: null });
  await load(current, current.sources[next], position);
}

// --------------------------------------------------------------------- playlists

/**
 * Plays `playlist` from `index` once the watch screen opens that video (it
 * loads and plays it as usual), then the rest of the playlist after it.
 */
export function startPlaylist(playlist: Playlist, index: number): void {
  const video = playlist.videos[index];
  if (!video) return;
  usePlayer.setState({ queue: { playlistId: playlist.id, videoId: video.id, index, from: null }, queueError: null });
  if (usePlayer.getState().current?.id === video.id) restart();
}

/**
 * Plays the playlist's next (1) or previous (-1) video. Past either end it
 * stays where it is, unless Loop playlist is on.
 */
export async function skip(step: 1 | -1, note: string | null = null): Promise<void> {
  const { queue } = usePlayer.getState();
  const playlist = queue ? findPlaylist(queue.playlistId) : undefined;
  if (!queue || !playlist) return;
  const index = stepInPlaylist(ids(playlist), queue.videoId, queue.index, step, useYouTubeSettings.getState().loopPlaylist);
  usePlayer.setState({ queueError: note });
  if (index !== null) await playAt(playlist, index, step);
}

/** Plays the video at `index` of the playlist playing now (tapped in its list on the watch screen). */
export async function playInPlaylist(index: number): Promise<void> {
  const { queue } = usePlayer.getState();
  const playlist = queue ? findPlaylist(queue.playlistId) : undefined;
  if (!playlist) return;
  // The one playing carries on (or starts again if it ended).
  if (playlist.videos[index]?.id === usePlayer.getState().current?.id) {
    startPlaylist(playlist, index);
    return;
  }
  usePlayer.setState({ queueError: null });
  await playAt(playlist, index, 1);
}

const ids = (playlist: Playlist) => playlist.videos.map((v) => v.id);

/** At the end of a playlist video, with Autoplay on (Loop on the video itself repeats it instead, and never ends). */
async function playedToEnd(): Promise<void> {
  if (endedGeneration === generation || !player || player.loop) return;
  endedGeneration = generation;
  const { queue, current } = usePlayer.getState();
  if (queue && current?.id === queue.videoId && useYouTubeSettings.getState().autoplay) await skip(1);
}

/** Plays the current video on, or from the start if it has ended. */
function restart(): void {
  const p = getPlayer();
  endedGeneration = -1;
  if (p.duration > 0 && p.currentTime >= p.duration - 1) p.currentTime = 0;
  p.play();
}

/**
 * Loads and plays the video at `index`. One that can't be played is skipped,
 * in the direction of `step`, going round the playlist at most once.
 */
async function playAt(playlist: Playlist, index: number, step: 1 | -1, tried = 0): Promise<void> {
  const video = playlist.videos[index];
  if (!video) return;
  const queue: Queue = { playlistId: playlist.id, videoId: video.id, index, from: usePlayer.getState().current?.id ?? null };
  usePlayer.setState({ queue });
  if (usePlayer.getState().current?.id === video.id && getPlayer().status !== 'error') {
    // The same video again (a one-video playlist on loop, say): from the start.
    getPlayer().currentTime = 0;
    restart();
    return;
  }
  let problem: string;
  try {
    const details = await youtube().video(watchUrl(video.id));
    // Something else started meanwhile: another video, another skip, or Stop.
    if (usePlayer.getState().queue !== queue) return;
    if (!details.isShort && details.sources.length > 0) {
      await play(details);
      return;
    }
    problem = details.isShort ? 'Shorts are hidden' : 'no playable version was found';
  } catch (e) {
    if (usePlayer.getState().queue !== queue) return;
    problem = e instanceof Error ? e.message : String(e);
  }
  usePlayer.setState({ queueError: `Skipped "${video.title}": ${problem}` });
  const latest = findPlaylist(playlist.id);
  if (!latest || tried + 1 >= latest.videos.length) return;
  const next = stepInPlaylist(ids(latest), video.id, index, step, useYouTubeSettings.getState().loopPlaylist);
  if (next !== null) await playAt(latest, next, step, tried + 1);
}

/** Stops playback and removes the mini player and notification. */
export function stop(): void {
  if (player) {
    player.pause();
    player.loop = false;
    void player.replaceAsync(null);
  }
  loaded = null;
  wantedCaption = null;
  appliedCaption = '';
  usePlayer.setState({ ...idle });
}

export function pause(): void {
  player?.pause();
}
