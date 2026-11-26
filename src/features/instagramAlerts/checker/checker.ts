/**
 * One check for new Instagram messages and activity (iOS). TypeScript port of
 * modules/instagram-alerts InstagramChecker.kt, run by the background task and
 * by "Check now" in Settings.
 *
 * Messages come from the inbox instagram.com reads; each conversation with
 * messages newer than the last check gets an alert showing who wrote what, which
 * is removed again once the conversation has been read. Instagram's unread count
 * says when everything is read, and is the fallback if the inbox can't be read.
 * Activity (likes, comments, follows, mentions) comes from the activity feed.
 */
import type { CheckResult } from '../instagramAlerts';
import { Failure, InstagramApi, jazoest } from './api';
import { type Reader, READER_LABEL, readGraphql, readRest, type Thread } from './inbox';
import * as notify from './notify';
import { useAlertsState } from './state';

/** More new activity items than this in one check become a single summary alert. */
const MAX_ACTIVITY_ALERTS = 5;
/** Messages shown in one conversation's alert. */
const MAX_MESSAGE_LINES = 5;
/** Two background runs close together: the second one skips. */
const MIN_BACKGROUND_GAP_MS = 5 * 60_000;

const result = (loggedIn: boolean, messages: string, activity: string, newMessages = 0, newActivity = 0, unreadConversations = 0): CheckResult => ({
  checkedAt: Date.now(),
  loggedIn,
  messages,
  activity,
  newMessages,
  newActivity,
  unreadConversations,
});

function describe(e: unknown): string {
  if (e instanceof Failure) return e.message;
  if (e instanceof TypeError) return 'No connection';
  return e instanceof Error ? e.message.slice(0, 120) : String(e);
}

/** A check from the background task; skipped if one ran a moment ago. */
export async function runInBackground(): Promise<void> {
  const now = Date.now();
  if (now - useAlertsState.getState().lastCheckAt < MIN_BACKGROUND_GAP_MS) return;
  useAlertsState.setState({ lastBackgroundAt: now });
  await run();
}

/** A check whose result is kept for Settings. */
export async function run(): Promise<CheckResult> {
  useAlertsState.setState({ lastCheckAt: Date.now() });
  let r: CheckResult;
  try {
    r = await check();
  } catch (e) {
    r = result(true, describe(e), describe(e));
  }
  useAlertsState.setState({ lastResult: JSON.stringify(r) });
  return r;
}

class InboxUnreadable extends Error {
  constructor(
    readonly failures: unknown[],
    message: string,
  ) {
    super(message);
  }

  get notLoggedIn() {
    return this.failures.every((f) => f instanceof Failure && f.kind === 'notLoggedIn');
  }
}

export async function check(): Promise<CheckResult> {
  const api = await InstagramApi.create();
  if (!api) return result(false, 'Not logged in', 'Not logged in');
  const canNotify = await notify.canPost();
  useAlertsState.setState({ canNotify });

  // Instagram's unread count: cheap, and the fallback when the inbox can't be read.
  let badgeError: unknown = null;
  let badge: number | null = null;
  try {
    const json = await api.getJson('/api/v1/direct_v2/get_badge_count/?no_raven=1');
    if (typeof json.badge_count !== 'number') throw Failure.badResponse('no badge_count');
    badge = json.badge_count;
  } catch (e) {
    if (e instanceof Failure && e.kind === 'notLoggedIn') return result(false, describe(e), describe(e));
    badgeError = e;
  }

  let newMessages = 0;
  let unread = 0;
  let messages: string;
  try {
    const { threads, reader } = await readInbox(api);
    // The first read only notes where the inbox stands; an unread-count alert stays until then.
    const baseline = !useAlertsState.getState().inboxBaselined;
    [newMessages, unread] = await handleThreads(threads, badge, canNotify && !baseline);
    if (baseline) useAlertsState.setState({ inboxBaselined: true });
    else await notify.cancelUnreadCount();
    messages = reader === 'graphql' ? 'OK' : `OK (${READER_LABEL[reader]})`;
  } catch (e) {
    if (!(e instanceof InboxUnreadable)) throw e;
    if (badge === null && e.notLoggedIn) return result(false, describe(e.failures[0]), describe(e.failures[0]));
    if (badge !== null) {
      newMessages = await alertUnreadCount(badge, canNotify);
      unread = badge;
      messages = `Only the unread count is available. ${e.message}`;
    } else {
      messages = `${e.message}; unread count: ${describe(badgeError)}`;
    }
  }

  let newActivity = 0;
  let activity: string;
  try {
    newActivity = await checkActivity(api, canNotify);
    activity = 'OK';
  } catch (e) {
    activity = describe(e);
  }
  return result(true, messages, activity, newMessages, newActivity, unread);
}

/** Tries each way of reading the inbox, the one that worked last time first. */
async function readInbox(api: InstagramApi): Promise<{ threads: Thread[]; reader: Reader }> {
  const preferred = useAlertsState.getState().inboxReader as Reader | null;
  const order: Reader[] = preferred === 'rest' ? ['rest', 'graphql'] : ['graphql', 'rest'];
  const failures: unknown[] = [];
  const notes: string[] = [];
  for (const reader of order) {
    try {
      const threads = reader === 'graphql' ? await readGraphql(api) : await readRest(api);
      useAlertsState.setState({ inboxReader: reader });
      return { threads, reader };
    } catch (e) {
      failures.push(e);
      notes.push(`${READER_LABEL[reader]}: ${describe(e)}`);
    }
  }
  throw new InboxUnreadable(failures, notes.join('; '));
}

/** Alerts for conversations with messages newer than the last check; removes alerts of conversations read since. */
async function handleThreads(threads: Thread[], badge: number | null, canNotify: boolean): Promise<[number, number]> {
  const state = useAlertsState.getState();
  const watermark = state.dmWatermark;
  let newest = watermark;
  const notified = new Set(state.notifiedThreads);
  let alerts = 0;
  let unreadThreads = 0;
  for (const thread of threads) {
    if (thread.messages[0]) newest = Math.max(newest, thread.messages[0].atMs);
    const incoming = thread.incoming;
    // A zero unread count means everything is read, whatever a conversation looks like.
    const isUnread = badge !== 0 && incoming.length > 0 && thread.unread !== false;
    if (!isUnread) {
      if (notified.delete(thread.id)) await notify.cancelMessage(thread.id);
      continue;
    }
    const fresh = incoming.some((m) => m.atMs > watermark);
    if (thread.unread === true || fresh) unreadThreads++;
    if (!fresh || thread.muted || !canNotify) continue;
    // The new messages, plus the earlier unread ones while their alert is still showing.
    const shown = incoming
      .filter((m) => m.atMs > watermark || notified.has(thread.id))
      .slice(0, MAX_MESSAGE_LINES)
      .reverse();
    const latestSender = thread.users[incoming[0].senderId];
    const names = [...new Set(Object.values(thread.users).map((u) => u.name))].join(', ');
    const title = thread.isGroup ? (thread.title ?? (names || 'Group chat')) : (latestSender?.name ?? thread.title ?? 'Instagram');
    const lines = shown.map((m) => ({ sender: thread.users[m.senderId]?.name ?? (thread.isGroup ? 'Someone' : title), text: m.text, atMs: m.atMs }));
    await notify.postConversation(thread.id, title, thread.isGroup, lines, latestSender?.picture ?? null);
    notified.add(thread.id);
    alerts++;
  }
  useAlertsState.setState({ dmWatermark: newest, notifiedThreads: [...notified] });
  return [alerts, badge ?? unreadThreads];
}

/** When only Instagram's unread count is known: one alert with the count, when it goes up. */
async function alertUnreadCount(count: number, canNotify: boolean): Promise<number> {
  const previous = useAlertsState.getState().badge;
  useAlertsState.setState({ badge: count });
  if (count === 0) {
    await notify.cancelUnreadCount();
    return 0;
  }
  if (count > previous && canNotify) {
    await notify.postUnreadCount(count);
    return 1;
  }
  return 0;
}

/** The activity feed; instagram.com itself POSTs for it with its page token, so that's the second try. */
async function activityFeed(api: InstagramApi): Promise<any> {
  const path = '/api/v1/news/inbox/';
  const referer = 'https://www.instagram.com/notifications/';
  try {
    const json = await api.getJson(path, referer);
    if ('new_stories' in json || 'old_stories' in json) return json;
  } catch (e) {
    if (e instanceof Failure && e.kind === 'notLoggedIn') throw e;
  }
  const tokens = await api.tokens();
  if (!tokens.fbDtsg) throw Failure.badResponse('no activity');
  return api.postForm(path, { fb_dtsg: tokens.fbDtsg, jazoest: jazoest(tokens.fbDtsg) }, referer);
}

async function checkActivity(api: InstagramApi, canNotify: boolean): Promise<number> {
  const json = await activityFeed(api);
  if (!('new_stories' in json) && !('old_stories' in json)) throw Failure.badResponse('no activity');
  const watermark = useAlertsState.getState().activityWatermark;
  let newest = watermark;
  const fresh: { id: string; text: string; picture: string | null; atMs: number }[] = [];
  for (const key of ['new_stories', 'old_stories']) {
    for (const story of Array.isArray(json[key]) ? json[key] : []) {
      const args = story?.args;
      if (!args) continue;
      const atMs = Math.trunc(Number(args.timestamp ?? 0) * 1000);
      if (!(atMs > 0)) continue;
      newest = Math.max(newest, atMs);
      if (atMs <= watermark) continue;
      const text = String(args.text || args.rich_text || '').trim();
      if (!text) continue;
      const id = String(story.pk || args.tuuid || atMs);
      fresh.push({ id, text, picture: args.profile_image || null, atMs });
    }
  }
  useAlertsState.setState({ activityWatermark: newest });
  if (!canNotify || fresh.length === 0) return 0;
  const distinct = [...new Map(fresh.map((f) => [f.id, f])).values()].sort((a, b) => a.atMs - b.atMs);
  if (distinct.length > MAX_ACTIVITY_ALERTS) {
    const latest = distinct[distinct.length - 1];
    await notify.postActivity('summary', `${distinct.length} new notifications. Latest: ${latest.text}`, latest.picture, latest.atMs);
    return distinct.length;
  }
  for (const item of distinct) await notify.postActivity(item.id, item.text, item.picture, item.atMs);
  return distinct.length;
}
