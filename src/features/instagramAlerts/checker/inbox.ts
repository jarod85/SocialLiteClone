/**
 * The direct-message inbox, read one of two ways and turned into the same shape:
 * instagram.com's current GraphQL inbox query, or the older REST inbox the site
 * used before. TypeScript port of modules/instagram-alerts DirectInbox.kt.
 */
import { Failure, type InstagramApi } from './api';

export interface User {
  name: string;
  picture: string | null;
}

export interface Message {
  senderId: string;
  text: string;
  atMs: number;
}

export interface Thread {
  /** Numeric; opens the chat at instagram.com/direct/t/<id>/. */
  id: string;
  title: string | null;
  isGroup: boolean;
  muted: boolean;
  /** Every id a participant goes by (Instagram id, messaging id), to that participant. */
  users: Record<string, User>;
  /** Newest first. */
  messages: Message[];
  /** Every id the signed-in account goes by in this thread. */
  viewerIds: Set<string>;
  /** Whether the newest incoming message is unread; null when the source doesn't say. */
  unread: boolean | null;
  /** Their messages since your last one, newest first. Empty if you wrote last. */
  incoming: Message[];
}

export type Reader = 'graphql' | 'rest';
export const READER_LABEL: Record<Reader, string> = { graphql: 'web inbox', rest: 'older web inbox' };

/** Messages fetched per conversation, enough for a notification with the last few. */
const MESSAGES_PER_THREAD = 5;
const THREADS = 20;
/** instagram.com's inbox query (PolarisDirectInboxQuery). Its id changes when Instagram updates the site. */
export const INBOX_DOC_ID = '27262915580045003';
const NUMERIC_ID = /^\d{1,40}$/;

function thread(t: Omit<Thread, 'incoming'>): Thread {
  const firstOwn = t.messages.findIndex((m) => t.viewerIds.has(m.senderId));
  return { ...t, incoming: firstOwn === -1 ? t.messages : t.messages.slice(0, firstOwn) };
}

const objects = (a: unknown): any[] => (Array.isArray(a) ? a.filter((x) => x && typeof x === 'object') : []);
const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v));

function ids(o: any): string[] {
  if (!o) return [];
  return ['interop_messaging_user_fbid', 'fbid_v2', 'id', 'pk', 'pk_id', 'igid', 'strong_id__'].map((k) => str(o[k])).filter((v) => v && v !== 'null');
}

/** "Full Name (@username)", so the account is clear even when names repeat. */
function userOf(user: any): User | null {
  const fullName = (str(user.full_name).trim() || str(user.name)).trim();
  const username = str(user.username).trim();
  const name = fullName && username && fullName !== username ? `${fullName} (@${username})` : username ? `@${username}` : fullName;
  if (!name.trim()) return null;
  const picture = ['profile_pic_url', 'profile_picture_url', 'profile_pic_url_hd'].map((k) => str(user[k])).find((u) => u.startsWith('https://'));
  return { name, picture: picture ?? null };
}

/** The first object anywhere under `root` that has `key`. */
function firstObjectWith(root: any, key: string): any {
  if (!root || typeof root !== 'object') return null;
  if (key in root) return root;
  for (const child of Object.values(root)) {
    const found = firstObjectWith(child, key);
    if (found) return found;
  }
  return null;
}

/** Instagram timestamps come as microseconds (REST), milliseconds (GraphQL) or seconds, sometimes as strings. */
export function millis(value: unknown): number {
  const n = typeof value === 'number' ? Math.trunc(value) : typeof value === 'string' ? Math.trunc(Number(value)) || 0 : 0;
  if (n > 100_000_000_000_000) return Math.trunc(n / 1000); // microseconds
  if (n >= 1 && n <= 99_999_999_999) return n * 1000; // seconds
  return n;
}

// ------------------------------------------------------------------ GraphQL

const deviceId = `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;

export async function readGraphql(api: InstagramApi): Promise<Thread[]> {
  const variables = {
    device_id_for_iris_subscription: deviceId,
    __relay_internal__pv__IGDIsProfessionalAccountGKrelayprovider: false,
    __relay_internal__pv__IGDPinnedThreadsRenderEnabledGKrelayprovider: true,
    __relay_internal__pv__IGDMaxUnreadMessagesCountrelayprovider: MESSAGES_PER_THREAD,
    __relay_internal__pv__PolarisAIGMAccountLabelEnabledrelayprovider: false,
    __relay_internal__pv__IGDThreadListActionsEnabledGKrelayprovider: true,
  };
  const json = await api.graphql('PolarisDirectInboxQuery', INBOX_DOC_ID, variables, 'https://www.instagram.com/direct/inbox/');
  return parseGraphql(json, api.viewerId);
}

export function parseGraphql(json: any, viewerId: string | null): Thread[] {
  const data = json?.data;
  if (!data) throw Failure.badResponse('no data');
  const mailbox = data.get_slide_mailbox_for_iris_subscription ?? firstObjectWith(data, 'threads_by_folder');
  if (!mailbox) throw Failure.badResponse('no inbox in the reply');
  const edges = mailbox.threads_by_folder?.edges;
  if (!Array.isArray(edges)) throw Failure.badResponse('no conversations in the reply');
  return objects(edges)
    .map((edge) => (edge.node ? slideThread(edge.node.as_ig_direct_thread ?? edge.node, viewerId) : null))
    .filter((t): t is Thread => t !== null);
}

function slideThread(t: any, viewerId: string | null): Thread | null {
  const id = ['thread_id', 'id', 'thread_key', 'thread_fbid'].map((k) => str(t[k])).find((v) => NUMERIC_ID.test(v));
  if (!id) return null;
  const viewerIds = new Set([...ids(t.viewer), ...(viewerId ? [viewerId] : []), ...(str(t.viewer_id) ? [str(t.viewer_id)] : [])]);
  const users: Record<string, User> = {};
  for (const user of objects(t.users)) {
    const u = userOf(user);
    if (u) for (const uid of ids(user)) users[uid] = u;
  }
  const messages: Message[] = [];
  for (const edge of objects(t.slide_messages?.edges)) {
    const node = edge.node;
    if (!node) continue;
    const type = str(node.content_type).toUpperCase();
    if (type.endsWith('_LOG_XMAT') || type.endsWith('PARTICIPANT_XMAT')) continue;
    const sender = node.sender;
    const senderUser = sender?.user_dict;
    const senderIds = [str(node.sender_fbid), ...ids(sender), ...ids(senderUser)];
    const senderId = senderIds.find((s) => s);
    if (!senderId) continue;
    // Known by any of its ids, so a sender is matched to the viewer or a participant whichever id it comes with.
    const known = senderIds.find((s) => viewerIds.has(s)) ?? senderIds.find((s) => s in users) ?? senderId;
    const u = senderUser ? userOf(senderUser) : null;
    if (u && !(known in users)) users[known] = u;
    messages.push({ senderId: known, text: slidePreview(node), atMs: millis(node.timestamp_ms ?? node.timestamp) });
  }
  messages.sort((a, b) => b.atMs - a.atMs);
  // Without the viewer's messaging id, a sender who isn't a participant can only be the viewer.
  const allViewerIds =
    ids(t.viewer).length === 0 && Object.keys(users).length > 0
      ? new Set([...viewerIds, ...messages.map((m) => m.senderId).filter((s) => !(s in users))])
      : viewerIds;
  return thread({
    id,
    title: str(t.thread_title).trim() || null,
    isGroup: t.is_group === true,
    muted: t.is_muted === true || t.muted === true,
    users,
    messages,
    viewerIds: allViewerIds,
    unread: t.marked_as_unread === true ? true : null,
  });
}

function slidePreview(node: any): string {
  const content = node.content;
  const text = (str(content?.text_body).trim() || str(node.text_body)).trim();
  if (text) return text;
  const type = str(node.content_type).toUpperCase();
  const xma = content?.xma;
  const attachments = objects(content?.attachments);
  if (xma) {
    const target = str(xma.target_url);
    if (type === 'MONTAGE_SHARE_XMA' || target.includes('/stories/')) return 'Shared a story';
    if (target.includes('/reel/') || target.includes('/reels/')) return 'Shared a reel';
    if (target.includes('/p/')) return 'Shared a post';
    const title = str(xma.title_text).trim();
    return title ? `Shared: ${title}` : 'Shared something';
  }
  if (type.includes('VOICE') || type.includes('AUDIO')) return 'Sent a voice message';
  if (content?.animated_media || type.includes('ANIMATED')) return 'Sent a GIF';
  if (type.includes('STICKER')) return 'Sent a sticker';
  if (attachments.length > 0) {
    const video = attachments.some((a) => a.attachment_mp4_url || str(a.attachment_mime_type).startsWith('video')) || type.includes('VIDEO');
    return video ? 'Sent a video' : 'Sent a photo';
  }
  if (type.includes('VIDEO')) return 'Sent a video';
  if (type.includes('IMAGE') || type.includes('PHOTO')) return 'Sent a photo';
  if (type.includes('LIKE') || type.includes('HEART')) return '❤️';
  return 'New message';
}

// --------------------------------------------------------------------- REST

export async function readRest(api: InstagramApi): Promise<Thread[]> {
  const json = await api.getJson(
    `/api/v1/direct_v2/inbox/?persistentBadging=true&folder=&limit=${THREADS}&thread_message_limit=${MESSAGES_PER_THREAD}`,
    'https://www.instagram.com/direct/inbox/',
  );
  return parseRest(json, api.viewerId);
}

export function parseRest(json: any, viewerId: string | null): Thread[] {
  const inbox = json?.inbox;
  if (!inbox) throw Failure.badResponse('no inbox');
  const viewer = str(json.viewer?.pk) || str(json.viewer?.pk_id) || viewerId;
  return objects(inbox.threads)
    .map((t): Thread | null => {
      const id = str(t.thread_id);
      if (!NUMERIC_ID.test(id)) return null;
      const users: Record<string, User> = {};
      for (const user of objects(t.users)) {
        const u = userOf(user);
        if (u) for (const k of ['pk', 'pk_id', 'strong_id__']) if (str(user[k])) users[str(user[k])] = u;
      }
      const messages = objects(t.items)
        .map((item) => ({ senderId: str(item.user_id), text: restPreview(item), atMs: millis(item.timestamp) }))
        .sort((a, b) => b.atMs - a.atMs);
      const viewerIds = new Set(viewer ? [viewer] : []);
      const seenAt = viewer ? millis(t.last_seen_at?.[viewer]?.timestamp) : 0;
      const latest = messages[0];
      return thread({
        id,
        title: str(t.thread_title).trim() || null,
        isGroup: t.is_group === true,
        muted: t.muted === true,
        users,
        messages,
        viewerIds,
        unread: latest !== undefined && !viewerIds.has(latest.senderId) && latest.atMs > seenAt,
      });
    })
    .filter((t): t is Thread => t !== null);
}

function restPreview(item: any): string {
  const texts: Record<string, () => string | undefined> = {
    text: () => str(item.text),
    like: () => '❤️',
    link: () => str(item.link?.text),
    media: () => (item.media?.media_type === 2 ? 'Sent a video' : 'Sent a photo'),
    raven_media: () => 'Sent a photo or video',
    visual_media: () => 'Sent a photo or video',
    voice_media: () => 'Sent a voice message',
    animated_media: () => 'Sent a GIF',
    media_share: () => 'Shared a post',
    xma_media_share: () => 'Shared a post',
    clip: () => 'Shared a reel',
    xma_clip: () => 'Shared a reel',
    story_share: () => 'Shared a story',
    xma_story_share: () => 'Shared a story',
    reel_share: () => str(item.reel_share?.text).trim() || 'Replied to your story',
    profile: () => 'Shared a profile',
    action_log: () => str(item.action_log?.description),
  };
  return texts[str(item.item_type)]?.()?.trim() || 'New message';
}
