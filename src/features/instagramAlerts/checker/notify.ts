/**
 * The checker's notifications on iOS (Android: AlertNotifier.kt), as local
 * notifications. Each has a fixed identifier, so a newer one replaces the older
 * one for the same conversation and read conversations can be removed. Tapping
 * one opens the same litesocial:// link as on Android.
 */
import * as Notifications from 'expo-notifications';

export interface Line {
  sender: string;
  text: string;
  atMs: number;
}

const link = (open: 'thread' | 'messages' | 'activity', thread?: string) =>
  `litesocial://browse/instagram?open=${open}${thread ? `&thread=${encodeURIComponent(thread)}` : ''}`;

async function post(identifier: string, title: string, body: string, url: string, group: string): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    identifier,
    content: { title, body, data: { url }, threadIdentifier: group } as Notifications.NotificationContentInput,
    trigger: null,
  });
}

export async function canPost(): Promise<boolean> {
  const { status, ios } = await Notifications.getPermissionsAsync();
  return status === 'granted' || ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
}

export async function requestPermission(): Promise<boolean> {
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

// shortcut: no sender pictures (iOS needs them saved as files first), add with UNNotificationAttachment if wanted.
export async function postConversation(threadId: string, title: string, isGroup: boolean, lines: Line[], _picture: string | null): Promise<void> {
  const body = lines.map((l) => (isGroup ? `${l.sender}: ${l.text}` : l.text)).join('\n');
  await post(`ig-dm:${threadId}`, title, body, link('thread', threadId), 'instagram-messages');
}

export async function postUnreadCount(count: number): Promise<void> {
  await post('ig-dm-badge', 'Instagram', count === 1 ? '1 unread message' : `${count} unread messages`, link('messages'), 'instagram-messages');
}

export async function postActivity(id: string, text: string, _picture: string | null, _atMs: number): Promise<void> {
  await post(`ig-activity:${id}`, 'Instagram', text, link('activity'), 'instagram-activity');
}

export async function postTest(): Promise<void> {
  await post('ig-test', 'Lite Social', 'Instagram messages will show up like this: who wrote, and what they said.', link('messages'), 'instagram-messages');
}

export async function cancelMessage(threadId: string): Promise<void> {
  await Notifications.dismissNotificationAsync(`ig-dm:${threadId}`);
}

export async function cancelUnreadCount(): Promise<void> {
  await Notifications.dismissNotificationAsync('ig-dm-badge');
}
