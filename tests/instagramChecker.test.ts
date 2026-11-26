/**
 * Instagram notifications on iOS: the TypeScript port of the Android checker
 * (modules/instagram-alerts InstagramChecker.kt, DirectInbox.kt, InstagramApi.kt).
 * The Swift request bridge and the notifications are mocked; fixtures are the Kotlin tests' own.
 */
import { find, PATTERNS } from '@/features/instagramAlerts/checker/api';
import { check } from '@/features/instagramAlerts/checker/checker';
import { millis, parseGraphql, parseRest } from '@/features/instagramAlerts/checker/inbox';
import { resetWatermarks, useAlertsState } from '@/features/instagramAlerts/checker/state';

import { fixture } from './fixtures';

const mockRequest = jest.fn();
const mockSession = jest.fn();
jest.mock('@/features/instagramAlerts/checker/bridge', () => ({
  request: (...args: unknown[]) => mockRequest(...args),
  session: () => mockSession(),
}));
jest.mock('@/features/instagramAlerts/checker/notify', () => ({
  canPost: jest.fn(async () => true),
  postConversation: jest.fn(async () => undefined),
  postUnreadCount: jest.fn(async () => undefined),
  postActivity: jest.fn(async () => undefined),
  cancelMessage: jest.fn(async () => undefined),
  cancelUnreadCount: jest.fn(async () => undefined),
}));
const mockNotify = jest.requireMock('@/features/instagramAlerts/checker/notify') as Record<string, jest.Mock>;

const VIEWER = '17841400000000000';
const DM = '340282366841710300949128100000000001';
const graphqlText = fixture('instagram/inbox-graphql.json');
const PAGE = '<script>["DTSGInitialData",[],{"token":"NAc:abc"},1]...["LSD",[],{"token":"lsd1"},2]..."X-IG-App-ID":"1217981644879628"</script>';

describe('inbox', () => {
  it('parses GraphQL threads', () => {
    const [dm, group] = parseGraphql(JSON.parse(graphqlText), VIEWER);
    expect(dm.id).toBe(DM);
    expect(dm.incoming.map((m) => m.text)).toEqual(['see you at 7?', 'hey']);
    expect(dm.users[dm.incoming[0].senderId]).toEqual({ name: 'Jane Doe (@jane.doe)', picture: 'https://cdn/x.jpg' });
    expect(dm.incoming[0].atMs).toBe(1791000002000);
    expect(dm.unread).toBeNull();
    expect(group).toMatchObject({ isGroup: true, muted: true, title: 'Climbing' });
    expect(group.incoming.map((m) => m.text)).toEqual(['Shared a reel']);
    expect(group.users[group.incoming[0].senderId].name).toBe('@sam');
  });

  it('has nothing incoming when you wrote last', () => {
    // The newest message ("see you at 7?") is now the viewer's own.
    const json = JSON.parse(graphqlText.replace('"sender_fbid": "901"', '"sender_fbid": "900"'));
    expect(parseGraphql(json, null)[0].incoming).toEqual([]);
  });

  it('takes a sender who is no participant for you when the viewer is missing', () => {
    const json = JSON.parse(graphqlText);
    delete json.data.get_slide_mailbox_for_iris_subscription.threads_by_folder.edges[0].node.as_ig_direct_thread.viewer;
    expect(parseGraphql(json, VIEWER)[0].incoming.map((m) => m.text)).toEqual(['see you at 7?', 'hey']);
  });

  it('parses the older REST inbox', () => {
    const [thread] = parseRest(JSON.parse(fixture('instagram/inbox-rest.json')), null);
    expect(thread.unread).toBe(true);
    expect(thread.incoming.map((m) => m.text)).toEqual(['lunch?', 'Sent a video']);
    expect(thread.incoming[0].atMs).toBe(1791000005000);
    expect(thread.users['200'].name).toBe('@kim');
  });

  it('reads timestamps in any unit', () => {
    expect(millis('1791000000000000')).toBe(1791000000000);
    expect(millis(1791000000000)).toBe(1791000000000);
    expect(millis(1791000000)).toBe(1791000000000);
    expect(millis(null)).toBe(0);
  });

  it("finds the page's request tokens", () => {
    expect(find(PAGE, PATTERNS.dtsg)).toBe('NAc:abc');
    expect(find(PAGE, PATTERNS.lsd)).toBe('lsd1');
    expect(find(PAGE, PATTERNS.appId)).toBe('1217981644879628');
  });
});

describe('check', () => {
  const ok = (body: unknown) => ({ status: 200, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const instagram = (path: string) => {
    if (path.startsWith('/api/v1/direct_v2/get_badge_count/')) return ok({ badge_count: 1 });
    if (path === '/') return ok(PAGE);
    if (path === '/api/graphql') return ok(graphqlText);
    if (path.startsWith('/api/v1/news/inbox/')) return ok({ new_stories: [], old_stories: [] });
    return { status: 404, body: '' };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockNotify.canPost.mockResolvedValue(true);
    useAlertsState.setState(useAlertsState.getInitialState());
    resetWatermarks(1791000000500);
    mockSession.mockResolvedValue({ loggedIn: true, viewerId: VIEWER });
    mockRequest.mockImplementation(async (_method: string, path: string) => instagram(path));
  });

  it('says so and posts nothing when there is no Instagram login', async () => {
    mockSession.mockResolvedValue({ loggedIn: false, viewerId: null });
    const result = await check();
    expect(result).toMatchObject({ loggedIn: false, messages: 'Not logged in' });
    expect(mockNotify.postConversation).not.toHaveBeenCalled();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('posts one alert per conversation with new messages, and none again for the same messages', async () => {
    const result = await check();
    expect(result).toMatchObject({ loggedIn: true, messages: 'OK', newMessages: 1, unreadConversations: 1, activity: 'OK' });
    expect(mockNotify.postConversation).toHaveBeenCalledTimes(1);
    expect(mockNotify.postConversation).toHaveBeenCalledWith(DM, 'Jane Doe (@jane.doe)', false, [
      { sender: 'Jane Doe (@jane.doe)', text: 'hey', atMs: 1791000001000 },
      { sender: 'Jane Doe (@jane.doe)', text: 'see you at 7?', atMs: 1791000002000 },
    ], 'https://cdn/x.jpg');
    const graphql = mockRequest.mock.calls.find(([, path]) => path === '/api/graphql');
    expect(graphql?.[2]).toMatchObject({ 'X-FB-Friendly-Name': 'PolarisDirectInboxQuery' });
    expect(graphql?.[3]).toContain('doc_id=27262915580045003');

    await check();
    expect(mockNotify.postConversation).toHaveBeenCalledTimes(1);
  });

  it('removes the alert of a conversation read since', async () => {
    await check();
    mockRequest.mockImplementation(async (_method: string, path: string) =>
      path.startsWith('/api/v1/direct_v2/get_badge_count/') ? ok({ badge_count: 0 }) : instagram(path),
    );
    await check();
    expect(mockNotify.cancelMessage).toHaveBeenCalledWith(DM);
  });

  it('falls back to the unread count when no inbox can be read', async () => {
    useAlertsState.setState({ badge: 0 });
    mockRequest.mockImplementation(async (_method: string, path: string) =>
      path === '/api/graphql' || path.startsWith('/api/v1/direct_v2/inbox/') ? { status: 500, body: '' } : instagram(path),
    );
    const result = await check();
    expect(result.messages).toMatch(/^Only the unread count is available\./);
    expect(mockNotify.postUnreadCount).toHaveBeenCalledWith(1);
  });
});
