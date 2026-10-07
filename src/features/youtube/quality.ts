import type { VideoQuality } from './types';

/**
 * The quality to play for a preferred height: the highest one not above it,
 * or the lowest one if all are higher. Null (automatic) if there is no
 * preference or the video has no qualities to pick from (live streams).
 */
export function pickQuality(qualities: VideoQuality[], preferredHeight: number | null): VideoQuality | null {
  if (preferredHeight == null || qualities.length === 0) return null;
  const sorted = [...qualities].sort((a, b) => b.height - a.height);
  return sorted.find((q) => q.height <= preferredHeight) ?? sorted[sorted.length - 1];
}
