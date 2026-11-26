/**
 * The iOS side of modules/instagram-alerts: requests to www.instagram.com with the
 * in-app browser's cookies. The cookies stay in Swift (they never reach JavaScript),
 * and the host is fixed there, so they can only ever go to Instagram.
 */
import { requireOptionalNativeModule } from 'expo';

export interface InstagramResponse {
  status: number;
  body: string;
  /** Response headers, names in lower case. */
  headers: Record<string, string>;
}

interface Bridge {
  /** `path` starts with "/"; Swift adds the session cookies and the CSRF token. */
  request(method: string, path: string, headers: Record<string, string>, body: string | null): Promise<InstagramResponse>;
  /** Whether the browser holds an Instagram login, and the account's id (its ds_user_id cookie). */
  session(): Promise<{ loggedIn: boolean; viewerId: string | null }>;
}

const native = requireOptionalNativeModule<Bridge>('InstagramAlerts');

export function request(method: string, path: string, headers: Record<string, string>, body: string | null): Promise<InstagramResponse> {
  if (!native) return Promise.reject(new Error('Instagram notifications need the Lite Social app.'));
  return native.request(method, path, headers, body);
}

export async function session(): Promise<{ loggedIn: boolean; viewerId: string | null }> {
  return native ? native.session() : { loggedIn: false, viewerId: null };
}
