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
 * The page a link into the app asks to start on, e.g. `?open=messages` from a
 * message alert. Only named targets from the platform's own config are
 * accepted, never a path from the link itself, since any app can send us links.
 */
export function startPath(platform: PlatformConfig, open: string | string[] | undefined): string | undefined {
  return open === 'messages' ? platform.messagesPath : undefined;
}
