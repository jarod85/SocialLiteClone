/**
 * Reading GitHub's "latest release" answer. Pure, so it's unit-tested.
 * scripts/publish-release.ps1 publishes each APK as release "v<version>" with
 * the asset LiteSocial-<version>.apk.
 */

export interface AvailableUpdate {
  version: string;
  notes: string;
  apkUrl: string;
  sizeBytes: number | null;
  publishedAt: string | null;
}

/** -1, 0 or 1 comparing "1.10.0" with "1.9.2" numerically; a leading "v" is ignored. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .trim()
      .replace(/^v/i, '')
      .split(/[.+-]/)
      .slice(0, 3)
      .map((n) => Number.parseInt(n, 10) || 0);
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** The update described by a GitHub release, or null if it has no Lite Social APK. */
export function parseRelease(json: unknown): AvailableUpdate | null {
  if (typeof json !== 'object' || json === null) return null;
  const release = json as Record<string, unknown>;
  if (release.draft === true || release.prerelease === true) return null;
  const tag = typeof release.tag_name === 'string' ? release.tag_name : '';
  if (!/^v?\d+\.\d+/.test(tag)) return null;
  const assets = Array.isArray(release.assets) ? (release.assets as Record<string, unknown>[]) : [];
  const apk = assets.find((a) => typeof a.name === 'string' && /^LiteSocial-.*\.apk$/i.test(a.name));
  const url = typeof apk?.browser_download_url === 'string' ? apk.browser_download_url : '';
  if (!url.startsWith('https://github.com/')) return null;
  return {
    version: tag.replace(/^v/i, ''),
    notes: typeof release.body === 'string' ? release.body.trim() : '',
    apkUrl: url,
    sizeBytes: typeof apk?.size === 'number' ? apk.size : null,
    publishedAt: typeof release.published_at === 'string' ? release.published_at : null,
  };
}

/**
 * The fallback when api.github.com refuses (it allows 60 calls an hour per
 * network, shared by every phone behind it): github.com's own "latest release"
 * page, which redirects to /releases/tag/v<version>. Null if `apiUrl` isn't a
 * GitHub "latest release" API address.
 */
export function latestReleasePageUrl(apiUrl: string): string | null {
  const repo = /^https:\/\/api\.github\.com\/repos\/([\w.-]+\/[\w.-]+)\/releases\/latest$/.exec(apiUrl)?.[1];
  return repo ? `https://github.com/${repo}/releases/latest` : null;
}

/** The update behind the page the "latest release" link redirected to, assuming publish-release.ps1's naming. */
export function parseReleasePageUrl(finalUrl: string): AvailableUpdate | null {
  const match = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/releases\/tag\/v?(\d+\.\d+(?:\.\d+)?)$/.exec(finalUrl);
  if (!match) return null;
  const [, repo, version] = match;
  return {
    version,
    notes: '',
    apkUrl: `https://github.com/${repo}/releases/download/v${version}/LiteSocial-${version}.apk`,
    sizeBytes: null,
    publishedAt: null,
  };
}
