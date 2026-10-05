import { useEffect } from 'react';

import { LockOverlay } from './LockOverlay';
import { useDailyLimit, useUsageTracking } from './useDailyLimit';

interface Props {
  /** True while the browser screen is visible. Time only counts then. */
  active: boolean;
  /** Called when the lock appears, e.g. to pause media in the page. */
  onLock: () => void;
  onClose: () => void;
}

/**
 * Tracks today's time and shows the break screen once the limit is reached.
 * A separate component so the per-tick usage updates re-render only this,
 * never the WebView next to it.
 */
export function DailyLimitGate({ active, onLock, onClose }: Props) {
  const limit = useDailyLimit();
  useUsageTracking(active && !limit.locked);

  useEffect(() => {
    if (limit.locked) onLock();
  }, [limit.locked, onLock]);

  if (!limit.locked) return null;
  return (
    <LockOverlay
      usedMinutes={Math.floor(limit.usedSeconds / 60)}
      limitMinutes={limit.limitMinutes}
      canSnooze={limit.canSnooze}
      onSnooze={limit.snooze}
      onClose={onClose}
    />
  );
}
