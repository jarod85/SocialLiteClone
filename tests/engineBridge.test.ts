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
    expect(Object.keys(payload).sort()).toEqual(['feedLimit', 'homeUrl', 'neverBlock', 'rules', 'siteHosts', 'toggles']);
    expect(() => JSON.parse(JSON.stringify(payload))).not.toThrow();
  });
});
