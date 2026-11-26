/**
 * POSTs to YouTube's InnerTube API (the JSON API youtube.com and YouTube's apps use),
 * as the clients in clients.ts. No account, no cookies: only a visitor id YouTube
 * hands out to anyone, which the visionOS client needs before it answers with streams.
 */
import { type ClientName, userAgentFor, VISIONOS, WEB } from './clients';
import { MESSAGES, networkError, YouTubeError } from './errors';

export type Endpoint = 'search' | 'browse' | 'player' | 'navigation/resolve_url' | 'visitor_id';

const API = 'https://www.youtube.com/youtubei/v1/';
const PLAYER_API = 'https://youtubei.googleapis.com/youtubei/v1/player';
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * YouTube's hl (language) and gl (country). The language stays English: the parsers read
 * English counts and dates ("2.9M views", "3 days ago"), like the rest of the app's text.
 */
export function locale(): { hl: string; gl: string } {
  const region = (Intl.DateTimeFormat().resolvedOptions().locale ?? '').split('-')[1];
  return { hl: 'en', gl: region && /^[A-Z]{2}$/.test(region) ? region : 'US' };
}

const random = (length: number) => Array.from({ length }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');

function context(client: ClientName, visitorData?: string) {
  const { hl, gl } = locale();
  if (client === 'web') return { client: { clientName: WEB.clientName, clientVersion: WEB.clientVersion, hl, gl, utcOffsetMinutes: 0 } };
  const { id: _id, userAgentVersion: _ua, ...info } = VISIONOS;
  return {
    client: { ...info, hl, gl, utcOffsetMinutes: 0, ...(visitorData ? { visitorData } : {}) },
    request: { internalExperimentFlags: [] },
  };
}

function headers(client: ClientName): Record<string, string> {
  const base = { 'Content-Type': 'application/json', 'User-Agent': userAgentFor(client, locale().gl) };
  return client === 'visionos'
    ? { ...base, 'X-Goog-Api-Format-Version': '2' }
    : { ...base, 'X-YouTube-Client-Name': WEB.id, 'X-YouTube-Client-Version': WEB.clientVersion, Origin: 'https://www.youtube.com', Referer: 'https://www.youtube.com/' };
}

async function post(url: string, client: ClientName, body: object): Promise<any> {
  let response: Response;
  try {
    response = await fetch(url, { method: 'POST', headers: headers(client), body: JSON.stringify(body) });
  } catch (e) {
    throw networkError(e);
  }
  if (response.status === 429) throw new YouTubeError('ERR_YOUTUBE_BLOCKED', MESSAGES.blocked);
  if (!response.ok) throw new YouTubeError('ERR_YOUTUBE', `YouTube answered HTTP ${response.status}.`);
  try {
    return await response.json();
  } catch {
    throw new YouTubeError('ERR_YOUTUBE', 'YouTube sent an answer Lite Social could not read.');
  }
}

let visitor: Promise<string> | null = null;

/** YouTube's anonymous visitor id, asked for once per app run (again after a failure). */
export function visitorData(): Promise<string> {
  visitor ??= post(`${API}visitor_id?prettyPrint=false`, 'visionos', { context: context('visionos') })
    .then((json) => {
      const id = json?.responseContext?.visitorData;
      if (typeof id !== 'string' || !id) throw new YouTubeError('ERR_YOUTUBE', 'YouTube sent no visitor id.');
      return id;
    })
    .catch((e) => {
      visitor = null;
      throw e;
    });
  return visitor;
}

/** Forgets the visitor id, e.g. after YouTube blocked it. */
export function resetVisitorData(): void {
  visitor = null;
}

export async function innertube(client: ClientName, endpoint: Endpoint, body: object): Promise<any> {
  if (client === 'web') return post(`${API}${endpoint}?prettyPrint=false`, 'web', { context: context('web'), ...body });
  if (endpoint !== 'player') throw new Error(`The visionOS client is only used for the player, not ${endpoint}.`);
  const request = { context: context('visionos', await visitorData()), ...body, cpn: random(16), contentCheckOk: true, racyCheckOk: true };
  return post(`${PLAYER_API}?prettyPrint=false&t=${random(12)}`, 'visionos', request);
}
