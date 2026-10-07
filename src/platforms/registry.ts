import { instagram } from './instagram';
import type { PlatformConfig } from './types';

/**
 * Every platform the app can open. Adding a platform means adding its config
 * file and listing it here.
 */
export const platforms: readonly PlatformConfig[] = [instagram];

export function getPlatform(id: string | undefined): PlatformConfig | undefined {
  return platforms.find((p) => p.id === id);
}

/**
 * The page a link into the app asks to start on, e.g. `?open=thread&thread=123`
 * from an Instagram alert. Only named targets from the platform's own config
 * are accepted, plus a numeric conversation id; never a path from the link
 * itself, since any app can send us links.
 */
export function startPath(
  platform: PlatformConfig,
  open: string | string[] | undefined,
  thread?: string | string[],
): string | undefined {
  switch (open) {
    case 'messages':
      return platform.messagesPath;
    case 'thread':
      if (platform.threadPath && typeof thread === 'string' && /^\d{1,40}$/.test(thread)) {
        return platform.threadPath.replace('{id}', thread);
      }
      return platform.messagesPath;
    case 'activity':
      return platform.activityPath;
    default:
      return undefined;
  }
}
