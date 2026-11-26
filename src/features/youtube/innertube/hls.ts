/** Phones gain nothing from more; as on Android (Playback.kt MAX_HEIGHT). */
const MAX_HEIGHT = 1080;

/**
 * The heights of a YouTube HLS master playlist's H.264 variants, highest first.
 * Only H.264: every iPhone decodes it in hardware, and it's what the quality cap picks from.
 */
export function hlsHeights(master: string): number[] {
  const heights = new Set<number>();
  for (const line of master.split('\n')) {
    if (!line.startsWith('#EXT-X-STREAM-INF:') || !/CODECS="avc1/.test(line)) continue;
    const height = Number(line.match(/RESOLUTION=\d+x(\d+)/)?.[1]);
    if (height > 0 && height <= MAX_HEIGHT) heights.add(height);
  }
  return [...heights].sort((a, b) => b - a);
}

/** Frame rate of the variants at `height` (the highest), e.g. 60. */
export function hlsFrameRate(master: string, height: number): number {
  let best = 0;
  for (const line of master.split('\n')) {
    if (!line.startsWith('#EXT-X-STREAM-INF:') || !line.includes(`x${height},`)) continue;
    best = Math.max(best, Number(line.match(/FRAME-RATE=([\d.]+)/)?.[1] ?? 0));
  }
  return Math.round(best);
}
