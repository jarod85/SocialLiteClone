/** Display helpers for YouTube lists. Pure, so they're unit-tested. */

/** 75 → "1:15", 3725 → "1:02:05". */
export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return '';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
}

/** 1_234 → "1.2K", 21_300_000 → "21M". */
export function formatCount(n: number | null | undefined): string {
  if (n == null || n < 0) return '';
  if (n < 1000) return String(n);
  const units: [number, string][] = [
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];
  for (const [size, unit] of units) {
    if (n >= size) {
      const value = n / size;
      return `${value < 10 ? Math.floor(value * 10) / 10 : Math.floor(value)}${unit}`;
    }
  }
  return String(n);
}

/** "just now", "5 minutes ago", "3 days ago", "2 years ago". */
export function formatAge(timestamp: number | null | undefined, now = Date.now()): string {
  if (!timestamp) return '';
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  const steps: [number, string][] = [
    [365 * 86400, 'year'],
    [30 * 86400, 'month'],
    [7 * 86400, 'week'],
    [86400, 'day'],
    [3600, 'hour'],
    [60, 'minute'],
  ];
  for (const [size, unit] of steps) {
    if (seconds >= size) {
      const n = Math.floor(seconds / size);
      return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
    }
  }
  return 'just now';
}

/** "Veritasium · 3 days ago · 1.2M views", skipping missing parts. */
export function videoSubtitle(parts: { channelName?: string | null; uploadedAt?: number | null; uploadedText?: string | null; viewCount?: number | null }, now = Date.now()): string {
  const views = parts.viewCount != null && parts.viewCount >= 0 ? `${formatCount(parts.viewCount)} views` : '';
  return [parts.channelName ?? '', formatAge(parts.uploadedAt, now) || parts.uploadedText || '', views].filter(Boolean).join(' · ');
}
