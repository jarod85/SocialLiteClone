/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://www.instagram.com/direct/t/1/"}
 */
/**
 * Full-screen reels: the in-page half (which taps it takes over, what it reads
 * from Instagram's media API) and the speed slide's math.
 */
import type { EnginePayload, PageMessage } from '@/core/types';
import '@/injected/engine';
import { mediaIdFromShortcode, reelDetails } from '@/injected/reelViewer';
import { MAX_SPEED, MIN_SPEED, speedForSlide } from '@/webview/reelSpeed';
import { fingersOf, MAX_ZOOM, NO_ZOOM, zoomStep } from '@/webview/reelZoom';

const posted: PageMessage[] = [];
window.ReactNativeWebView = { postMessage: (m: string) => posted.push(JSON.parse(m)) };
const engine = window.__liteSocial!;

const payload = (reelViewer: boolean, toggles: Record<string, boolean> = {}): EnginePayload => ({
  siteHosts: ['www.instagram.com'],
  homeUrl: 'https://www.instagram.com/',
  neverBlock: ['/direct/**'],
  feedLimit: 30,
  reelViewer,
  toggles: { blockReels: true, allowSharedReels: true, ...toggles },
  rules: {
    routes: [
      { id: 'reels-pages', toggle: 'blockReels', action: 'block', paths: ['/reels/**'] },
      { id: 'single-reels', toggle: 'blockReels', unless: 'allowSharedReels', action: 'block', paths: ['/reel/**', '/*/reel/**'] },
    ],
    hide: [],
    textHide: [],
  },
});

const media = {
  items: [
    {
      code: 'DPvGrb3jKmo',
      video_versions: [
        { width: 1440, height: 2560, url: 'https://scontent.cdninstagram.com/big.mp4' },
        { width: 720, height: 1280, url: 'https://scontent.cdninstagram.com/720.mp4' },
        { width: 480, height: 854, url: 'https://scontent.cdninstagram.com/480.mp4' },
      ],
      image_versions2: { candidates: [{ url: 'https://scontent.cdninstagram.com/cover.jpg' }] },
      user: { username: 'jane.doe', profile_pic_url: 'https://evil.example/pic.jpg' },
      caption: { text: 'Sunset' },
      video_duration: 14.5,
    },
  ],
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
let fetchMock: jest.Mock;

beforeEach(() => {
  posted.length = 0;
  document.body.innerHTML = '<main></main>';
  fetchMock = jest.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify(media) }));
  (window as unknown as { fetch: unknown }).fetch = fetchMock;
});

function tapLink(href: string): MouseEvent {
  const link = document.createElement('a');
  link.href = href;
  link.textContent = 'reel';
  document.querySelector('main')!.appendChild(link);
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  link.dispatchEvent(event);
  return event;
}

describe('taps on reels', () => {
  it('opens a reel sent in a DM in the app player instead of its page', async () => {
    engine.apply(payload(true));
    expect(tapLink('/reel/DPvGrb3jKmo/').defaultPrevented).toBe(true);
    await settle();
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/media/3742239188507732392/info/', expect.objectContaining({ credentials: 'include' }));
    const requestId = (posted[0] as { requestId: string }).requestId;
    expect(posted).toEqual([
      { type: 'reel', requestId, state: 'loading' },
      {
        type: 'reel',
        requestId,
        state: 'ready',
        reel: {
          video: 'https://scontent.cdninstagram.com/720.mp4', // The sharpest up to 1080 wide.
          poster: 'https://scontent.cdninstagram.com/cover.jpg',
          width: 720,
          height: 1280,
          username: 'jane.doe',
          avatar: '', // Not on Instagram's CDN: dropped.
          caption: 'Sunset',
          duration: 14.5,
        },
      },
    ]);
  });

  it('tells the app when the reel can not be read', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 500, text: async () => '' }));
    engine.apply(payload(true));
    const assign = jest.fn();
    // The tap then does what it did before: open the reel's page.
    const original = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, assign, hostname: original.hostname, pathname: original.pathname } });
    try {
      tapLink('/reel/DPvGrb3jKmo/');
      await settle();
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
    expect(posted.map((m) => (m as { state: string }).state)).toEqual(['loading', 'failed']);
    expect(assign).toHaveBeenCalledWith('https://www.instagram.com/reel/DPvGrb3jKmo/');
  });

  it('leaves links alone when the reel page is blocked, the player is off, or it is the Reels feed', () => {
    engine.apply(payload(true, { allowSharedReels: false }));
    expect(tapLink('/reel/DPvGrb3jKmo/').defaultPrevented).toBe(false);
    engine.apply(payload(false));
    expect(tapLink('/reel/DPvGrb3jKmo/').defaultPrevented).toBe(false);
    engine.apply(payload(true));
    expect(tapLink('/reels/DPvGrb3jKmo/').defaultPrevented).toBe(false);
    expect(tapLink('/jane.doe/').defaultPrevented).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(posted).toEqual([]);
  });
});

describe('reel details', () => {
  it('turns a post code into its media id, exactly', () => {
    expect(mediaIdFromShortcode('B')).toBe('1');
    expect(mediaIdFromShortcode('BA')).toBe('64');
    expect(mediaIdFromShortcode('CxYz_9-AbQk')).toBe('3195532631857017892');
    expect(mediaIdFromShortcode('DPvGrb3jKmoAbcdefghij')).toBe('3742239188507732392'); // Private posts: the first 11.
    expect(mediaIdFromShortcode('bad!code')).toBeNull();
  });

  it('plays the carousel slide that is on screen', () => {
    const slide = (name: string) => ({
      video_versions: [{ width: 720, height: 1280, url: `https://scontent.cdninstagram.com/${name}.mp4` }],
      image_versions2: { candidates: [{ url: `https://scontent.cdninstagram.com/v/${name}.jpg?stp=a` }] },
    });
    const item = { carousel_media: [{ image_versions2: {} }, slide('one'), slide('two')], user: { username: 'jane' } };
    expect(reelDetails(item, 'https://scontent.cdninstagram.com/v/two.jpg?stp=b')?.video).toBe('https://scontent.cdninstagram.com/two.mp4');
    expect(reelDetails(item)?.video).toBe('https://scontent.cdninstagram.com/one.mp4');
    expect(reelDetails({ image_versions2: {} })).toBeNull();
  });
});

describe('speed slide', () => {
  it('goes faster sliding up and slower sliding down, between 0.5× and 2×', () => {
    expect(speedForSlide(1, 0, 800)).toBe(1);
    expect(speedForSlide(1, -147, 800)).toBe(1.5);
    expect(speedForSlide(1.5, 147, 800)).toBe(1);
    expect(speedForSlide(1, 2000, 800)).toBe(MIN_SPEED);
    expect(speedForSlide(1, -2000, 800)).toBe(MAX_SPEED);
  });
});

describe('pinch zoom', () => {
  const two = (ax: number, ay: number, bx: number, by: number) =>
    fingersOf([
      { pageX: ax, pageY: ay },
      { pageX: bx, pageY: by },
    ]);

  it('zooms in about the spot between the fingers', () => {
    // Spread from 100 to 200 apart around (100, 200) on a 400x800 screen.
    const z = zoomStep(NO_ZOOM, two(50, 200, 150, 200), two(0, 200, 200, 200), 400, 800);
    expect(z.scale).toBe(2);
    // That spot (100 left of center, 200 above it) stays under the fingers.
    expect(z.x).toBe(100);
    expect(z.y).toBe(200);
  });

  it('stays between 1x and the most, and keeps the video covering the screen', () => {
    expect(zoomStep(NO_ZOOM, two(0, 0, 200, 0), two(50, 0, 150, 0), 400, 800)).toEqual(NO_ZOOM);
    expect(zoomStep(NO_ZOOM, two(199, 0, 201, 0), two(0, 0, 400, 0), 400, 800).scale).toBe(MAX_ZOOM);
    const panned = zoomStep({ scale: 2, x: 0, y: 0 }, fingersOf([{ pageX: 0, pageY: 0 }]), fingersOf([{ pageX: 1000, pageY: -1000 }]), 400, 800);
    expect(panned).toEqual({ scale: 2, x: 200, y: -400 });
  });

  it('carries on without a jump when a finger comes or goes', () => {
    const z = { scale: 2, x: 10, y: 10 };
    expect(zoomStep(z, two(0, 0, 100, 0), fingersOf([{ pageX: 300, pageY: 300 }]), 400, 800)).toBe(z);
  });
});
