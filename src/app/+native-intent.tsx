import { routeForLink } from '@/features/youtube/links';

const YOUTUBE_URL = /^(https?:\/\/)?(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i;

/**
 * YouTube links opened with Lite Social ("Open with" from a chat, a browser,
 * etc.) go to its own YouTube player. Everything else, including the app's
 * own litesocial:// links, passes through unchanged.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    if (YOUTUBE_URL.test(path)) return routeForLink(path) ?? '/youtube';
    return path;
  } catch {
    return '/';
  }
}
