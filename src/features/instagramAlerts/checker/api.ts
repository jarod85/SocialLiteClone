/**
 * Instagram's own web API (the one instagram.com uses), as the in-app browser would
 * call it. TypeScript port of modules/instagram-alerts InstagramApi.kt; the requests
 * go through Swift (bridge.ts), which adds the login cookies.
 */
import { FALLBACK_USER_AGENTS } from '@/webview/userAgent';

import { request, session } from './bridge';
import { useAlertsState } from './state';

const BASE = 'https://www.instagram.com';
/** instagram.com's public web app id, used until the page has told us the one it gives this browser. */
const WEB_APP_ID = '936619743392459';
/** Sent by instagram.com with every API call. */
const ASBD_ID = '359341';
const TOKENS_MAX_AGE_MS = 6 * 60 * 60_000;

export type FailureKind = 'notLoggedIn' | 'checkpoint' | 'rateLimited' | 'http' | 'badResponse';

export class Failure extends Error {
  constructor(
    readonly kind: FailureKind,
    message: string,
  ) {
    super(message);
    this.name = 'Failure';
  }

  static notLoggedIn = () => new Failure('notLoggedIn', 'Not logged in. Open Instagram in Lite Social and log in.');
  static checkpoint = () => new Failure('checkpoint', "Instagram wants you to confirm it's you. Open Instagram in Lite Social.");
  static rateLimited = () => new Failure('rateLimited', 'Instagram asked to slow down (HTTP 429). The next check will try again.');
  static http = (code: number, detail = '') => new Failure('http', `HTTP ${code}${detail ? ` (${detail})` : ''}`);
  static badResponse = (detail: string) => new Failure('badResponse', `Unexpected response: ${detail}`);
}

export interface Tokens {
  appId: string | null;
  fbDtsg: string | null;
  lsd: string | null;
}

/** Instagram's checksum of fb_dtsg, sent alongside it. */
export const jazoest = (fbDtsg: string) => `2${[...fbDtsg].reduce((sum, c) => sum + c.charCodeAt(0), 0)}`;

export const PATTERNS = {
  appId: [/"X-IG-App-ID"\s*:\s*"(\d{6,20})"/, /"appId"\s*:\s*"(\d{6,20})"/, /"APP_ID"\s*:\s*"(\d{6,20})"/],
  dtsg: [/\["DTSGInitialData",\[\],\{"token":"([^"]+)"/, /"dtsg"\s*:\s*\{\s*"token"\s*:\s*"([^"]+)"/, /name="fb_dtsg"\s+value="([^"]+)"/],
  lsd: [/\["LSD",\[\],\{"token":"([^"]+)"/, /"lsd"\s*:\s*\{\s*"token"\s*:\s*"([^"]+)"/],
};

export function find(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) return match[1];
  }
  return null;
}

const form = (fields: Record<string, string>) =>
  Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

export class InstagramApi {
  private cachedTokens: Tokens | null;

  private constructor(readonly viewerId: string | null) {
    const saved = useAlertsState.getState().webTokens;
    const fresh = saved && saved.owner === viewerId && Date.now() - saved.at < TOKENS_MAX_AGE_MS;
    this.cachedTokens = fresh ? (JSON.parse(saved.json) as Tokens) : null;
  }

  /** Null when the in-app browser has no Instagram login. */
  static async create(): Promise<InstagramApi | null> {
    const s = await session();
    return s.loggedIn ? new InstagramApi(s.viewerId) : null;
  }

  async getJson(path: string, referer = `${BASE}/`): Promise<any> {
    return this.json(await this.send('GET', path, null, referer, {}));
  }

  async postForm(path: string, fields: Record<string, string>, referer = `${BASE}/`, headers: Record<string, string> = {}): Promise<any> {
    return this.json(await this.send('POST', path, form(fields), referer, { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' }));
  }

  /** A GraphQL query as instagram.com's own page runs it: a persisted query named by its doc_id, with the page's tokens. */
  async graphql(friendlyName: string, docId: string, variables: object, referer: string): Promise<any> {
    const tokens = await this.tokens();
    if (!tokens.fbDtsg) throw Failure.badResponse("instagram.com's page had no request token");
    const json = await this.postForm(
      '/api/graphql',
      {
        av: this.viewerId ?? '',
        __a: '1',
        __comet_req: '7',
        fb_dtsg: tokens.fbDtsg,
        jazoest: jazoest(tokens.fbDtsg),
        lsd: tokens.lsd ?? '',
        fb_api_caller_class: 'RelayModern',
        fb_api_req_friendly_name: friendlyName,
        server_timestamps: 'true',
        doc_id: docId,
        variables: JSON.stringify(variables),
      },
      referer,
      { 'X-FB-Friendly-Name': friendlyName, 'X-FB-LSD': tokens.lsd ?? '' },
    );
    const error =
      (json?.errors?.[0]?.message as string | undefined) ||
      (json && 'error' in json ? json.errorSummary || `error ${json.error}` : undefined);
    if (error) {
      // The page's tokens may have expired; the next check fetches new ones.
      this.forgetTokens();
      throw Failure.badResponse(`GraphQL: ${String(error).slice(0, 80)}`);
    }
    return json;
  }

  /** The app id and request tokens embedded in instagram.com's page for this browser, kept for a few hours. */
  async tokens(): Promise<Tokens> {
    if (this.cachedTokens?.fbDtsg) return this.cachedTokens;
    const { status, body } = await this.send('GET', '/', null, `${BASE}/`, { Accept: 'text/html,application/xhtml+xml' }, false);
    if (status >= 300 && status < 400) throw Failure.notLoggedIn();
    if (status >= 400) throw Failure.http(status, 'instagram.com page');
    const tokens: Tokens = { appId: find(body, PATTERNS.appId), fbDtsg: find(body, PATTERNS.dtsg), lsd: find(body, PATTERNS.lsd) };
    this.cachedTokens = tokens;
    useAlertsState.setState({ webTokens: { owner: this.viewerId, json: JSON.stringify(tokens), at: Date.now() } });
    return tokens;
  }

  forgetTokens(): void {
    this.cachedTokens = null;
    useAlertsState.setState({ webTokens: null });
  }

  /** Sends a request; handles rate limits and remembers Instagram's www-claim, as the browser does. */
  private async send(method: string, path: string, body: string | null, referer: string, headers: Record<string, string>, expectJson = true) {
    const state = useAlertsState.getState();
    const base: Record<string, string> = {
      'User-Agent': state.userAgent ?? FALLBACK_USER_AGENTS.ios,
      Accept: '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: referer,
    };
    const api: Record<string, string> = expectJson
      ? {
          'X-IG-App-ID': this.cachedTokens?.appId ?? WEB_APP_ID,
          'X-ASBD-ID': ASBD_ID,
          'X-IG-WWW-Claim': state.wwwClaim ?? '0',
          'X-Requested-With': 'XMLHttpRequest',
          Origin: BASE,
          'Sec-Fetch-Site': 'same-origin',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Dest': 'empty',
        }
      : {};
    const response = await request(method, path, { ...base, ...api, ...headers }, body);
    const claim = response.headers?.['x-ig-set-www-claim'];
    if (claim) useAlertsState.setState({ wwwClaim: claim });
    if (response.status === 429) throw Failure.rateLimited();
    return response;
  }

  private json({ status, body }: { status: number; body: string }): any {
    if (status >= 300 && status < 400) throw Failure.notLoggedIn();
    let json: any = null;
    try {
      // Some of Instagram's endpoints guard their JSON against being run as a script.
      json = JSON.parse(body.replace(/^for \(;;\);/, ''));
    } catch {
      json = null;
    }
    const message = typeof json?.message === 'string' ? json.message : '';
    if (message === 'login_required') throw Failure.notLoggedIn();
    if (message === 'checkpoint_required' || message === 'challenge_required') throw Failure.checkpoint();
    if (status === 401 || status === 403) throw Failure.notLoggedIn();
    if (status >= 400) throw Failure.http(status, message.slice(0, 60));
    if (json === null || typeof json !== 'object') throw Failure.badResponse(body.trimStart().startsWith('<') ? 'a web page' : 'not JSON');
    return json;
  }
}
