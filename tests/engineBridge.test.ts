import { buildPayload, parsePageMessage, ruleIds } from '@/webview/engineBridge';
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
    expect(Object.keys(payload).sort()).toEqual(['feedLimit', 'homeUrl', 'neverBlock', 'reelViewer', 'rules', 'siteHosts', 'toggles']);
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
