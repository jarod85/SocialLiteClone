import { compareVersions, latestReleasePageUrl, parseRelease, parseReleasePageUrl } from '@/features/updates/releases';

describe('compareVersions', () => {
  it.each([
    ['1.4.0', '1.3.0', 1],
    ['1.10.0', '1.9.2', 1],
    ['v1.4.0', '1.4.0', 0],
    ['1.4', '1.4.0', 0],
    ['1.3.9', '1.4.0', -1],
    ['2.0.0', '10.0.0', -1],
  ])('%s vs %s', (a, b, expected) => {
    expect(compareVersions(a, b)).toBe(expected);
  });
});

describe('parseRelease', () => {
  const release = {
    tag_name: 'v1.4.0',
    draft: false,
    prerelease: false,
    body: 'In-app updates\n- more',
    published_at: '2026-10-07T20:00:00Z',
    assets: [
      { name: 'notes.txt', browser_download_url: 'https://github.com/jarod85/SocialLiteClone/releases/download/v1.4.0/notes.txt', size: 1 },
      {
        name: 'LiteSocial-1.4.0.apk',
        browser_download_url: 'https://github.com/jarod85/SocialLiteClone/releases/download/v1.4.0/LiteSocial-1.4.0.apk',
        size: 82_000_000,
      },
    ],
  };

  it('finds the APK', () => {
    expect(parseRelease(release)).toEqual({
      version: '1.4.0',
      notes: 'In-app updates\n- more',
      apkUrl: 'https://github.com/jarod85/SocialLiteClone/releases/download/v1.4.0/LiteSocial-1.4.0.apk',
      sizeBytes: 82_000_000,
      publishedAt: '2026-10-07T20:00:00Z',
    });
  });

  it('skips drafts, prereleases, releases without an APK and downloads from elsewhere', () => {
    expect(parseRelease({ ...release, draft: true })).toBeNull();
    expect(parseRelease({ ...release, prerelease: true })).toBeNull();
    expect(parseRelease({ ...release, assets: [release.assets[0]] })).toBeNull();
    expect(
      parseRelease({ ...release, assets: [{ name: 'LiteSocial-1.4.0.apk', browser_download_url: 'https://evil.example/x.apk' }] }),
    ).toBeNull();
    expect(parseRelease({ ...release, tag_name: 'latest' })).toBeNull();
    expect(parseRelease(null)).toBeNull();
  });
});

describe('release page fallback', () => {
  it('derives the page from the API address', () => {
    expect(latestReleasePageUrl('https://api.github.com/repos/jarod85/SocialLiteClone/releases/latest')).toBe(
      'https://github.com/jarod85/SocialLiteClone/releases/latest',
    );
    expect(latestReleasePageUrl('https://example.com/releases/latest')).toBeNull();
  });

  it('reads the version from the redirect target', () => {
    expect(parseReleasePageUrl('https://github.com/jarod85/SocialLiteClone/releases/tag/v1.5.1')).toEqual({
      version: '1.5.1',
      notes: '',
      apkUrl: 'https://github.com/jarod85/SocialLiteClone/releases/download/v1.5.1/LiteSocial-1.5.1.apk',
      sizeBytes: null,
      publishedAt: null,
    });
  });

  it('ignores anything that is not a release tag page', () => {
    expect(parseReleasePageUrl('https://github.com/jarod85/SocialLiteClone/releases')).toBeNull();
    expect(parseReleasePageUrl('https://github.com/login')).toBeNull();
    expect(parseReleasePageUrl('https://evil.example/jarod85/SocialLiteClone/releases/tag/v9.0.0')).toBeNull();
  });
});
