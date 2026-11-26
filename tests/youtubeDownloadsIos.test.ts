/**
 * Starting a download on iOS: the app finds the streams with its own engine, then
 * hands their addresses to the Swift side (mocked here), which downloads and joins them.
 */
import type { DownloadUpdate } from '@/features/youtube/types';

import { fixture } from './fixtures';

const mockStart = jest.fn();
const mockListeners: ((u: DownloadUpdate) => void)[] = [];
jest.mock('expo', () => ({
  requireOptionalNativeModule: (name: string) =>
    name === 'LiteSocialYouTube'
      ? {
          startDownload: (...args: unknown[]) => mockStart(...args),
          addListener: (_event: string, l: (u: DownloadUpdate) => void) => {
            mockListeners.push(l);
            return { remove() {} };
          },
          emit: (_event: string, u: DownloadUpdate) => mockListeners.forEach((l) => l(u)),
        }
      : null,
}));

// eslint-disable-next-line import/first
import { youtube } from '@/features/youtube/native';

function answer(body: string, status = 200): Response {
  return { ok: status < 300, status, json: async () => JSON.parse(body), text: async () => body } as Response;
}

const fetchMock = jest.fn();
const seen: DownloadUpdate[] = [];
beforeAll(() => youtube().addListener('onDownloadUpdate', (u) => seen.push(u)));
beforeEach(() => {
  seen.length = 0;
  mockStart.mockReset();
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const options = (format: 'mp4' | 'mp3') => ({
  url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  title: 'Never Gonna Give You Up',
  format,
  maxHeight: 720,
  mp3Kbps: 192,
});

it('finds the streams and hands them to the Swift side', async () => {
  fetchMock.mockImplementation(async (url: string) =>
    url.includes('/visitor_id') ? answer(JSON.stringify({ responseContext: { visitorData: 'V' } })) : answer(fixture('youtube/player-visionos.json')),
  );
  const id = youtube().startDownload(options('mp4'));
  expect(seen[0]).toMatchObject({ id, title: 'Never Gonna Give You Up', format: 'mp4', state: 'queued', progress: 0 });
  for (let i = 0; i < 5 && !mockStart.mock.calls.length; i++) await settle();
  expect(mockStart).toHaveBeenCalledWith(
    expect.objectContaining({
      id,
      format: 'mp4',
      videoUrl: 'https://rr1---sn-test.googlevideo.com/videoplayback?itag=135&id=test',
      audioUrl: 'https://rr1---sn-test.googlevideo.com/videoplayback?itag=140&id=test',
      artist: 'Rick Astley',
      durationMs: 213040,
    }),
  );
});

it('sends only the audio for an audio download', async () => {
  fetchMock.mockImplementation(async (url: string) =>
    url.includes('/visitor_id') ? answer(JSON.stringify({ responseContext: { visitorData: 'V' } })) : answer(fixture('youtube/player-visionos.json')),
  );
  youtube().startDownload(options('mp3'));
  for (let i = 0; i < 5 && !mockStart.mock.calls.length; i++) await settle();
  const sent = mockStart.mock.calls[0][0];
  expect(sent.format).toBe('mp3');
  expect(sent.videoUrl).toBeUndefined();
  expect(sent.audioUrl).toContain('itag=140');
});

it('reports a failure to find the streams as a failed download', async () => {
  fetchMock.mockRejectedValue(new TypeError('Network request failed'));
  const id = youtube().startDownload(options('mp4'));
  for (let i = 0; i < 5 && seen.length < 2; i++) await settle();
  expect(seen[1]).toMatchObject({ id, state: 'failed', error: 'No connection.' });
  expect(mockStart).not.toHaveBeenCalled();
});
