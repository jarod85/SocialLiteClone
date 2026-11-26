/** A channel's header and its Videos tab (long-form uploads only: Shorts have their own tab). */
import type { ChannelPage, Page, SearchItem, Video } from '../types';
import { bestImage, channelUrl, continuationToken, encodeToken, findAll, type PageToken, parseCount, text, videoFromLockup } from './parse';
import { innertube } from './request';

/** The Videos tab, as YouTube's own channel page asks for it. */
const VIDEOS_TAB = 'EgZ2aWRlb3PyBgQKAjoA';

function videosIn(json: unknown, channel: { id: string; name: string | null }): Video[] {
  return findAll(json, 'lockupViewModel')
    .map((l) => videoFromLockup(l, channel))
    .filter((v): v is Video => v !== null);
}

export function parseChannelVideos(json: any): ChannelPage {
  const meta = json?.metadata?.channelMetadataRenderer ?? {};
  const header = json?.header?.pageHeaderRenderer?.content?.pageHeaderViewModel ?? {};
  const id: string = meta.externalId ?? '';
  const title: string = meta.title ?? text(header.title?.dynamicTextViewModel?.text) ?? '';
  const subscribers = findAll(header.metadata, 'metadataParts')
    .flat()
    .map((p: any) => text(p?.text))
    .find((t: string | null) => t && /subscriber/i.test(t));
  const token = continuationToken(json);
  return {
    id,
    url: channelUrl(id),
    title,
    avatar: bestImage(meta.avatar) ?? bestImage(findAll(header.image, 'avatarViewModel')[0]?.image),
    banner: bestImage(header.banner?.imageBannerViewModel?.image),
    subscriberCount: parseCount(subscribers),
    description: meta.description ?? null,
    videos: videosIn(json, { id, name: title || null }),
    nextPage: token ? encodeToken({ kind: 'channel', token, id, name: title || null }) : null,
  };
}

/** A channel id ("UC…") for an id, a channel URL or an @handle URL. */
async function resolve(idOrUrl: string): Promise<string> {
  if (/^UC[\w-]{22}$/.test(idOrUrl)) return idOrUrl;
  const json = await innertube('web', 'navigation/resolve_url', { url: idOrUrl });
  const id = json?.endpoint?.browseEndpoint?.browseId;
  if (typeof id !== 'string') throw new Error("YouTube doesn't know this channel.");
  return id;
}

export async function channel(idOrUrl: string): Promise<ChannelPage> {
  const id = await resolve(idOrUrl);
  return parseChannelVideos(await innertube('web', 'browse', { browseId: id, params: VIDEOS_TAB }));
}

export async function nextChannelPage(t: Extract<PageToken, { kind: 'channel' }>): Promise<Page<SearchItem>> {
  const json = await innertube('web', 'browse', { continuation: t.token });
  const token = continuationToken(json);
  return { items: videosIn(json, t), nextPage: token ? encodeToken({ ...t, token }) : null };
}
