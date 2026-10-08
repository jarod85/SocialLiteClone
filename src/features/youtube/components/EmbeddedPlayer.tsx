import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';

import { useDailyLimit } from '@/features/timeLimit/useDailyLimit';

/**
 * YouTube embeds need a referring page; for apps YouTube asks for the app's
 * package name as an https origin.
 */
const ORIGIN = 'https://com.jarod85.litesocial';

export const isEmbeddableId = (id: string) => /^[\w-]{11}$/.test(id);

function page(videoId: string): string {
  const src = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&playsinline=1&rel=0`;
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}iframe{border:0;width:100%;height:100%}</style>
</head><body><iframe src="${src}" allow="autoplay; encrypted-media; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></body></html>`;
}

/** Only the page above may load at the top; links out of the player ("Watch on YouTube") go nowhere. */
function onShouldStartLoadWithRequest(request: ShouldStartLoadRequest): boolean {
  return request.url === 'about:blank' || request.url.startsWith(ORIGIN);
}

/**
 * YouTube's own embedded player, for when YouTube refuses Lite Social's player
 * on this network: a real browser engine passes checks the extractor can't.
 * It can show ads, and it stops with the daily limit's break screen.
 */
export function EmbeddedPlayer({ videoId }: { videoId: string }) {
  const { locked } = useDailyLimit();
  const source = useMemo(() => ({ html: page(videoId), baseUrl: ORIGIN }), [videoId]);
  if (locked || !isEmbeddableId(videoId)) return null;
  return (
    <WebView
      source={source}
      style={styles.web}
      onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
      setSupportMultipleWindows={false}
      allowsFullscreenVideo
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
    />
  );
}

const styles = StyleSheet.create({
  web: { flex: 1, backgroundColor: '#000' },
});
