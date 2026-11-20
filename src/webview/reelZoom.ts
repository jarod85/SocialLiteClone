/** The full-screen reel player's pinch zoom (ReelViewer.tsx), kept pure for tests. */

export const MAX_ZOOM = 5;

/** The video's transform: scaled about the screen's center, then moved by x and y. */
export interface Zoom {
  scale: number;
  x: number;
  y: number;
}

/** The fingers on the screen: their midpoint, the spread of the first two (0 with one finger), how many. */
export interface Fingers {
  x: number;
  y: number;
  d: number;
  n: number;
}

export const NO_ZOOM: Zoom = { scale: 1, x: 0, y: 0 };

export function fingersOf(touches: readonly { pageX: number; pageY: number }[]): Fingers {
  const n = touches.length;
  if (n === 0) return { x: 0, y: 0, d: 0, n };
  const x = touches.reduce((sum, t) => sum + t.pageX, 0) / n;
  const y = touches.reduce((sum, t) => sum + t.pageY, 0) / n;
  const d = n >= 2 ? Math.hypot(touches[1].pageX - touches[0].pageX, touches[1].pageY - touches[0].pageY) : 0;
  return { x, y, d, n };
}

/**
 * The zoom after the fingers moved from `prev` to `next`: the spot between
 * them stays under them, it follows them as they move (one finger keeps
 * moving it once the other lets go), and the video keeps covering the screen.
 */
export function zoomStep(zoom: Zoom, prev: Fingers, next: Fingers, width: number, height: number): Zoom {
  if (next.n !== prev.n || next.n === 0) return zoom; // A finger came or went: carry on from here.
  const scale = next.n >= 2 && prev.d > 0 ? clamp((zoom.scale * next.d) / prev.d, 1, MAX_ZOOM) : zoom.scale;
  const ratio = scale / zoom.scale;
  const cx = width / 2;
  const cy = height / 2;
  const maxX = ((scale - 1) * width) / 2;
  const maxY = ((scale - 1) * height) / 2;
  return {
    scale,
    x: clamp(next.x - cx - ratio * (prev.x - cx - zoom.x), -maxX, maxX),
    y: clamp(next.y - cy - ratio * (prev.y - cy - zoom.y), -maxY, maxY),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
