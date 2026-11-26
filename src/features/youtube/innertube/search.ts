/** YouTube search, and the next page of a search or a channel's videos. */
import type { Channel, Page, SearchItem } from '../types';
import { nextChannelPage } from './channel';
import { bestImage, channelUrl, continuationToken, encodeToken, findAll, type PageToken, parseCount, text, videoFromRenderer, walk } from './parse';
import { innertube } from './request';

/** YouTube's search filters ("Type: Video", "Type: Channel"). */
const PARAMS = { all: undefined, videos: 'EgIQAQ==', channels: 'EgIQAg==' } as const;

function channelFromRenderer(r: any): Channel | null {
  if (typeof r?.channelId !== 'string') return null;
  // YouTube puts the subscriber count in whichever of these two isn't the @handle.
  const subscribers = [text(r.subscriberCountText), text(r.videoCountText)].find((t) => t && /subscriber/i.test(t));
  return {
    type: 'channel',
    id: r.channelId,
    url: channelUrl(r.channelId),
    title: text(r.title) ?? '',
    thumbnail: bestImage(r.thumbnail),
    subscriberCount: parseCount(subscribers),
    description: text(r.descriptionSnippet),
    verified: findAll(r.ownerBadges, 'style').some((s) => s === 'BADGE_STYLE_TYPE_VERIFIED'),
  };
}

/** The videos and channels of a search answer (first page or a continuation). */
export function parseSearch(json: unknown): Page<SearchItem> {
  const items: SearchItem[] = [];
  walk(json, (key, value) => {
    const item = key === 'videoRenderer' ? videoFromRenderer(value) : key === 'channelRenderer' ? channelFromRenderer(value) : null;
    if (item) items.push(item);
  });
  const token = continuationToken(json);
  return { items, nextPage: token ? encodeToken({ kind: 'search', token }) : null };
}

export async function search(query: string, kind: 'all' | 'videos' | 'channels'): Promise<Page<SearchItem>> {
  const params = PARAMS[kind];
  return parseSearch(await innertube('web', 'search', params ? { query, params } : { query }));
}

export async function more(token: string): Promise<Page<SearchItem>> {
  const t = JSON.parse(token) as PageToken;
  if (t.kind === 'channel') return nextChannelPage(t);
  return parseSearch(await innertube('web', 'search', { continuation: t.token }));
}
