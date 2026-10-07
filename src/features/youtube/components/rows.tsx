import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/ui/theme';

import { formatCount, formatDuration, videoSubtitle } from '../format';
import type { Channel, Video } from '../types';

export const VideoRow = memo(function VideoRow({ video, onPress }: { video: Video; onPress: (video: Video) => void }) {
  const theme = useTheme();
  const duration = video.isLive ? 'LIVE' : formatDuration(video.durationSeconds);
  return (
    <Pressable
      onPress={() => onPress(video)}
      accessibilityRole="button"
      accessibilityLabel={video.title}
      style={({ pressed }) => [styles.video, pressed && { opacity: 0.7 }]}
    >
      <View style={[styles.thumbnail, { backgroundColor: theme.surface }]}>
        {video.thumbnail ? (
          <Image source={{ uri: video.thumbnail }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={video.id} transition={120} />
        ) : null}
        {duration ? (
          <View style={[styles.badge, video.isLive && { backgroundColor: '#CC0000' }]}>
            <Text style={styles.badgeText}>{duration}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.videoText}>
        <Text style={[styles.title, { color: theme.text }]} numberOfLines={2}>
          {video.title}
        </Text>
        <Text style={[styles.subtitle, { color: theme.textMuted }]} numberOfLines={1}>
          {videoSubtitle(video)}
        </Text>
      </View>
    </Pressable>
  );
});

export function ChannelRow({
  channel,
  subscribed,
  onPress,
  onToggleSubscription,
}: {
  channel: Pick<Channel, 'id' | 'title' | 'thumbnail' | 'subscriberCount'>;
  subscribed: boolean;
  onPress: () => void;
  onToggleSubscription: () => void;
}) {
  const theme = useTheme();
  const subs = formatCount(channel.subscriberCount);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={channel.title}
      style={({ pressed }) => [styles.channel, pressed && { opacity: 0.7 }]}
    >
      <Avatar uri={channel.thumbnail} size={48} />
      <View style={styles.channelText}>
        <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
          {channel.title}
        </Text>
        {subs ? <Text style={[styles.subtitle, { color: theme.textMuted }]}>{subs} subscribers</Text> : null}
      </View>
      <SubscribeButton subscribed={subscribed} onPress={onToggleSubscription} />
    </Pressable>
  );
}

export function SubscribeButton({ subscribed, onPress }: { subscribed: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={subscribed ? 'Unsubscribe' : 'Subscribe'}
      hitSlop={6}
      style={({ pressed }) => [
        styles.subscribe,
        subscribed ? { borderColor: theme.border } : { backgroundColor: theme.text, borderColor: theme.text },
        pressed && { opacity: 0.6 },
      ]}
    >
      <Text style={[styles.subscribeText, { color: subscribed ? theme.textMuted : theme.background }]}>
        {subscribed ? 'Subscribed' : 'Subscribe'}
      </Text>
    </Pressable>
  );
}

export function Avatar({ uri, size }: { uri?: string | null; size: number }) {
  const theme = useTheme();
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', backgroundColor: theme.surface }}>
      {uri ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : (
        <Ionicons name="person" size={size * 0.55} color={theme.textMuted} style={{ alignSelf: 'center', marginTop: size * 0.2 }} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  video: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  thumbnail: { width: '100%', aspectRatio: 16 / 9, borderRadius: 10, overflow: 'hidden' },
  badge: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(0,0,0,0.8)',
  },
  badgeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  videoText: { gap: 3 },
  title: { fontSize: 15, fontWeight: '600', lineHeight: 20 },
  subtitle: { fontSize: 13 },
  channel: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  channelText: { flex: 1, gap: 2 },
  subscribe: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, borderWidth: 1 },
  subscribeText: { fontSize: 13, fontWeight: '600' },
});
