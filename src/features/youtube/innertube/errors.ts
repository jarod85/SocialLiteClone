/**
 * Errors from the iOS YouTube client, with the same codes and texts as the Android
 * module (modules/youtube/android/.../Errors.kt), so screens treat both alike
 * (e.g. ERR_YOUTUBE_BLOCKED opens YouTube's own player on the watch screen).
 */
export type YouTubeErrorCode = 'ERR_YOUTUBE_BLOCKED' | 'ERR_YOUTUBE_OFFLINE' | 'ERR_YOUTUBE_RESTRICTED' | 'ERR_YOUTUBE';

export class YouTubeError extends Error {
  constructor(
    readonly code: YouTubeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'YouTubeError';
  }
}

export const MESSAGES = {
  blocked:
    "YouTube is asking this network to prove it isn't a bot. Try again later or on another network (for example mobile data instead of Wi-Fi).",
  offline: 'No connection.',
  age: "This video is age-restricted and can't be watched without an account.",
  private: 'This video is private.',
  paid: 'This video is for paying members only.',
  country: "This video isn't available in your country.",
  unavailable: "This video isn't available.",
} as const;

/** What a player response's playabilityStatus means, or null if the video can play. */
export function playabilityError(status: { status?: string; reason?: string } | undefined): YouTubeError | null {
  const state = status?.status ?? '';
  if (state === 'OK') return null;
  const reason = status?.reason ?? '';
  if (/not a bot/i.test(reason)) return new YouTubeError('ERR_YOUTUBE_BLOCKED', MESSAGES.blocked);
  if (state.startsWith('AGE_') || /\bage\b|inappropriate/i.test(reason)) return new YouTubeError('ERR_YOUTUBE_RESTRICTED', MESSAGES.age);
  if (/private/i.test(reason)) return new YouTubeError('ERR_YOUTUBE_RESTRICTED', MESSAGES.private);
  if (/member/i.test(reason)) return new YouTubeError('ERR_YOUTUBE_RESTRICTED', MESSAGES.paid);
  if (/country/i.test(reason)) return new YouTubeError('ERR_YOUTUBE_RESTRICTED', MESSAGES.country);
  return new YouTubeError('ERR_YOUTUBE', reason || MESSAGES.unavailable);
}

/** Any failure while talking to YouTube, as a YouTubeError. */
export function networkError(e: unknown): YouTubeError {
  if (e instanceof YouTubeError) return e;
  // fetch rejects with a TypeError only when the request couldn't be made at all.
  if (e instanceof TypeError) return new YouTubeError('ERR_YOUTUBE_OFFLINE', MESSAGES.offline);
  const message = e instanceof Error ? e.message : String(e);
  return new YouTubeError('ERR_YOUTUBE', message.slice(0, 200));
}
