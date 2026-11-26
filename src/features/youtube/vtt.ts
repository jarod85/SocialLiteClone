/** Captions as WebVTT cues, for drawing them over the video where the player can't (iOS, HLS). */
export interface Cue {
  /** Seconds. */
  start: number;
  end: number;
  text: string;
}

function seconds(time: string): number {
  const parts = time.split(':').map(Number);
  return parts.reduce((total, part) => total * 60 + part, 0);
}

export function parseVtt(text: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of text.replace(/\r/g, '').split(/\n{2,}/)) {
    const lines = block.split('\n');
    const at = lines.findIndex((l) => l.includes('-->'));
    if (at === -1) continue;
    const [from, to] = lines[at].split('-->').map((s) => s.trim().split(/\s+/)[0]);
    const body = lines
      .slice(at + 1)
      .join('\n')
      .replace(/<[^>]*>/g, '')
      .trim();
    if (body) cues.push({ start: seconds(from), end: seconds(to), text: body });
  }
  return cues.sort((a, b) => a.start - b.start);
}

/** The cue showing at `time` (seconds), or null. Cues are sorted by start. */
export function cueAt(cues: readonly Cue[], time: number): Cue | null {
  let lo = 0;
  let hi = cues.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= time) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  // The latest cue started is the one showing, if it hasn't ended (YouTube's cues can overlap a little).
  for (let i = found; i >= 0 && i >= found - 2; i--) if (cues[i].end > time) return cues[i];
  return null;
}
