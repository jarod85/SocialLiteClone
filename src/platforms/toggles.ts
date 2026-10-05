import type { Toggles } from '@/core/types';

import type { PlatformConfig } from './types';

/** A platform's toggles with the user's overrides applied; anything not overridden uses its default. */
export function effectiveToggles(platform: PlatformConfig, overrides: Record<string, boolean> | undefined): Toggles {
  const toggles: Toggles = {};
  for (const t of platform.toggles) toggles[t.id] = overrides?.[t.id] ?? t.default;
  return toggles;
}
