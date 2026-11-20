import { buildPayload, PHONE_LAYOUT_SCRIPT, parsePageMessage, ruleIds, TABLET_RELOAD_SCRIPT } from '@/webview/engineBridge';
import { instagram } from '@/platforms/instagram';
import { platformRules, validateRules } from '@/rules/schema';

import bundled from '../rules/rules.json';

const result = validateRules(bundled);
if (!result.ok) throw new Error(result.error);
const rules = platformRules(result.rules, 'instagram');
const known = ruleIds(rules);

describe('parsePageMessage', () => {
  it('accepts our own messages', () => {
    expect(parsePageMessage(JSON.stringify({ type: 'blocked', ruleId: 'reels-pages', path: '/reels' }), known)).toEqual({
      type: 'blocked',
      ruleId: 'reels-pages',
      path: '/reels',
    });
    expect(
      parsePageMessage(JSON.stringify({ type: 'stats', requestId: 'r1', counts: { 'reels-tab': 2, bogus: 5, 'feed-videos': 'x' } }), known),
    ).toEqual({ type: 'stats', requestId: 'r1', counts: { 'reels-tab': 2 } });
  });

  it('ignores anything else the page might post', () => {
    for (const data of [
      'not json',
      'null',
      '"string"',
      JSON.stringify({ type: 'setToggle', toggle: 'blockReels', value: false }),
      JSON.stringify({ type: 'blocked', ruleId: 'made-up', path: '/' }),
      JSON.stringify({ type: 'blocked', ruleId: 'reels-pages', path: 'x'.repeat(301) }),
      JSON.stringify({ type: 'stats', requestId: 1, counts: {} }),
    ]) {
      expect(parsePageMessage(data, known)).toBeNull();
    }
  });
});

describe('buildPayload', () => {
  it('carries only data the engine needs', () => {
    const payload = buildPayload(instagram, rules, { blockReels: true }, 30, instagram.baseUrl);
    expect(Object.keys(payload).sort()).toEqual(['feedLimit', 'homeUrl', 'neverBlock', 'pinchZoom', 'reelViewer', 'rules', 'siteHosts', 'toggles']);
    expect(() => JSON.parse(JSON.stringify(payload))).not.toThrow();
  });

  it('turns the full-screen reel player on with its setting', () => {
    expect(buildPayload(instagram, rules, { fullscreenReels: true }, 30, instagram.baseUrl).reelViewer).toBe(true);
    expect(buildPayload(instagram, rules, { fullscreenReels: false }, 30, instagram.baseUrl).reelViewer).toBe(false);
  });
});

describe('reel messages', () => {
  const reel = {
    video: 'https://scontent-lga3-1.cdninstagram.com/o1/v/t16/f2/m86/abc.mp4?efg=1&oh=00_x',
    poster: 'https://instagram.fxyz1-1.fna.fbcdn.net/v/t51/abc.jpg?stp=1',
    width: 720,
    height: 1280,
    username: 'jane.doe',
    avatar: '',
    caption: 'Sunset',
    duration: 14.5,
  };
  const message = (r: unknown, state = 'ready') => JSON.stringify({ type: 'reel', requestId: 'r3', state, reel: r });

  it("accepts a reel from Instagram's CDN", () => {
    expect(parsePageMessage(message(reel), known)).toEqual({ type: 'reel', requestId: 'r3', state: 'ready', reel });
    expect(parsePageMessage(message(undefined, 'loading'), known)).toEqual({ type: 'reel', requestId: 'r3', state: 'loading' });
    expect(parsePageMessage(message(undefined, 'failed'), known)).toEqual({ type: 'reel', requestId: 'r3', state: 'failed' });
  });

  it('cleans up what it can and refuses videos from anywhere else', () => {
    expect(parsePageMessage(message({ ...reel, width: -5, username: 'bad name', caption: 'x'.repeat(3000) }), known)).toEqual({
      type: 'reel',
      requestId: 'r3',
      state: 'ready',
      reel: { ...reel, width: 0, username: '', caption: 'x'.repeat(2200) },
    });
    for (const bad of [
      { ...reel, video: 'http://scontent.cdninstagram.com/a.mp4' },
      { ...reel, video: 'https://evil.example/a.mp4' },
      { ...reel, video: 'https://cdninstagram.com.evil.example/a.mp4' },
      { ...reel, video: 'https://user@scontent.cdninstagram.com/a.mp4' },
      { ...reel, poster: 'javascript:alert(1)' },
      { ...reel, video: '' },
    ]) {
      expect(parsePageMessage(message(bad), known)).toBeNull();
    }
    expect(parsePageMessage(JSON.stringify({ type: 'reel', requestId: 'x', state: 'loading' }), known)).toBeNull();
    expect(parsePageMessage(message(reel, 'playing'), known)).toBeNull();
  });
});

describe('PHONE_LAYOUT_SCRIPT', () => {
  /** Runs the script in a fake page whose user agent reads `agents` in turn; returns what it did. */
  function run(agents: string[], page: Record<string, unknown> = {}) {
    const calls: string[] = [];
    const timers: (() => void)[] = [];
    let read = 0;
    const navigator = { get userAgent() { return agents[Math.min(read++, agents.length - 1)]; } };
    const history = { replaceState: (state: unknown, _title: string, url: string) => calls.push(`replaceState ${state} ${url}`) };
    const window = Object.assign(page, { dispatchEvent: (e: { type: string; state: unknown }) => calls.push(`${e.type} ${e.state}`) });
    class PopStateEvent { state: unknown; constructor(public type: string, init: { state: unknown }) { this.state = init.state; } }
    new Function('window', 'navigator', 'history', 'location', 'PopStateEvent', 'setTimeout', PHONE_LAYOUT_SCRIPT)(
      window, navigator, history, { href: 'https://www.instagram.com/direct/inbox/' }, PopStateEvent, (f: () => void) => timers.push(f),
    );
    while (timers.length) timers.shift()!();
    return calls;
  }
  const tablet = 'Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
  const phone = 'Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';

  it('waits for the phone user agent, then has the router look the page up again', () => {
    expect(run([tablet, tablet, phone])).toEqual(['replaceState null https://www.instagram.com/direct/inbox/', 'popstate null']);
  });

  it('gives up if the phone agent never arrives, and runs once per page', () => {
    expect(run([tablet])).toEqual([]);
    expect(run([phone], { __liteSocialPhoneLayout: true })).toEqual([]);
  });
});

describe('TABLET_RELOAD_SCRIPT', () => {
  /** Runs the script in a fake Instagram page; returns the addresses it loaded. */
  function run(isMobile: boolean | undefined, stored: Record<string, string>, now: number) {
    const loads: string[] = [];
    const require = isMobile === undefined ? undefined : () => ({ is_mobile: isMobile });
    const sessionStorage = { getItem: (k: string) => stored[k] ?? null, setItem: (k: string, v: string) => (stored[k] = v) };
    const location = { href: 'https://www.instagram.com/direct/t/1/', replace: (url: string) => loads.push(url) };
    new Function('window', 'sessionStorage', 'location', 'Date', TABLET_RELOAD_SCRIPT)(
      { require }, sessionStorage, location, { now: () => now },
    );
    return loads;
  }

  it('loads a page that came back as a phone again, at most once every 30 s', () => {
    const stored: Record<string, string> = {};
    expect(run(true, stored, 100_000)).toEqual(['https://www.instagram.com/direct/t/1/']);
    expect(run(true, stored, 120_000)).toEqual([]);
    expect(run(true, stored, 131_000)).toEqual(['https://www.instagram.com/direct/t/1/']);
  });

  it('leaves a tablet page, or a page without Instagram\'s modules, alone', () => {
    expect(run(false, {}, 100_000)).toEqual([]);
    expect(run(undefined, {}, 100_000)).toEqual([]);
  });
});
