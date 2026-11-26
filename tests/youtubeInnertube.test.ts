/**
 * The iOS YouTube client's requests and errors (src/features/youtube/innertube).
 * fetch is mocked: these check what is sent and how answers turn into errors.
 */
import { networkError, playabilityError, YouTubeError } from '@/features/youtube/innertube/errors';
import { innertube, resetVisitorData } from '@/features/youtube/innertube/request';

const BOT = "YouTube is asking this network to prove it isn't a bot. Try again later or on another network (for example mobile data instead of Wi-Fi).";

function answer(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

const fetchMock = jest.fn();
beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  resetVisitorData();
});

describe('playabilityError', () => {
  it('treats the bot check as a blocked network', () => {
    const e = playabilityError({ status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm you’re not a bot' });
    expect(e).toBeInstanceOf(YouTubeError);
    expect(e?.code).toBe('ERR_YOUTUBE_BLOCKED');
    expect(e?.message).toBe(BOT);
  });

  it('treats age checks as restricted', () => {
    const e = playabilityError({ status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm your age' });
    expect(e?.code).toBe('ERR_YOUTUBE_RESTRICTED');
    expect(e?.message).toBe("This video is age-restricted and can't be watched without an account.");
  });

  it('passes playable videos and keeps YouTube’s own reason otherwise', () => {
    expect(playabilityError({ status: 'OK' })).toBeNull();
    const e = playabilityError({ status: 'ERROR', reason: 'Video unavailable' });
    expect(e?.code).toBe('ERR_YOUTUBE');
    expect(e?.message).toBe('Video unavailable');
  });
});

describe('networkError', () => {
  it('says there is no connection when fetch itself fails', () => {
    const e = networkError(new TypeError('Network request failed'));
    expect(e.code).toBe('ERR_YOUTUBE_OFFLINE');
    expect(e.message).toBe('No connection.');
  });

  it('keeps a YouTubeError as it is', () => {
    const original = new YouTubeError('ERR_YOUTUBE_RESTRICTED', 'This video is private.');
    expect(networkError(original)).toBe(original);
  });
});

describe('innertube', () => {
  it('asks the visionOS player on youtubei.googleapis.com with a visitor id fetched once', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('/visitor_id') ? answer({ responseContext: { visitorData: 'VISITOR' } }) : answer({ playabilityStatus: { status: 'OK' } }),
    );
    await innertube('visionos', 'player', { videoId: 'aqz-KE-bpKQ' });
    await innertube('visionos', 'player', { videoId: 'dQw4w9WgXcQ' });

    const calls = fetchMock.mock.calls as [string, RequestInit][];
    expect(calls.filter(([url]) => url.includes('/visitor_id'))).toHaveLength(1);
    const players = calls.filter(([url]) => url.includes('/player'));
    expect(players).toHaveLength(2);
    const [url, init] = players[0];
    expect(url).toMatch(/^https:\/\/youtubei\.googleapis\.com\/youtubei\/v1\/player\?prettyPrint=false&t=[\w-]{12}$/);
    const headers = init.headers as Record<string, string>;
    expect(headers['User-Agent']).toMatch(/^com\.google\.visionos\.youtube\/1\.04 \(RealityDevice17,1; U; CPU visionOS 26_6_0 like Mac OS X; [A-Z]{2}\)$/);
    expect(headers['X-Goog-Api-Format-Version']).toBe('2');
    const body = JSON.parse(init.body as string);
    expect(body.context.client).toMatchObject({ clientName: 'VISIONOS', clientVersion: '1.04', visitorData: 'VISITOR', deviceModel: 'RealityDevice17,1' });
    expect(body).toMatchObject({ videoId: 'aqz-KE-bpKQ', contentCheckOk: true, racyCheckOk: true });
    expect(body.cpn).toMatch(/^[\w-]{16}$/);
  });

  it('asks the WEB client on www.youtube.com', async () => {
    fetchMock.mockResolvedValue(answer({ contents: {} }));
    await innertube('web', 'search', { query: 'veritasium' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://www.youtube.com/youtubei/v1/search?prettyPrint=false');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-YouTube-Client-Name']).toBe('1');
    expect(headers['X-YouTube-Client-Version']).toBe('2.20260805.01.00');
    expect(JSON.parse(init.body as string).context.client).toMatchObject({ clientName: 'WEB', clientVersion: '2.20260805.01.00' });
  });

  it('turns HTTP 429 into a blocked network', async () => {
    fetchMock.mockResolvedValue(answer({}, 429));
    await expect(innertube('web', 'search', { query: 'x' })).rejects.toMatchObject({ code: 'ERR_YOUTUBE_BLOCKED', message: BOT });
  });

  it('turns a failed fetch into no connection', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));
    await expect(innertube('web', 'browse', { browseId: 'UC' })).rejects.toMatchObject({ code: 'ERR_YOUTUBE_OFFLINE' });
  });
});
