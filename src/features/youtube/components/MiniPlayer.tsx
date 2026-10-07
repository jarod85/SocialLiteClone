import Ionicons from '@expo/vector-icons/Ionicons';
import { useEvent } from 'expo';
import { Image } from 'expo-image';
import { usePathname, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/ui/theme';

import { getPlayer, stop, usePlayer } from '../player';

/**
 * Bar at the bottom of the YouTube screens while something is playing and the
 * watch screen isn't open. Playback carries on while you browse.
 */
export function MiniPlayer() {
  const current = usePlayer((s) => s.current);
  const pathname = usePathname();
  if (!current || pathname.startsWith('/youtube/watch/')) return null;
  return <MiniPlayerBar />;
}

function MiniPlayerBar() {
  const theme = useTheme();
  const router = useRouter();
  const current = usePlayer((s) => s.current)!;
  const player = getPlayer();
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/youtube/watch/[videoId]', params: { videoId: current.id } })}
      accessibilityRole="button"
      accessibilityLabel={`Now playing: ${current.title}. Open player`}
      style={[styles.bar, { backgroundColor: theme.surface, borderTopColor: theme.border }]}
    >
      <View style={styles.thumbnail}>
        {current.thumbnail ? <Image source={{ uri: current.thumbnail }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
      </View>
      <View style={styles.text}>
        <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
          {current.title}
        </Text>
        <Text style={[styles.subtitle, { color: theme.textMuted }]} numberOfLines={1}>
          {current.channelName}
        </Text>
      </View>
      <Pressable
        onPress={() => (isPlaying ? player.pause() : player.play())}
        accessibilityRole="button"
        accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
        hitSlop={8}
        style={styles.button}
      >
        <Ionicons name={isPlaying ? 'pause' : 'play'} size={26} color={theme.text} />
      </Pressable>
      <Pressable onPress={stop} accessibilityRole="button" accessibilityLabel="Stop and close player" hitSlop={8} style={styles.button}>
        <Ionicons name="close" size={24} color={theme.text} />
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  thumbnail: { width: 80, height: 45, borderRadius: 6, overflow: 'hidden', backgroundColor: '#000' },
  text: { flex: 1, gap: 2 },
  title: { fontSize: 14, fontWeight: '600' },
  subtitle: { fontSize: 12 },
  button: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
