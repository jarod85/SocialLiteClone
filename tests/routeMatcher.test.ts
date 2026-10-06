import { compilePathPattern, compileRoutes, decideRoute } from '@/core/routeMatcher';
import type { RouteRule } from '@/core/types';
import { hostMatches, normalizePath, parseQuery, parseUrl, stripQueryAndHash } from '@/core/urls';

describe('normalizePath', () => {
  it.each([
    ['/', ''],
    ['', ''],
    ['/reels/', '/reels'],
    ['/reels', '/reels'],
    ['//reel//ABC//', '/reel/ABC'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizePath(input)).toBe(expected);
  });
});

describe('compilePathPattern', () => {
  const matches = (pattern: string, path: string) => compilePathPattern(pattern).test(normalizePath(path));

  it('matches literal paths regardless of trailing slash and case', () => {
    expect(matches('/explore', '/explore/')).toBe(true);
    expect(matches('/explore', '/explore')).toBe(true);
    expect(matches('/explore', '/Explore/')).toBe(true);
    expect(matches('/explore', '/explore/tags/cats/')).toBe(false);
  });

  it('treats * as exactly one segment', () => {
    expect(matches('/reel/*', '/reel/ABC123/')).toBe(true);
    expect(matches('/reel/*', '/reel/')).toBe(false);
    expect(matches('/reel/*', '/reel/ABC/extra/')).toBe(false);
    expect(matches('/*/reels', '/someone/reels/')).toBe(true);
  });

  it('treats ** as any number of segments, including none', () => {
    expect(matches('/reels/**', '/reels/')).toBe(true);
    expect(matches('/reels/**', '/reels/audio/123/')).toBe(true);
    expect(matches('/**', '/')).toBe(true);
    expect(matches('/**', '/anything/at/all')).toBe(true);
  });

  it('supports * inside a segment', () => {
    expect(matches('/reel*', '/reels')).toBe(true);
    expect(matches('/reel*', '/reel')).toBe(true);
    expect(matches('/reel*', '/real')).toBe(false);
  });

  it('matches the root only with "/"', () => {
    expect(matches('/', '/')).toBe(true);
    expect(matches('/', '/p/abc/')).toBe(false);
  });

  it('escapes regex characters in literal segments', () => {
    expect(matches('/a.b', '/a.b')).toBe(true);
    expect(matches('/a.b', '/axb')).toBe(false);
  });
});

describe('decideRoute', () => {
  const rules: RouteRule[] = [
    { id: 'reels', toggle: 'blockReels', action: 'block', paths: ['/reels/**', '/reel/**', '/*/reels/**'] },
    { id: 'explore', toggle: 'hideExplore', action: 'block', paths: ['/explore'] },
    { id: 'always', action: 'block', paths: ['/forbidden'] },
    { id: 'following', toggle: 'followingFeed', action: 'redirect', paths: ['/'], to: '/?variant=following' },
  ];
  const compiled = compileRoutes(rules, ['/direct/**', '/accounts/**']);
  const on = { blockReels: true, hideExplore: true, followingFeed: true };

  it('blocks matching paths when the toggle is on', () => {
    expect(decideRoute('/reels/', '', compiled, on)).toEqual({ type: 'block', ruleId: 'reels' });
    expect(decideRoute('/reel/ABC/', '', compiled, on)).toEqual({ type: 'block', ruleId: 'reels' });
    expect(decideRoute('/natgeo/reels/', '', compiled, on)).toEqual({ type: 'block', ruleId: 'reels' });
  });

  it('allows them when the toggle is off or missing', () => {
    expect(decideRoute('/reels/', '', compiled, { ...on, blockReels: false })).toEqual({ type: 'allow' });
    expect(decideRoute('/reels/', '', compiled, {})).toEqual({ type: 'allow' });
  });

  it('skips a rule whose "unless" toggle is on', () => {
    const shared = compileRoutes(
      [{ id: 'single', toggle: 'blockReels', unless: 'allowSharedReels', action: 'block', paths: ['/reel/**'] }],
      [],
    );
    expect(decideRoute('/reel/ABC/', '', shared, { blockReels: true })).toEqual({ type: 'block', ruleId: 'single' });
    expect(decideRoute('/reel/ABC/', '', shared, { blockReels: true, allowSharedReels: true })).toEqual({ type: 'allow' });
  });

  it('applies rules without a toggle unconditionally', () => {
    expect(decideRoute('/forbidden', '', compiled, {})).toEqual({ type: 'block', ruleId: 'always' });
  });

  it('never blocks neverBlock paths, even if a rule matches', () => {
    const greedy = compileRoutes([{ id: 'all', action: 'block', paths: ['/**'] }], ['/direct/**', '/accounts/**']);
    expect(decideRoute('/direct/inbox/', '', greedy, {})).toEqual({ type: 'allow' });
    expect(decideRoute('/accounts/login/', '', greedy, {})).toEqual({ type: 'allow' });
    expect(decideRoute('/p/abc/', '', greedy, {})).toEqual({ type: 'block', ruleId: 'all' });
  });

  it('does not confuse usernames that start with "reels" with the Reels tab', () => {
    expect(decideRoute('/reelsfan/', '', compiled, on)).toEqual({ type: 'allow' });
    expect(decideRoute('/reelsfan/reels/', '', compiled, on)).toEqual({ type: 'block', ruleId: 'reels' });
  });

  it('redirects until the redirect target is reached', () => {
    expect(decideRoute('/', '', compiled, on)).toEqual({ type: 'redirect', ruleId: 'following', to: '/?variant=following' });
    expect(decideRoute('/', 'variant=following', compiled, on)).toEqual({ type: 'allow' });
    expect(decideRoute('/', 'variant=following&x=1', compiled, on)).toEqual({ type: 'allow' });
    expect(decideRoute('/', 'variant=home', compiled, on)).toMatchObject({ type: 'redirect' });
  });

  it('first matching rule wins', () => {
    const both = compileRoutes(
      [
        { id: 'first', action: 'block', paths: ['/x/**'] },
        { id: 'second', action: 'block', paths: ['/x/y'] },
      ],
      [],
    );
    expect(decideRoute('/x/y', '', both, {})).toEqual({ type: 'block', ruleId: 'first' });
  });
});

describe('url helpers', () => {
  it('parses URLs without relying on the URL class', () => {
    expect(parseUrl('https://user:pw@WWW.Instagram.com:443/reels/?a=1#top')).toEqual({
      scheme: 'https',
      host: 'www.instagram.com',
      path: '/reels/',
      query: 'a=1',
    });
    expect(parseUrl('https://www.instagram.com')).toMatchObject({ path: '/', query: '' });
    expect(parseUrl('intent://user/x#Intent;scheme=instagram;end')).toMatchObject({ scheme: 'intent', host: 'user' });
    expect(parseUrl('about:blank')).toMatchObject({ scheme: 'about', host: '' });
    expect(parseUrl('not a url')).toBeNull();
  });

  it('parses query strings', () => {
    const q = parseQuery('variant=following&a=%20b&c&d=x+y');
    expect(q.get('variant')).toBe('following');
    expect(q.get('a')).toBe(' b');
    expect(q.get('c')).toBe('');
    expect(q.get('d')).toBe('x y');
  });

  it('matches hosts exactly or by subdomain wildcard', () => {
    const hosts = ['instagram.com', '*.instagram.com'];
    expect(hostMatches('instagram.com', hosts)).toBe(true);
    expect(hostMatches('www.instagram.com', hosts)).toBe(true);
    expect(hostMatches('l.instagram.com', hosts)).toBe(true);
    expect(hostMatches('evilinstagram.com', hosts)).toBe(false);
    expect(hostMatches('instagram.com.evil.net', hosts)).toBe(false);
  });

  it('strips query and fragment before anything is stored', () => {
    expect(stripQueryAndHash('https://www.instagram.com/p/abc/?igsh=token#x')).toBe('https://www.instagram.com/p/abc/');
  });
});
