import { parseCheckResult } from '@/features/instagramAlerts/instagramAlerts';
import { instagram } from '@/platforms/instagram';
import { startPath } from '@/platforms/registry';
import { compilePathPattern, pathMatches } from '@/core/routeMatcher';

describe('startPath (links from Instagram alerts)', () => {
  it('opens a conversation by numeric id', () => {
    expect(startPath(instagram, 'thread', '340282366841710300949128132345678901')).toBe(
      '/direct/t/340282366841710300949128132345678901/',
    );
  });

  it('falls back to the inbox for a missing or non-numeric id', () => {
    expect(startPath(instagram, 'thread', undefined)).toBe('/direct/inbox/');
    expect(startPath(instagram, 'thread', '../../reels')).toBe('/direct/inbox/');
    expect(startPath(instagram, 'thread', ['1', '2'])).toBe('/direct/inbox/');
  });

  it('opens the inbox and the activity page', () => {
    expect(startPath(instagram, 'messages')).toBe('/direct/inbox/');
    expect(startPath(instagram, 'activity')).toBe('/accounts/activity/');
  });

  it('ignores anything else', () => {
    expect(startPath(instagram, '/reels/')).toBeUndefined();
    expect(startPath(instagram, undefined)).toBeUndefined();
  });

  it('only targets pages no rule can block', () => {
    const neverBlock = instagram.neverBlock.map(compilePathPattern);
    for (const path of ['/direct/inbox/', '/direct/t/123/', '/accounts/activity/']) {
      expect(pathMatches(path, neverBlock)).toBe(true);
    }
  });
});

describe('parseCheckResult', () => {
  it('reads the native summary', () => {
    const json = JSON.stringify({
      checkedAt: 1_790_000_000_000,
      loggedIn: true,
      messages: 'OK',
      activity: 'HTTP 404',
      newMessages: 2,
      newActivity: 0,
      unreadConversations: 3,
    });
    expect(parseCheckResult(json)).toEqual({
      checkedAt: 1_790_000_000_000,
      loggedIn: true,
      messages: 'OK',
      activity: 'HTTP 404',
      newMessages: 2,
      newActivity: 0,
      unreadConversations: 3,
    });
  });

  it('returns null for nothing or garbage', () => {
    expect(parseCheckResult(null)).toBeNull();
    expect(parseCheckResult('not json')).toBeNull();
    expect(parseCheckResult('{}')).toBeNull();
  });
});
