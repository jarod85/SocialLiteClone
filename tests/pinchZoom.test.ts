/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://www.instagram.com/"}
 */
/**
 * Pinch to zoom on posts: the gesture math, and which pinches the page keeps.
 * jsdom has no layout, so pictures get their size by hand and touches are
 * plain events carrying a touch list. How it looks needs the device checklist.
 */
import { MARK } from '@/core/cssBuilder';
import type { EnginePayload } from '@/core/types';
import '@/injected/engine';
import { step } from '@/injected/pinchZoom';

const engine = window.__liteSocial!;

const payload = (pinchZoom: boolean): EnginePayload => ({
  siteHosts: ['www.instagram.com'],
  homeUrl: 'https://www.instagram.com/',
  neverBlock: [],
  feedLimit: 30,
  pinchZoom,
  toggles: {},
  rules: { routes: [], hide: [], textHide: [] },
});

interface FakeTouch {
  identifier: number;
  clientX: number;
  clientY: number;
}

function touch(type: string, target: Element, touches: FakeTouch[]): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', { value: touches });
  target.dispatchEvent(event);
  return event;
}

/** A post photo 400x400 at (0, 100), under a layer Instagram puts on top for taps. */
function post(size = 400): { photo: HTMLImageElement; layer: HTMLElement } {
  document.body.innerHTML = '<main><article><div><img src="https://scontent.cdninstagram.com/a.jpg"><div class="tap"></div></div></article></main>';
  const photo = document.querySelector('img')!;
  Object.defineProperty(photo, 'naturalWidth', { value: 1080 });
  photo.getBoundingClientRect = () => ({ left: 0, top: 100, right: size, bottom: 100 + size, width: size, height: size, x: 0, y: 100, toJSON: () => ({}) });
  return { photo, layer: document.querySelector('.tap')! };
}

const zoomLayer = () => document.querySelector<HTMLElement>('div[aria-hidden="true"]');

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('pinch gesture math', () => {
  const at = { scale: 1, tx: 0, ty: 0, left: 0, top: 100 };

  it('grows with the fingers and keeps the spot between them under them', () => {
    const next = step(at, { x: 200, y: 300, d: 100, n: 2 }, { x: 200, y: 300, d: 200, n: 2 });
    expect(next.scale).toBe(2);
    // The photo's point (200, 200) was under the fingers; at 2x it lands at 0 + tx + 2 * 200.
    expect(next.tx + 2 * 200).toBe(200);
    expect(100 + next.ty + 2 * 200).toBe(300);
  });

  it('never shrinks below the post or grows past 5x', () => {
    expect(step(at, { x: 0, y: 0, d: 100, n: 2 }, { x: 0, y: 0, d: 50, n: 2 }).scale).toBe(1);
    expect(step({ ...at, scale: 4 }, { x: 0, y: 0, d: 100, n: 2 }, { x: 0, y: 0, d: 300, n: 2 }).scale).toBe(5);
  });

  it('moves with one finger without changing the size', () => {
    const next = step({ ...at, scale: 2, tx: -10, ty: 5 }, { x: 50, y: 50, d: 0, n: 1 }, { x: 80, y: 40, d: 0, n: 1 });
    expect(next).toEqual({ scale: 2, tx: 20, ty: -5 });
  });
});

describe('pinching a post', () => {
  it('lifts a copy of the photo, follows the fingers and springs back', () => {
    engine.apply(payload(true));
    const { photo, layer } = post();
    touch('touchstart', layer, [{ identifier: 1, clientX: 150, clientY: 300 }]);
    const start = touch('touchstart', layer, [
      { identifier: 1, clientX: 150, clientY: 300 },
      { identifier: 2, clientX: 250, clientY: 300 },
    ]);
    expect(start.defaultPrevented).toBe(true);
    const copy = zoomLayer()?.querySelector('img');
    expect(copy?.src).toBe('https://scontent.cdninstagram.com/a.jpg');
    expect(photo.style.visibility).toBe('hidden');

    const pageSaw = jest.fn();
    document.addEventListener('touchmove', pageSaw);
    const moveEvent = touch('touchmove', layer, [
      { identifier: 1, clientX: 100, clientY: 300 },
      { identifier: 2, clientX: 300, clientY: 300 },
    ]);
    expect(moveEvent.defaultPrevented).toBe(true);
    expect(pageSaw).not.toHaveBeenCalled();
    expect(copy!.style.transform).toBe('translate3d(-200px, -200px, 0) scale(2)');

    touch('touchend', layer, [{ identifier: 1, clientX: 100, clientY: 300 }]);
    expect(zoomLayer()).not.toBeNull(); // One finger still down: keeps holding it.
    touch('touchend', layer, []);
    expect(copy!.style.transform).toBe('translate3d(0px, 0px, 0) scale(1)');
    jest.advanceTimersByTime(300);
    expect(zoomLayer()).toBeNull();
    expect(photo.style.visibility).toBe('');
    document.removeEventListener('touchmove', pageSaw);
  });

  it("swallows the tap Instagram would see right after (a double tap likes the post)", () => {
    engine.apply(payload(true));
    const { layer } = post();
    touch('touchstart', layer, [
      { identifier: 1, clientX: 150, clientY: 300 },
      { identifier: 2, clientX: 250, clientY: 300 },
    ]);
    touch('touchend', layer, []);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    layer.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    jest.advanceTimersByTime(1000);
    const later = new MouseEvent('click', { bubbles: true, cancelable: true });
    layer.dispatchEvent(later);
    expect(later.defaultPrevented).toBe(false);
  });

  it('leaves avatars, collapsed posts and a switched-off setting alone', () => {
    const twoFingers = (target: Element) =>
      touch('touchstart', target, [
        { identifier: 1, clientX: 20, clientY: 120 },
        { identifier: 2, clientX: 60, clientY: 120 },
      ]).defaultPrevented;

    engine.apply(payload(true));
    expect(twoFingers(post(72).layer)).toBe(false);

    const collapsed = post();
    collapsed.photo.closest('article')!.setAttribute(MARK.collapse, 'Hidden');
    expect(twoFingers(collapsed.layer)).toBe(false);

    engine.apply(payload(false));
    expect(twoFingers(post().layer)).toBe(false);
    expect(zoomLayer()).toBeNull();
  });
});
