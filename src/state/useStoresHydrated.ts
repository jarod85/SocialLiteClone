import { useEffect, useState } from 'react';

import { useUpdates } from '@/features/updates/updates';
import { useFeed, useSubscriptions, useYouTubeSettings } from '@/features/youtube/stores';

import { useLeaks } from './leakStore';
import { useSettings } from './settingsStore';
import { useUsage } from './usageStore';

const stores = [useSettings, useUsage, useLeaks, useSubscriptions, useFeed, useYouTubeSettings, useUpdates];
const allHydrated = () => stores.every((s) => s.persist.hasHydrated());

/**
 * True once persisted settings are loaded. The WebView waits for this, so a page
 * never loads with default toggles and then flips to the saved ones.
 */
export function useStoresHydrated(): boolean {
  const [hydrated, setHydrated] = useState(allHydrated);
  useEffect(() => {
    if (hydrated) return;
    const check = () => {
      if (allHydrated()) setHydrated(true);
    };
    const unsubscribes = stores.map((s) => s.persist.onFinishHydration(check));
    check();
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [hydrated]);
  return hydrated;
}
