/**
 * Minimal URL helpers that behave the same in the app (Hermes) and in the page.
 * We avoid the global URL class on purpose: React Native's implementation has
 * historically been incomplete, and the matcher must agree exactly on both sides.
 */

export interface ParsedUrl {
  /** Lower-case, without the colon. */
  scheme: string;
  /** Lower-case, without credentials or port. Empty for schemes like about: or mailto:. */
  host: string;
  /** Raw path, '/' if empty. */
  path: string;
  /** Raw query without '?'. */
  query: string;
}

const URL_PATTERN = /^([a-z][a-z0-9+.-]*):(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?/i;

export function parseUrl(url: string): ParsedUrl | null {
  const match = URL_PATTERN.exec(url.trim());
  if (!match) return null;
  const host = (match[2] ?? '')
    .toLowerCase()
    .replace(/^[^@]*@/, '') // credentials
    .replace(/:\d+$/, ''); // port
  return {
    scheme: match[1].toLowerCase(),
    host,
    path: match[3] || '/',
    query: match[4] ?? '',
  };
}

/**
 * Canonical path for matching: no empty segments, no trailing slash, and the
 * root path becomes '' so that '/**' can match it. '/reels/' -> '/reels'.
 */
export function normalizePath(path: string): string {
  const segments = path.split('/').filter(Boolean);
  return segments.length === 0 ? '' : `/${segments.join('/')}`;
}

export function parseQuery(query: string): Map<string, string> {
  const params = new Map<string, string>();
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const key = decode(eq === -1 ? pair : pair.slice(0, eq));
    const value = eq === -1 ? '' : decode(pair.slice(eq + 1));
    if (!params.has(key)) params.set(key, value);
  }
  return params;
}

function decode(component: string): string {
  try {
    return decodeURIComponent(component.replace(/\+/g, ' '));
  } catch {
    return component;
  }
}

/** Host globs: 'instagram.com' matches exactly, '*.instagram.com' matches any subdomain. */
export function hostMatches(host: string, patterns: readonly string[]): boolean {
  const h = host.toLowerCase();
  return patterns.some((pattern) => {
    const p = pattern.toLowerCase();
    if (p.startsWith('*.')) return h.endsWith(p.slice(1)) && h.length > p.length - 1;
    return h === p;
  });
}

/** scheme://host of an absolute http(s) URL, e.g. 'https://www.instagram.com'. */
export function originOf(url: string): string {
  const parsed = parseUrl(url);
  return parsed ? `${parsed.scheme}://${parsed.host}` : '';
}

/** Drops query and fragment, which can carry tokens. Used before storing a URL anywhere. */
export function stripQueryAndHash(url: string): string {
  return url.replace(/[?#].*$/, '');
}
