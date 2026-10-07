/** Shapes returned by the native YouTube module (modules/youtube). */

export interface Video {
  type: 'video';
  id: string;
  url: string;
  title: string;
  channelName?: string | null;
  channelId?: string | null;
  thumbnail?: string | null;
  durationSeconds?: number | null;
  /** Milliseconds since epoch. Exact from RSS, approximate ("3 days ago") otherwise. */
  uploadedAt?: number | null;
  uploadedText?: string | null;
  viewCount?: number | null;
  isLive?: boolean;
}

export interface Channel {
  type: 'channel';
  /** "UC…" */
  id: string;
  url: string;
  title: string;
  thumbnail?: string | null;
  subscriberCount?: number | null;
  description?: string | null;
  verified?: boolean;
}

export type SearchItem = Video | Channel;

export interface Page<T> {
  items: T[];
  /** Opaque token for the next page, or null at the end. */
  nextPage: string | null;
}

export interface ChannelPage {
  id: string;
  url: string;
  title: string;
  avatar?: string | null;
  banner?: string | null;
  subscriberCount?: number | null;
  description?: string | null;
  videos: Video[];
  nextPage: string | null;
}

export interface FeedResult {
  items: Video[];
  failed: { channelId: string; error: string }[];
}

export interface PlaybackSource {
  uri: string;
  contentType: 'dash' | 'hls' | 'progressive';
}

export interface VideoDetails {
  id: string;
  url: string;
  title: string;
  channelName?: string | null;
  channelId?: string | null;
  channelAvatar?: string | null;
  thumbnail?: string | null;
  description: string;
  durationSeconds?: number | null;
  uploadedAt?: number | null;
  viewCount?: number | null;
  likeCount?: number | null;
  isShort: boolean;
  isLive: boolean;
  /** Best first; the player falls back to the next if one fails to load. */
  sources: PlaybackSource[];
}

export type DownloadFormat = 'mp4' | 'mp3';

export type DownloadState = 'queued' | 'downloading' | 'converting' | 'saving' | 'done' | 'failed' | 'cancelled';

export interface DownloadUpdate {
  id: string;
  title: string;
  format: DownloadFormat;
  state: DownloadState;
  /** 0..1 */
  progress: number;
  savedTo?: string | null;
  fileUri?: string | null;
  error?: string | null;
}

export interface MusicFolder {
  /** Storage Access Framework tree URI. */
  uri: string;
  name: string;
}

/** A subscribed channel, as stored on the phone. */
export interface Subscription {
  id: string;
  title: string;
  thumbnail?: string | null;
}
