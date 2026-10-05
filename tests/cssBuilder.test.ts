import { buildCss, cssString } from '@/core/cssBuilder';
import type { PlatformRules } from '@/core/types';

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
