/**
 * The subscriptions feed: newest long-form uploads of each channel, like the
 * Android module (Browse.kt): the channel's Videos tab gives durations, its RSS
 * feed exact upload dates. The RSS is of the videos-only uploads playlist
 * (UULF…), which leaves Shorts and live streams out.
 */
import type { FeedResult, Video } from '../types';
import { channel } from './channel';
import { networkError } from './errors';
import { watchUrl } from './parse';

/** As on Android (Browse.kt). */
const PARALLELISM = 6;
const PER_CHANNEL = 15;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };
const unescape = (s: string) => s.replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, e: string) => ENTITIES[e]);
const tag = (entry: string, name: string) => {
  const m = entry.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? unescape(m[1].trim()) : null;
};
const attr = (entry: string, name: string, attribute: string) => {
  const m = entry.match(new RegExp(`<${name}\\b[^>]*\\b${attribute}="([^"]*)"`));
  return m ? unescape(m[1]) : null;
};

/** The videos of a YouTube RSS feed. Hermes has no XML parser; the feed's format is fixed and simple. */
export function parseUploadsRss(xml: string): Video[] {
  const videos: Video[] = [];
  for (const [, entry] of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const id = tag(entry, 'yt:videoId');
    if (!id) continue;
    const published = Date.parse(tag(entry, 'published') ?? '');
    const views = Number(attr(entry, 'media:statistics', 'views'));
    videos.push({
      type: 'video',
      id,
      url: watchUrl(id),
      title: tag(entry, 'title') ?? '',
      channelId: tag(entry, 'yt:channelId'),
      channelName: tag(entry.slice(entry.indexOf('<author>')), 'name'),
      thumbnail: attr(entry, 'media:thumbnail', 'url'),
      uploadedAt: Number.isFinite(published) ? published : null,
      viewCount: Number.isFinite(views) ? views : null,
    });
  }
  return videos;
}

async function uploadsRss(channelId: string): Promise<Video[]> {
  const url = `https://www.youtube.com/feeds/videos.xml?playlist_id=UULF${channelId.slice(2)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`YouTube answered HTTP ${response.status}.`);
  return parseUploadsRss(await response.text());
}

/** One channel's newest videos: the Videos tab's, with the RSS feed's exact dates; either alone if the other fails. */
async function channelFeed(channelId: string): Promise<Video[]> {
  const [rss, tab] = await Promise.allSettled([uploadsRss(channelId), channel(channelId).then((c) => c.videos)]);
  if (rss.status === 'rejected' && tab.status === 'rejected') throw rss.reason;
  const exact = new Map((rss.status === 'fulfilled' ? rss.value : []).map((v) => [v.id, v]));
  const videos: Video[] = tab.status === 'fulfilled' ? tab.value.map((v) => ({ ...v, uploadedAt: exact.get(v.id)?.uploadedAt ?? v.uploadedAt })) : [];
  const listed = new Set(videos.map((v) => v.id));
  for (const v of exact.values()) if (!listed.has(v.id)) videos.push(v);
  return videos.sort(newestFirst).slice(0, PER_CHANNEL);
}

const newestFirst = (a: Video, b: Video) => (b.uploadedAt ?? 0) - (a.uploadedAt ?? 0);

export async function feed(channelIds: string[]): Promise<FeedResult> {
  const ids = [...new Set(channelIds)];
  const items: Video[] = [];
  const failed: FeedResult['failed'] = [];
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next++];
      try {
        items.push(...(await channelFeed(id)));
      } catch (e) {
        failed.push({ channelId: id, error: networkError(e).message });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLELISM, ids.length) }, worker));
  return { items: items.sort(newestFirst), failed };
}
