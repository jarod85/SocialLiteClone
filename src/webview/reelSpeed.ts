/** The full-screen reel player's speed slide (ReelViewer.tsx), kept pure for tests. */

/** Speed range of the slide along the left side. */
export const MIN_SPEED = 0.5;
export const MAX_SPEED = 2;
/** Sliding this share of the screen height goes from the slowest to the fastest speed. */
const SPEED_TRAVEL = 0.55;

/** The speed a slide along the left side lands on: up is faster, in steps of 0.05x. */
export function speedForSlide(startSpeed: number, dy: number, screenHeight: number): number {
  const range = MAX_SPEED - MIN_SPEED;
  const raw = startSpeed - (dy / (screenHeight * SPEED_TRAVEL)) * range;
  const stepped = Math.round(raw / 0.05) * 0.05;
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, Number(stepped.toFixed(2))));
}
