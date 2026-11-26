import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { youtubeFeatures } from '../native';
import { captionFailed, getPlayer, usePlayer } from '../player';
import type { VideoDetails } from '../types';
import { type Cue, cueAt, parseVtt } from '../vtt';

/** How often the shown caption follows the video. The player's own time events come once a second. */
const TICK_MS = 250;

/** Fetched caption files, by address, for the app run (switching back and forth costs nothing). */
const cache = new Map<string, Promise<Cue[]>>();

function load(url: string): Promise<Cue[]> {
  let cues = cache.get(url);
  if (!cues) {
    cues = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then(parseVtt);
    cues.catch(() => cache.delete(url));
    cache.set(url, cues);
  }
  return cues;
}

/**
 * Captions drawn over the video where the player can't show them (iOS, whose HLS
 * stream has none): the picked track as WebVTT, the cue for the player's time.
 */
export function CaptionOverlay({ details, fullscreen }: { details: VideoDetails; fullscreen: boolean }) {
  const captionId = usePlayer((s) => s.caption);
  const track = youtubeFeatures.captions === 'overlay' ? details.captions.find((c) => c.id === captionId) : undefined;
  const url = track?.url;
  const [loaded, setLoaded] = useState<{ url: string; cues: Cue[] } | null>(null);
  const cues = url && loaded?.url === url ? loaded.cues : null;
  const [shown, setShown] = useState<{ cues: Cue[]; text: string | null } | null>(null);
  const text = cues && shown?.cues === cues ? shown.text : null;

  useEffect(() => {
    if (!url) return;
    let active = true;
    load(url).then(
      (c) => active && setLoaded({ url, cues: c }),
      () => active && captionFailed("Captions couldn't be loaded."),
    );
    return () => {
      active = false;
    };
  }, [url]);

  useEffect(() => {
    if (!cues) return;
    const timer = setInterval(() => setShown({ cues, text: cueAt(cues, getPlayer().currentTime)?.text ?? null }), TICK_MS);
    return () => clearInterval(timer);
  }, [cues]);

  if (!text) return null;
  return (
    <View style={[styles.box, fullscreen && styles.boxFullscreen]} pointerEvents="none">
      <Text style={styles.text} accessibilityLiveRegion="polite">
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { position: 'absolute', left: 12, right: 12, bottom: 12, alignItems: 'center' },
  boxFullscreen: { bottom: 28 },
  text: {
    color: '#FFFFFF',
    backgroundColor: 'rgba(0,0,0,0.6)',
    fontSize: 16,
    lineHeight: 21,
    textAlign: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    overflow: 'hidden',
  },
});
