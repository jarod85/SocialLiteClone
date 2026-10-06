import { buildCss, cssString } from '@/core/cssBuilder';
import type { PlatformRules } from '@/core/types';
import { platformRules, validateRules } from '@/rules/schema';

import bundled from '../rules/rules.json';

const rules: PlatformRules = {
  routes: [],
  textHide: [],
  hide: [
    { id: 'always', selectors: ['a[href^="intent:"]'] },
    { id: 'reels', toggle: 'blockReels', selectors: ['a[href^="/reels/"]', 'a[href*="/reel/"]'] },
    {
      id: 'feed',
      toggle: 'blockReels',
      mode: 'collapse',
      label: 'Reel hidden',
      selectors: ['article:has(video)'],
    },
    { id: 'explore', toggle: 'hideExplore', paths: ['/explore'], selectors: ['a[href*="/p/"]'] },
  ],
};

describe('buildCss', () => {
  it('emits one CSS rule per selector so a bad selector only drops itself', () => {
    const css = buildCss(rules, { blockReels: true }, '/', 30);
    expect(css).toContain('a[href^="/reels/"]{display:none!important}');
    expect(css).toContain('a[href*="/reel/"]{display:none!important}');
    expect(css).not.toContain('a[href^="/reels/"],');
  });

  it('includes rules without a toggle and leaves out switched-off ones', () => {
    const css = buildCss(rules, { blockReels: false }, '/', 30);
    expect(css).toContain('a[href^="intent:"]{display:none!important}');
    expect(css).not.toContain('/reels/');
    expect(css).not.toContain('article:has(video)');
  });

  it('leaves out rules whose "unless" toggle is on', () => {
    const shared: PlatformRules = {
      ...rules,
      hide: [{ id: 'reel-links', toggle: 'blockReels', unless: 'allowSharedReels', selectors: ['a[href*="/reel/"]'] }],
    };
    expect(buildCss(shared, { blockReels: true }, '/', 30)).toContain('a[href*="/reel/"]');
    expect(buildCss(shared, { blockReels: true, allowSharedReels: true }, '/', 30)).not.toContain('a[href*="/reel/"]');
  });

  it('collapses to a labelled bar instead of hiding', () => {
    const css = buildCss(rules, { blockReels: true }, '/', 30);
    expect(css).toContain(':is(article:has(video))>*{display:none!important}');
    expect(css).toContain(':is(article:has(video))::before{content:"Reel hidden";');
  });

  it('applies path-scoped rules only on their paths', () => {
    expect(buildCss(rules, { hideExplore: true }, '/explore/', 30)).toContain('a[href*="/p/"]');
    expect(buildCss(rules, { hideExplore: true }, '/', 30)).not.toContain('a[href*="/p/"]');
    expect(buildCss(rules, { hideExplore: true }, '/p/abc/', 30)).not.toContain('a[href*="/p/"]');
  });

  it('puts the feed limit into the caught-up card', () => {
    expect(buildCss(rules, {}, '/', 20)).toContain("That's 20 posts.");
  });
});

describe('cssString', () => {
  it('escapes quotes, backslashes and line breaks', () => {
    expect(cssString('a"b\\c')).toBe('"a\\"b\\\\c"');
    expect(cssString('line1\nline2')).toBe('"line1\\A line2"');
    expect(cssString('x y')).toBe('"x y"');
  });
});

describe('bundled Instagram rules with "Watch shared reels"', () => {
  const result = validateRules(bundled);
  if (!result.ok) throw new Error(result.error);
  const ig = platformRules(result.rules, 'instagram');
  const css = (path: string, allowSharedReels: boolean) => buildCss(ig, { blockReels: true, allowSharedReels }, path, 30);

  it('keeps reels in the home feed collapsed', () => {
    expect(css('/', true)).toContain(':is(article:has(video))>*');
  });

  it('lets reels on posts, profiles and DMs show and play', () => {
    for (const path of ['/p/abc/', '/reel/abc/', '/natgeo/', '/direct/t/123/']) {
      expect(css(path, true)).not.toContain('article:has(video)');
      expect(css(path, true)).not.toContain('a[href*="/reel/"]');
    }
    expect(css('/natgeo/', true)).toContain('a[href^="/reels/"]'); // The Reels tab itself stays hidden.
  });

  it('hides all of it when switched off', () => {
    expect(css('/p/abc/', false)).toContain(':is(article:has(video))>*');
    expect(css('/direct/t/123/', false)).toContain('a[href*="/reel/"]{display:none!important}');
  });
});
