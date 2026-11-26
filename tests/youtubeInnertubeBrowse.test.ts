/**
 * Search, channel pages and the subscriptions feed from YouTube's own answers
 * (trimmed real responses in tests/fixtures/youtube).
 */
import { channel, parseChannelVideos } from '@/features/youtube/innertube/channel';
import { feed, parseUploadsRss } from '@/features/youtube/innertube/feed';
import { parseAgo, parseCount, parseDuration } from '@/features/youtube/innertube/parse';
import { more, parseSearch, search } from '@/features/youtube/innertube/search';
import type { Channel, Video } from '@/features/youtube/types';

import { fixture, jsonFixture } from './fixtures';

const CHANNEL = 'UCHnyfMqiRRG1u-2MsSQLbXA';
const SHELF = ['uXuQF_PPg5U', 'KfODG5REyss', 'eyZEqSPeMwg'];

function answer(body: unknown, status = 200): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { ok: status < 300, status, json: async () => JSON.parse(text), text: async () => text } as Response;
}

const fetchMock = jest.fn();
beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

describe('text helpers', () => {
  it('reads durations, counts and ages', () => {
    expect(parseDuration('28:04')).toBe(1684);
    expect(parseDuration('1:05:56')).toBe(3956);
    expect(parseDuration('LIVE')).toBeNull();
    expect(parseCount('2,981,319 views')).toBe(2981319);
    expect(parseCount('21.5M subscribers')).toBe(21_500_000);
    expect(parseCount('No views')).toBeNull();
    expect(parseAgo('10 hours ago', 1_000_000_000_000)).toBe(1_000_000_000_000 - 10 * 3600_000);
    expect(parseAgo('Streamed 2 weeks ago', 1_000_000_000_000)).toBe(1_000_000_000_000 - 14 * 86400_000);
  });
});

describe('search', () => {
  const page = parseSearch(jsonFixture('youtube/search.json'));
  const videos = page.items.filter((i): i is Video => i.type === 'video');
  const channels = page.items.filter((i): i is Channel => i.type === 'channel');

  it('lists the videos found, without shelves of other videos or Shorts', () => {
    expect(videos.map((v) => v.id)).toEqual(['WbM7GP7QoEM', 'NIk_0AW5hFU']);
    expect(videos[0]).toMatchObject({
      url: 'https://www.youtube.com/watch?v=WbM7GP7QoEM',
      title: 'Scientists Said This Wave Was Impossible',
      durationSeconds: 1684,
      channelId: CHANNEL,
      channelName: 'Veritasium',
      viewCount: 2981319,
      uploadedText: '10 hours ago',
    });
    expect(videos[0].thumbnail).toMatch(/^https:\/\/i\.ytimg\.com\//);
    expect(page.items.some((i) => SHELF.includes(i.id) || i.id === 'HZjRoKgDnow')).toBe(false);
  });

  it('lists channels with their subscriber count', () => {
    expect(channels).toHaveLength(1);
    expect(channels[0]).toMatchObject({ id: CHANNEL, title: 'Veritasium', subscriberCount: 21_500_000 });
    expect(channels[0].thumbnail).toMatch(/^https:\/\/yt3\.ggpht\.com\//);
  });

  it('pages on with a token', async () => {
    expect(page.nextPage).toEqual(expect.any(String));
    fetchMock.mockResolvedValue(answer(fixture('youtube/search-more.json')));
    const next = await more(page.nextPage!);
    expect(next.items.map((i) => i.id)).toEqual(['uXuQF_PPg5U', 'KfODG5REyss']);
    expect(next.nextPage).toEqual(expect.any(String));
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.continuation).toEqual(expect.any(String));
  });

  it('filters by kind', async () => {
    fetchMock.mockResolvedValue(answer(fixture('youtube/search.json')));
    await search('veritasium', 'channels');
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body).toMatchObject({ query: 'veritasium', params: 'EgIQAg==' });
  });
});

describe('channel', () => {
  it('reads the header and the Videos tab', () => {
    const page = parseChannelVideos(jsonFixture('youtube/channel-videos.json'));
    expect(page).toMatchObject({ id: CHANNEL, url: `https://www.youtube.com/channel/${CHANNEL}`, title: 'Veritasium', subscriberCount: 21_500_000 });
    expect(page.avatar).toMatch(/^https:\/\//);
    expect(page.banner).toMatch(/^https:\/\//);
    expect(page.videos.map((v) => [v.id, v.durationSeconds])).toEqual([
      ['WbM7GP7QoEM', 1684],
      ['uXuQF_PPg5U', 2328],
      ['KfODG5REyss', 3956],
    ]);
    expect(page.videos[0]).toMatchObject({ title: 'Scientists Said This Wave Was Impossible', channelId: CHANNEL, channelName: 'Veritasium', viewCount: 2_900_000 });
    expect(page.nextPage).toEqual(expect.any(String));
  });

  it('resolves a handle URL before opening the channel, and pages on through more()', async () => {
    fetchMock
      .mockResolvedValueOnce(answer(fixture('youtube/resolve.json')))
      .mockResolvedValueOnce(answer(fixture('youtube/channel-videos.json')))
      .mockResolvedValueOnce(answer(fixture('youtube/channel-more.json')));
    const page = await channel('https://www.youtube.com/@veritasium');
    expect(page.id).toBe(CHANNEL);
    const browse = JSON.parse((fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string);
    expect(browse).toMatchObject({ browseId: CHANNEL, params: 'EgZ2aWRlb3PyBgQKAjoA' });
    const next = await more(page.nextPage!);
    expect(next.items.map((i) => i.id)).toEqual(['Y-W-w8yNiKU', 'HBluLfX2F_k']);
    expect((fetchMock.mock.calls[2] as [string])[0]).toContain('/youtubei/v1/browse');
  });
});

describe('feed', () => {
  it('reads a channel uploads RSS feed', () => {
    const videos = parseUploadsRss(fixture('youtube/uploads.xml'));
    expect(videos).toHaveLength(15);
    for (const v of videos) {
      expect(v.id).toMatch(/^[\w-]{11}$/);
      expect(Number.isFinite(v.uploadedAt)).toBe(true);
      expect(v.channelId).toBe(CHANNEL);
      expect(v.title).not.toContain('&amp;');
    }
  });

  it('merges channels newest first, with exact RSS dates, and lists channels it could not read', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('UULF' + CHANNEL.slice(2))) return answer(fixture('youtube/uploads.xml'));
      if (url.includes('/browse') && JSON.parse(init!.body as string).browseId === CHANNEL) return answer(fixture('youtube/channel-videos.json'));
      throw new TypeError('Network request failed');
    });
    const result = await feed([CHANNEL, 'UCbroken00000000000000xx']);
    expect(result.failed).toEqual([{ channelId: 'UCbroken00000000000000xx', error: 'No connection.' }]);
    expect(result.items.length).toBeGreaterThanOrEqual(15);
    const first = result.items.find((v) => v.id === 'WbM7GP7QoEM');
    expect(first?.durationSeconds).toBe(1684);
    const rssDate = parseUploadsRss(fixture('youtube/uploads.xml')).find((v) => v.id === 'WbM7GP7QoEM')?.uploadedAt;
    if (rssDate) expect(first?.uploadedAt).toBe(rssDate);
    const dates = result.items.map((v) => v.uploadedAt ?? 0);
    expect([...dates].sort((a, b) => b - a)).toEqual(dates);
  });
});
