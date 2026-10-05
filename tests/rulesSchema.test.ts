import { ENGINE_VERSION } from '@/core/types';
import { platforms } from '@/platforms/registry';
import { isSafeSelector, validateRules } from '@/rules/schema';

import bundled from '../rules/rules.json';

const base = { schemaVersion: 1, revision: 5, updated: '2026-10-06', minEngineVersion: 1 };

describe('bundled rules.json', () => {
  const result = validateRules(bundled);

  it('is valid with no warnings', () => {
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings).toEqual([]);
  });

  it('only references toggles that exist on the platform', () => {
    if (!result.ok) return;
    for (const platform of platforms) {
      const known = new Set(platform.toggles.map((t) => t.id));
      const r = result.rules.platforms[platform.id];
      expect(r).toBeDefined();
      const used = [...r.routes, ...r.hide, ...r.textHide, ...(r.feedLimit ? [r.feedLimit] : [])]
        .map((rule) => rule.toggle)
        .filter((t): t is string => t !== undefined);
      for (const toggle of used) expect(known).toContain(toggle);
    }
  });

  it('has unique rule ids per platform', () => {
    if (!result.ok) return;
    for (const r of Object.values(result.rules.platforms)) {
      const ids = [...r.routes, ...r.hide, ...r.textHide].map((x) => x.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('strips documentation notes from what reaches the engine', () => {
    if (!result.ok) return;
    expect(JSON.stringify(result.rules)).not.toContain('"note"');
  });
});

describe('validateRules', () => {
  it('rejects files with the wrong shape or schema version', () => {
    expect(validateRules(null).ok).toBe(false);
    expect(validateRules({ ...base, schemaVersion: 2, platforms: {} }).ok).toBe(false);
    expect(validateRules({ ...base, platforms: 'nope' }).ok).toBe(false);
  });

  it('rejects rules that need a newer engine', () => {
    const result = validateRules({ ...base, minEngineVersion: ENGINE_VERSION + 1, platforms: {} });
    expect(result.ok).toBe(false);
  });

  it('drops unsafe selectors but keeps the rest of the rule', () => {
    const result = validateRules({
      ...base,
      platforms: {
        p: {
          hide: [
            {
              id: 'mixed',
              selectors: [
                'a[href^="/reels/"]',
                'a{background:url(https://evil.example/x)}',
                'input[value^="a"]{x:y}',
                'a\\7b',
                '/* sneaky */ a',
              ],
            },
          ],
        },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rules.platforms.p.hide[0].selectors).toEqual(['a[href^="/reels/"]']);
    expect(result.warnings.join(' ')).toContain('dropped 4 invalid selector');
  });

  it('drops a rule with no valid selectors instead of rejecting the file', () => {
    const result = validateRules({
      ...base,
      platforms: { p: { hide: [{ id: 'bad', selectors: ['a{}'] }, { id: 'good', selectors: ['b'] }] } },
    });
    expect(result.ok && result.rules.platforms.p.hide.map((h) => h.id)).toEqual(['good']);
  });

  it('never widens a path-scoped rule to everywhere', () => {
    const result = validateRules({
      ...base,
      platforms: { p: { hide: [{ id: 'scoped', selectors: ['b'], paths: ['not-a-path'] }] } },
    });
    expect(result.ok && result.rules.platforms.p.hide).toEqual([]);
  });

  it('keeps redirects on the same site', () => {
    const route = (to: string) =>
      validateRules({ ...base, platforms: { p: { routes: [{ id: 'r', action: 'redirect', paths: ['/'], to }] } } });
    const good = route('/?variant=following');
    expect(good.ok && good.rules.platforms.p.routes).toHaveLength(1);
    for (const bad of ['https://evil.example/', '//evil.example/', 'javascript:alert(1)', '/a b']) {
      const result = route(bad);
      expect(result.ok && result.rules.platforms.p.routes).toEqual([]);
    }
  });

  it('requires a target for redirects', () => {
    const result = validateRules({ ...base, platforms: { p: { routes: [{ id: 'r', action: 'redirect', paths: ['/'] }] } } });
    expect(result.ok && result.rules.platforms.p.routes).toEqual([]);
  });

  it('cleans control characters out of labels', () => {
    const result = validateRules({
      ...base,
      platforms: { p: { hide: [{ id: 'h', selectors: ['b'], mode: 'collapse', label: 'Hidden\nby us' }] } },
    });
    expect(result.ok && result.rules.platforms.p.hide[0].label).toBe('Hidden by us');
  });
});

describe('isSafeSelector', () => {
  it.each(['article:has(video)', 'a[href*="/reel/"]', 'ul:has(> li [aria-label*="Story"])', 'div > span + b'])(
    'accepts %s',
    (selector) => expect(isSafeSelector(selector)).toBe(true),
  );

  it.each(['', '   ', 'a{}', 'a;b', '@import "x"', 'a\\7b', 'a<b', 'x'.repeat(301), 'a /* c */'])(
    'rejects %p',
    (selector) => expect(isSafeSelector(selector)).toBe(false),
  );
});
