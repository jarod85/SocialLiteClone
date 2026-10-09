import { captionKey, pickCaption } from '@/features/youtube/captions';
import { FEED_LIMIT, mergeFeed } from '@/features/youtube/feed';
import { formatAge, formatCount, formatDuration, videoSubtitle } from '@/features/youtube/format';
import { parseCsvLine, parseSubscriptionsExport } from '@/features/youtube/importSubscriptions';
import { parseYouTubeLink, routeForLink } from '@/features/youtube/links';
import { pickQuality } from '@/features/youtube/quality';
import type { CaptionTrack, Video, VideoQuality } from '@/features/youtube/types';

const CHANNEL = 'UCHnyfMqiRRG1u-2MsSQLbXA';
const OTHER = 'UCsXVk37bltHxD1rDPwtNM8Q';

describe('parseYouTubeLink', () => {
  it.each([
    ['https://www.youtube.com/watch?v=aqz-KE-bpKQ', 'aqz-KE-bpKQ'],
    ['https://m.youtube.com/watch?app=desktop&v=aqz-KE-bpKQ&t=30s', 'aqz-KE-bpKQ'],
    ['https://youtu.be/aqz-KE-bpKQ?si=abc', 'aqz-KE-bpKQ'],
    ['youtube.com/live/aqz-KE-bpKQ', 'aqz-KE-bpKQ'],
    ['https://www.youtube.com/embed/aqz-KE-bpKQ', 'aqz-KE-bpKQ'],
    ['https://music.youtube.com/watch?v=aqz-KE-bpKQ&list=x', 'aqz-KE-bpKQ'],
  ])('finds the video in %s', (url, id) => {
    expect(parseYouTubeLink(url)).toEqual({ kind: 'video', id });
  });

  it('marks Shorts as Shorts', () => {
    expect(parseYouTubeLink('https://www.youtube.com/shorts/IHkp5Kq72ro')).toEqual({ kind: 'short', id: 'IHkp5Kq72ro' });
    expect(routeForLink('https://youtube.com/shorts/IHkp5Kq72ro')).toBe('/youtube/watch/IHkp5Kq72ro?short=1');
  });

  it('recognizes channels and handles', () => {
    expect(parseYouTubeLink(`https://www.youtube.com/channel/${CHANNEL}`)).toEqual({ kind: 'channel', id: CHANNEL });
    expect(parseYouTubeLink('https://www.youtube.com/@veritasium/videos')).toEqual({ kind: 'handle', handle: '@veritasium' });
    expect(routeForLink('https://www.youtube.com/@veritasium')).toBe(
      `/youtube/channel/${encodeURIComponent('https://www.youtube.com/@veritasium')}`,
    );
  });

  it.each([
    'https://www.instagram.com/p/abc/',
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/',
    'https://evil.example/watch?v=aqz-KE-bpKQ',
    'veritasium',
    '',
  ])('ignores %s', (url) => {
    expect(parseYouTubeLink(url)).toBeNull();
  });
});

describe('format', () => {
  it('formats durations', () => {
    expect(formatDuration(75)).toBe('1:15');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(0)).toBe('');
    expect(formatDuration(null)).toBe('');
  });

  it('formats counts', () => {
    expect(formatCount(999)).toBe('999');
    expect(formatCount(1234)).toBe('1.2K');
    expect(formatCount(21_300_000)).toBe('21M');
    expect(formatCount(-1)).toBe('');
  });

  it('formats ages', () => {
    const now = Date.UTC(2026, 9, 7);
    expect(formatAge(now - 30_000, now)).toBe('just now');
    expect(formatAge(now - 5 * 60_000, now)).toBe('5 minutes ago');
    expect(formatAge(now - 86_400_000, now)).toBe('1 day ago');
    expect(formatAge(now - 3 * 86_400_000, now)).toBe('3 days ago');
    expect(formatAge(null, now)).toBe('');
  });

  it('builds subtitles from what is known', () => {
    const now = Date.UTC(2026, 9, 7);
    expect(videoSubtitle({ channelName: 'Veritasium', uploadedAt: now - 2 * 3600_000, viewCount: 1_500_000 }, now)).toBe(
      'Veritasium · 2 hours ago · 1.5M views',
    );
    expect(videoSubtitle({ channelName: 'Veritasium', uploadedText: '6 days ago' }, now)).toBe('Veritasium · 6 days ago');
  });
});

describe('parseSubscriptionsExport', () => {
  it('reads Google Takeout CSV', () => {
    const csv = [
      'Channel Id,Channel Url,Channel Title',
      `${CHANNEL},http://www.youtube.com/channel/${CHANNEL},Veritasium`,
      `${OTHER},http://www.youtube.com/channel/${OTHER},"Kurzgesagt – In a Nutshell, Science"`,
      '',
    ].join('\r\n');
    expect(parseSubscriptionsExport(`﻿${csv}`)).toEqual([
      { id: CHANNEL, title: 'Veritasium' },
      { id: OTHER, title: 'Kurzgesagt – In a Nutshell, Science' },
    ]);
  });

  it('reads NewPipe JSON and skips other services', () => {
    const json = JSON.stringify({
      app_version: '0.27.0',
      subscriptions: [
        { service_id: 0, url: `https://www.youtube.com/channel/${CHANNEL}`, name: 'Veritasium' },
        { service_id: 1, url: 'https://soundcloud.com/someone', name: 'SoundCloud artist' },
        { service_id: 0, url: `https://www.youtube.com/channel/${CHANNEL}`, name: 'Duplicate' },
      ],
    });
    expect(parseSubscriptionsExport(json)).toEqual([{ id: CHANNEL, title: 'Veritasium' }]);
  });

  it('returns nothing for unrelated files', () => {
    expect(parseSubscriptionsExport('hello, world')).toEqual([]);
    expect(parseSubscriptionsExport('{not json')).toEqual([]);
    expect(parseSubscriptionsExport('')).toEqual([]);
  });

  it('parses quoted CSV cells', () => {
    expect(parseCsvLine('a,"b, c","say ""hi"""')).toEqual(['a', 'b, c', 'say "hi"']);
  });
});

describe('mergeFeed', () => {
  const video = (id: string, channelId: string, uploadedAt: number): Video => ({
    type: 'video',
    id,
    url: `https://www.youtube.com/watch?v=${id}`,
    title: id,
    channelId,
    uploadedAt,
  });

  it('replaces loaded channels, keeps failed ones, drops unsubscribed ones, newest first', () => {
    const cached = [video('old-a', CHANNEL, 1), video('old-b', OTHER, 2), video('gone', 'UCgone', 3)];
    const fresh = [video('new-a', CHANNEL, 10)];
    expect(mergeFeed(cached, fresh, [CHANNEL, OTHER], [OTHER]).map((v) => v.id)).toEqual(['new-a', 'old-b']);
  });

  it('removes duplicates and caps the size', () => {
    const fresh = Array.from({ length: FEED_LIMIT + 10 }, (_, i) => video(`v${i}`, CHANNEL, i));
    const merged = mergeFeed([], [...fresh, fresh[0]], [CHANNEL], []);
    expect(merged).toHaveLength(FEED_LIMIT);
    expect(merged[0].id).toBe(`v${FEED_LIMIT + 9}`);
  });
});

describe('pickQuality', () => {
  const q = (height: number): VideoQuality => ({ height, label: `${height}p`, uri: `file:///v-${height}.mpd` });
  const qualities = [q(1080), q(720), q(480), q(360)];

  it('is automatic without a preference or qualities', () => {
    expect(pickQuality(qualities, null)).toBeNull();
    expect(pickQuality([], 720)).toBeNull();
  });

  it('takes the preferred height, or the nearest below', () => {
    expect(pickQuality(qualities, 720)?.height).toBe(720);
    expect(pickQuality([q(480), q(1080), q(360)], 720)?.height).toBe(480);
    expect(pickQuality(qualities, 2160)?.height).toBe(1080);
  });

  it('takes the lowest when all are higher', () => {
    expect(pickQuality([q(720), q(1080)], 360)?.height).toBe(720);
  });
});

describe('captions', () => {
  const track = (id: string, language: string, autoGenerated = false): CaptionTrack => ({ id, language, label: language, autoGenerated });
  const tracks = [track('cc0', 'en'), track('cc1', 'zh-TW'), track('cc2', 'zh-CN'), track('cc3', 'en', true), track('cc4', 'pt-BR')];

  it('groups Chinese by script and other languages by language', () => {
    expect(captionKey('zh-CN')).toBe('zh-hans');
    expect(captionKey('zh-Hans')).toBe('zh-hans');
    expect(captionKey('zh_TW')).toBe('zh-hant');
    expect(captionKey('zh-HK')).toBe('zh-hant');
    expect(captionKey('zh')).toBe('zh');
    expect(captionKey('en-GB')).toBe('en');
  });

  it('turns on the language picked before, uploaded captions first', () => {
    expect(pickCaption(tracks, 'zh-Hans')?.id).toBe('cc2');
    expect(pickCaption(tracks, 'zh-TW')?.id).toBe('cc1');
    expect(pickCaption(tracks, 'en-GB')?.id).toBe('cc0');
    expect(pickCaption(tracks, 'pt')?.id).toBe('cc4');
    expect(pickCaption([track('cc0', 'en', true), track('cc1', 'en')], 'en')?.id).toBe('cc1');
  });

  it('stays off without a pick or a match', () => {
    expect(pickCaption(tracks, null)).toBeNull();
    expect(pickCaption(tracks, 'ja')).toBeNull();
    expect(pickCaption([], 'en')).toBeNull();
  });
});
