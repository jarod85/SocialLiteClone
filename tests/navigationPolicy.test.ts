/**
 * Layer 1 against the real Instagram config and the bundled rules, so a bad
 * edit to rules.json or instagram.ts shows up here.
 */
import { decideNavigation, initialUrl, type NavigationContext } from '@/core/navigationPolicy';
import { compileRoutes } from '@/core/routeMatcher';
import { instagram } from '@/platforms/instagram';
import { startPath } from '@/platforms/registry';
import { effectiveToggles } from '@/platforms/toggles';
import { platformRules, validateRules } from '@/rules/schema';

import bundled from '../rules/rules.json';

const result = validateRules(bundled);
if (!result.ok) throw new Error(result.error);
const rules = platformRules(result.rules, 'instagram');

function context(overrides: Record<string, boolean> = {}): NavigationContext {
  return {
    allowedHosts: instagram.allowedHosts,
    siteHosts: instagram.siteHosts,
    baseUrl: instagram.baseUrl,
    routes: compileRoutes(rules.routes, instagram.neverBlock),
    toggles: effectiveToggles(instagram, overrides),
  };
}

const IG = 'https://www.instagram.com';
const decide = (url: string, overrides?: Record<string, boolean>, isTopFrame = true) =>
  decideNavigation(url, isTopFrame, context(overrides));

describe('Instagram navigation policy (defaults)', () => {
  it.each([`${IG}/reels/`, `${IG}/reels/DAbc123/`, `https://instagram.com/reels/`, `${IG}/REELS/`])(
    'blocks the Reels tab and viewer %s',
    (url) => {
      expect(decide(url)).toMatchObject({ type: 'block', ruleId: 'reels-pages' });
    },
  );

  it.each([
    `${IG}/p/CXyz/`,
    `${IG}/natgeo/`,
    `${IG}/reelsfan/`, // username that starts with "reels"
    `${IG}/direct/inbox/`,
    `${IG}/direct/t/1234567890/`,
    `${IG}/accounts/login/`,
    `${IG}/accounts/login/two_factor?next=%2F`,
    `${IG}/challenge/action/`,
    `${IG}/accounts/activity/`,
    `${IG}/explore/`, // Explore doubles as search; only its grid is hidden (CSS)
    `${IG}/explore/search/`,
    `${IG}/stories/natgeo/123/`, // Stories are allowed by default
    `${IG}/?variant=following`,
    `${IG}/reel/DAbc123/`, // "Watch shared reels" is on by default
    `${IG}/reel/DAbc123/?igsh=xyz`,
    `${IG}/natgeo/reels/`,
    `${IG}/natgeo/reel/DAbc123/`,
  ])('allows %s', (url) => {
    expect(decide(url)).toEqual({ type: 'allow' });
  });

  it('sends the home feed to the chronological Following feed', () => {
    expect(decide(`${IG}/`)).toEqual({
      type: 'redirect',
      ruleId: 'following-feed',
      url: `${IG}/?variant=following`,
    });
    expect(initialUrl(context())).toBe(`${IG}/?variant=following`);
  });

  it('blocks the full suggested-people list', () => {
    expect(decide(`${IG}/explore/people/`)).toMatchObject({ type: 'block', ruleId: 'suggested-people' });
  });
});

describe('Instagram navigation policy (toggles)', () => {
  it('allows Reels when "Block Reels" is off', () => {
    expect(decide(`${IG}/reels/`, { blockReels: false })).toEqual({ type: 'allow' });
    expect(decide(`${IG}/reel/DAbc123/`, { blockReels: false, allowSharedReels: false })).toEqual({ type: 'allow' });
  });

  it.each([`${IG}/reel/DAbc123/`, `${IG}/reel/DAbc123/?igsh=xyz`, `${IG}/natgeo/reels/`, `${IG}/natgeo/reel/DAbc123/`])(
    'blocks single reel %s when "Watch shared reels" is off',
    (url) => {
      expect(decide(url, { allowSharedReels: false })).toMatchObject({ type: 'block', ruleId: 'single-reels' });
    },
  );

  it('keeps the Reels tab and viewer blocked when "Watch shared reels" is on', () => {
    expect(decide(`${IG}/reels/DAbc123/`, { allowSharedReels: true })).toMatchObject({ type: 'block', ruleId: 'reels-pages' });
  });

  it('blocks stories only when "Hide Stories" is on', () => {
    expect(decide(`${IG}/stories/natgeo/123/`, { hideStories: true })).toMatchObject({ type: 'block' });
  });

  it('keeps the normal home feed when "Following feed" is off', () => {
    expect(decide(`${IG}/`, { followingFeed: false })).toEqual({ type: 'allow' });
    expect(initialUrl(context({ followingFeed: false }))).toBe(instagram.baseUrl);
  });
});

describe('links from message alerts', () => {
  it('open the inbox, which no rule can block', () => {
    const path = startPath(instagram, 'messages');
    expect(path).toBe('/direct/inbox/');
    for (const allowSharedReels of [true, false]) {
      expect(decide(`${IG}${path}`, { allowSharedReels, hideStories: true })).toEqual({ type: 'allow' });
    }
  });

  it.each(['/reels/', 'reels', '', 'MESSAGES'])('ignore anything but named targets (%s)', (open) => {
    expect(startPath(instagram, open)).toBeUndefined();
  });

  it('ignore repeated parameters', () => {
    expect(startPath(instagram, ['messages', 'messages'])).toBeUndefined();
    expect(startPath(instagram, undefined)).toBeUndefined();
  });
});

describe('schemes and hosts', () => {
  it.each(['instagram://user?username=x', 'intent://instagram.com/#Intent;scheme=https;end', 'market://details?id=x', 'fb://profile'])(
    'denies app deep link %s',
    (url) => {
      expect(decide(url)).toEqual({ type: 'deny' });
    },
  );

  it('hands mail and phone links to the system', () => {
    expect(decide('mailto:hi@example.com')).toEqual({ type: 'external', url: 'mailto:hi@example.com' });
    expect(decide('tel:+15551234')).toMatchObject({ type: 'external' });
  });

  it('allows inert in-page schemes', () => {
    expect(decide('about:blank')).toEqual({ type: 'allow' });
    expect(decide('blob:https://www.instagram.com/123')).toEqual({ type: 'allow' });
  });

  it('opens other sites in the system browser', () => {
    expect(decide('https://example.com/article')).toEqual({ type: 'external', url: 'https://example.com/article' });
  });

  it('keeps login and redirect hosts inside, without applying Instagram path rules to them', () => {
    expect(decide('https://www.facebook.com/login.php?next=x')).toEqual({ type: 'allow' });
    expect(decide('https://m.facebook.com/reel/123')).toEqual({ type: 'allow' });
    expect(decide('https://l.instagram.com/?u=https%3A%2F%2Fexample.com')).toEqual({ type: 'allow' });
    expect(decide('https://accountscenter.meta.com/')).toEqual({ type: 'allow' });
  });

  it('lets frames load, except app deep links', () => {
    expect(decide('https://www.google.com/recaptcha/api2/anchor', undefined, false)).toEqual({ type: 'allow' });
    expect(decide(`${IG}/reels/`, undefined, false)).toEqual({ type: 'allow' });
    expect(decide('instagram://x', undefined, false)).toEqual({ type: 'deny' });
    expect(decide('mailto:x@y.z', undefined, false)).toEqual({ type: 'deny' });
  });

  it('fails open on things that are not URLs', () => {
    expect(decide('%%%')).toEqual({ type: 'allow' });
  });
});
