/**
 * Pinch to zoom on posts, the way the Instagram app does it: two fingers on a
 * photo or video lift it above the page, it grows and follows the fingers
 * (one finger keeps moving it once the other lets go), and it springs back
 * when they're both off the screen. Instagram's site scales neither its page
 * nor its pictures, so this is the only way to look closer.
 *
 * It all happens in the page: a copy of the photo (the file the page already
 * loaded) or a live drawing of the video's frames is laid over everything
 * while the fingers are down, and the original is hidden underneath so it
 * doesn't show twice. Nothing is fetched and nothing is sent to the app.
 */

export interface PinchZoomOptions {
  /** Elements the engine hid or collapsed: their pictures aren't zoomable. */
  hiddenSelector: string;
}

/** CSS pixels. Anything smaller is an avatar, an icon or a thumbnail strip. */
const MIN_MEDIA_SIZE = 120;
const MAX_SCALE = 5;
const SPRING_MS = 220;
/** How dark the page behind gets at full zoom, and how fast it gets there. */
const MAX_DIM = 0.85;
const DIM_PER_SCALE = 1.2;
/** A video frame bigger than this on its long side is drawn smaller: the copy only lives for a pinch. */
const MAX_CANVAS_SIDE = 1280;
/** The page's own taps stay off for this long after a pinch (Instagram likes a post on a double tap). */
const CLICK_GRACE_MS = 400;
/** How far up from the touched element to look for the picture when the touch lands on a layer above it. */
const MAX_ANCESTOR_STEPS = 8;

export interface Point {
  x: number;
  y: number;
  /** Distance between the two fingers, 0 with one finger. */
  d: number;
  n: number;
}

interface Pinch {
  /** The touches doing the zooming, by identifier. */
  ids: number[];
  original: HTMLElement;
  originalVisibility: string;
  layer: HTMLDivElement;
  copy: HTMLElement;
  left: number;
  top: number;
  scale: number;
  tx: number;
  ty: number;
  prev: Point | null;
  frame: number;
  ending: boolean;
  done: boolean;
}

/** Installs the touch handlers. `enabled()` is checked at the start of every pinch, so the setting applies live. */
export function installPinchZoom(enabled: () => boolean, options: PinchZoomOptions): void {
  let pinch: Pinch | null = null;
  let clicksOffUntil = 0;

  const listen = (type: string, handler: (event: Event) => void) =>
    // On window, capture phase: before the page's own handlers (and the reel viewer's on document).
    window.addEventListener(type, (event) => guard(() => handler(event)), { capture: true, passive: false });

  listen('touchstart', (event) => {
    const e = event as TouchEvent;
    if (pinch && !pinch.ending) {
      take(e);
      pinch.prev = points(e.touches, pinch.ids);
      return;
    }
    if (e.touches.length !== 2 || !enabled()) return;
    const media = mediaUnder(e.touches, e.target);
    if (!media) return;
    if (pinch) finish(pinch); // A new pinch while the last one springs back.
    pinch = begin(media, e.touches);
    if (pinch) take(e);
  });

  listen('touchmove', (event) => {
    const e = event as TouchEvent;
    if (!pinch || pinch.ending) return;
    take(e);
    move(pinch, points(e.touches, pinch.ids));
  });

  const lift = (event: Event) => {
    const e = event as TouchEvent;
    if (!pinch || pinch.ending) return;
    // Not taken: the page sees fingers lift, so whatever it started on the first touch can end.
    pinch.prev = points(e.touches, pinch.ids);
    if (!pinch.prev) {
      clicksOffUntil = Date.now() + CLICK_GRACE_MS;
      springBack(pinch);
    }
  };
  listen('touchend', lift);
  listen('touchcancel', lift);

  // The page may follow fingers with pointer events (a carousel swipe): not while zooming.
  listen('pointermove', (event) => {
    if (pinch && !pinch.ending && (event as PointerEvent).pointerType === 'touch') event.stopImmediatePropagation();
  });
  const noTap = (event: Event) => {
    if (Date.now() < clicksOffUntil) take(event);
  };
  listen('click', noTap);
  listen('dblclick', noTap);

  function take(event: Event) {
    if (event.cancelable) event.preventDefault();
    event.stopImmediatePropagation();
  }

  /** A post's photo or video under the fingers (or between them), big enough to be one. */
  function mediaUnder(touches: TouchList, target: EventTarget | null): HTMLImageElement | HTMLVideoElement | null {
    const a = touches[0];
    const b = touches[1];
    const spots = [
      { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 },
      { x: a.clientX, y: a.clientY },
      { x: b.clientX, y: b.clientY },
    ];
    for (const spot of spots) {
      const found = mediaAt(spot.x, spot.y, target instanceof Element ? target : null);
      if (found) return found;
    }
    return null;
  }

  function mediaAt(x: number, y: number, target: Element | null): HTMLImageElement | HTMLVideoElement | null {
    const under = typeof document.elementsFromPoint === 'function' ? document.elementsFromPoint(x, y) : [];
    for (const el of under) if (isMedia(el) && usable(el, x, y)) return el;
    // Instagram lays tap targets over its pictures, and some ignore hit testing: look around the touched element.
    let scope: Element | null = target;
    for (let step = 0; scope && step < MAX_ANCESTOR_STEPS; step++, scope = scope.parentElement) {
      for (const el of Array.from(scope.querySelectorAll('img, video'))) if (isMedia(el) && usable(el, x, y)) return el;
    }
    return null;
  }

  function usable(el: HTMLImageElement | HTMLVideoElement, x: number, y: number): boolean {
    const r = el.getBoundingClientRect();
    if (r.width < MIN_MEDIA_SIZE || r.height < MIN_MEDIA_SIZE) return false;
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return false;
    if (el.closest(options.hiddenSelector)) return false;
    if (el instanceof HTMLImageElement) return !!(el.currentSrc || el.src) && el.naturalWidth > 0;
    return el.readyState >= 2 || !!el.poster; // A video that hasn't played yet shows its cover.
  }

  function begin(original: HTMLImageElement | HTMLVideoElement, touches: TouchList): Pinch | null {
    const rect = original.getBoundingClientRect();
    const style = getComputedStyle(original);
    let copy: HTMLElement;
    let frame = 0;
    const cover = original instanceof HTMLVideoElement && original.readyState < 2 ? original.poster : '';
    if (original instanceof HTMLImageElement || cover) {
      const img = document.createElement('img');
      img.src = cover || (original as HTMLImageElement).currentSrc || (original as HTMLImageElement).src;
      img.alt = '';
      copy = img;
    } else {
      const canvas = document.createElement('canvas');
      const shrink = Math.min(1, MAX_CANVAS_SIDE / Math.max(original.videoWidth, original.videoHeight, 1));
      canvas.width = Math.max(1, Math.round(original.videoWidth * shrink));
      canvas.height = Math.max(1, Math.round(original.videoHeight * shrink));
      const context = canvas.getContext('2d');
      if (!context) return null;
      // Keeps drawing the video's frames, so it plays on while zoomed.
      const draw = () => {
        try {
          context.drawImage(original, 0, 0, canvas.width, canvas.height);
        } catch {
          // A frame that can't be drawn: keep the last one.
        }
        if (pinch?.copy === canvas) pinch.frame = requestAnimationFrame(draw);
      };
      draw();
      frame = requestAnimationFrame(draw);
      copy = canvas;
    }
    copy.style.cssText =
      `position:absolute;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;` +
      `margin:0;padding:0;border:0;max-width:none;max-height:none;` +
      `object-fit:${style.objectFit || 'fill'};object-position:${style.objectPosition || '50% 50%'};` +
      `border-radius:${style.borderRadius || '0'};transform-origin:0 0;will-change:transform`;

    const layer = document.createElement('div');
    layer.setAttribute('aria-hidden', 'true');
    layer.style.cssText =
      'position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483647;pointer-events:none;overflow:hidden;' +
      'background-color:rgba(0,0,0,0)';
    layer.appendChild(copy);
    document.documentElement.appendChild(layer);

    const originalVisibility = original.style.visibility;
    original.style.visibility = 'hidden';
    const ids = [touches[0].identifier, touches[1].identifier];
    return {
      ids,
      original,
      originalVisibility,
      layer,
      copy,
      left: rect.left,
      top: rect.top,
      scale: 1,
      tx: 0,
      ty: 0,
      prev: points(touches, ids),
      frame,
      ending: false,
      done: false,
    };
  }

  function springBack(p: Pinch) {
    p.ending = true;
    if (p.scale === 1 && p.tx === 0 && p.ty === 0) return finish(p);
    p.copy.style.transition = `transform ${SPRING_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`;
    p.layer.style.transition = `background-color ${SPRING_MS}ms ease-out`;
    p.scale = 1;
    p.tx = 0;
    p.ty = 0;
    render(p);
    setTimeout(() => finish(p), SPRING_MS + 20);
  }

  function finish(p: Pinch) {
    if (p.done) return;
    p.done = true;
    cancelAnimationFrame(p.frame);
    p.layer.remove();
    p.original.style.visibility = p.originalVisibility;
    if (pinch === p) pinch = null;
  }
}

/** Where the zooming touches are now: their midpoint and spread, or the one that's left. */
function points(touches: TouchList, ids: number[]): Point | null {
  const found: Touch[] = [];
  for (let i = 0; i < touches.length; i++) if (ids.includes(touches[i].identifier)) found.push(touches[i]);
  if (found.length === 0) return null;
  if (found.length === 1) return { x: found[0].clientX, y: found[0].clientY, d: 0, n: 1 };
  const [a, b] = found;
  return {
    x: (a.clientX + b.clientX) / 2,
    y: (a.clientY + b.clientY) / 2,
    d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
    n: 2,
  };
}

/** Scale by how far the fingers spread since the last move, keeping the spot between them under them. */
export function step(
  state: { scale: number; tx: number; ty: number; left: number; top: number },
  prev: Point,
  next: Point,
): { scale: number; tx: number; ty: number } {
  const spread = prev.n === 2 && next.n === 2 && prev.d > 0 ? next.d / prev.d : 1;
  const scale = Math.min(MAX_SCALE, Math.max(1, state.scale * spread));
  const ratio = scale / state.scale;
  return {
    scale,
    tx: next.x - state.left - ratio * (prev.x - state.left - state.tx),
    ty: next.y - state.top - ratio * (prev.y - state.top - state.ty),
  };
}

function move(p: Pinch, next: Point | null) {
  const prev = p.prev;
  p.prev = next;
  if (!prev || !next || prev.n !== next.n) return; // A finger came or went: measure from here.
  Object.assign(p, step(p, prev, next));
  render(p);
}

function render(p: Pinch) {
  p.copy.style.transform = `translate3d(${p.tx}px, ${p.ty}px, 0) scale(${p.scale})`;
  p.layer.style.backgroundColor = `rgba(0, 0, 0, ${Math.min(MAX_DIM, (p.scale - 1) * DIM_PER_SCALE).toFixed(3)})`;
}

function isMedia(el: Element): el is HTMLImageElement | HTMLVideoElement {
  return el instanceof HTMLImageElement || el instanceof HTMLVideoElement;
}

function guard(fn: () => void) {
  try {
    fn();
  } catch {
    // Fail open: the touch does what the page does with it.
  }
}
