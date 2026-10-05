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
