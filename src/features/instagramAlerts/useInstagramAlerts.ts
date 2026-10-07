import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { getStatus, type InstagramAlertsStatus } from './instagramAlerts';

/** Current alert status, re-read whenever the app comes back from Android's settings screens. */
export function useInstagramAlerts(): [InstagramAlertsStatus, () => void] {
  const [status, setStatus] = useState(getStatus);
  const refresh = useCallback(() => setStatus(getStatus()), []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  return [status, refresh];
}
