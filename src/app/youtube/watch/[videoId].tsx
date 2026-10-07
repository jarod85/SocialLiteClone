import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar, SubscribeButton } from '@/features/youtube/components/rows';
import { useDownloadFlow } from '@/features/youtube/components/useDownloadFlow';
import { YouTubeHeader } from '@/features/youtube/components/YouTubeHeader';
import { formatAge, formatCount } from '@/features/youtube/format';
import { watchUrl, youtube } from '@/features/youtube/native';
import { getPlayer, play, usePlayer } from '@/features/youtube/player';
import { useSubscriptions } from '@/features/youtube/stores';
import type { VideoDetails } from '@/features/youtube/types';
import { Button } from '@/ui/components';
import { useTheme } from '@/ui/theme';

/**
 * The player: the video, its title, channel and description, and Download.
 * No related videos, no comments, no autoplay of anything else, no ads.
 */
export default function WatchScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { videoId, short } = useLocalSearchParams<{ videoId: string; short?: string }>();
  const current = usePlayer((s) => s.current);
  const playerError = usePlayer((s) => s.error);
  // What was fetched for which video id, so a new id never shows the previous video's details.
  const [loaded, setLoaded] = useState<{ id: string; details?: VideoDetails; error?: string } | null>(null);
  const details = current?.id === videoId ? current : loaded?.id === videoId ? (loaded.details ?? null) : null;
  const error = loaded?.id === videoId ? (loaded.error ?? null) : null;
  const [expanded, setExpanded] = useState(false);
  const { start: download, picker } = useDownloadFlow();

  const isShortLink = short === '1';
  const isSubscribed = useSubscriptions((s) => (details?.channelId ? s.channels.some((c) => c.id === details.channelId) : false));
  const subscribe = useSubscriptions((s) => s.subscribe);
  const unsubscribe = useSubscriptions((s) => s.unsubscribe);

  useEffect(() => {
    if (isShortLink || usePlayer.getState().current?.id === videoId) return;
    let active = true;
    youtube()
      .video(watchUrl(videoId))
      .then((d) => {
        if (!active) return;
        setLoaded({ id: videoId, details: d });
        if (!d.isShort) void play(d);
      })
      .catch((e) => active && setLoaded({ id: videoId, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      active = false;
    };
  }, [videoId, isShortLink]);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/youtube'));

  if (isShortLink || details?.isShort) {
    return (
      <View style={styles.screen}>
        <YouTubeHeader title="Short" onBack={back} />
        <View style={styles.centered}>
          <Ionicons name="eye-off-outline" size={44} color={theme.textMuted} />
          <Text style={[styles.message, { color: theme.text }]}>Shorts are hidden by Lite Social.</Text>
          <Button label="Back" onPress={back} />
        </View>
      </View>
    );
  }

  const toggleSubscription = () => {
    if (!details?.channelId) return;
    if (isSubscribed) unsubscribe(details.channelId);
    else subscribe({ id: details.channelId, title: details.channelName ?? 'Channel', thumbnail: details.channelAvatar });
  };

  const stats = details
    ? [
        details.viewCount != null ? `${formatCount(details.viewCount)} views` : '',
        formatAge(details.uploadedAt),
        details.likeCount != null && details.likeCount > 0 ? `${formatCount(details.likeCount)} likes` : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  return (
    <View style={styles.screen}>
      <YouTubeHeader title="" onBack={back} backIcon="chevron-down" />
      <View style={styles.video}>
        {details && current?.id === details.id ? (
          <VideoView player={getPlayer()} style={StyleSheet.absoluteFill} nativeControls contentFit="contain" />
        ) : error ? null : (
          <ActivityIndicator style={styles.videoLoading} color="#FFFFFF" />
        )}
      </View>

      {error ? (
        <View style={styles.centered}>
          <Text style={[styles.message, { color: theme.text }]}>{error}</Text>
          <Button label="Back" onPress={back} />
        </View>
      ) : details ? (
        <ScrollView contentContainerStyle={styles.info}>
          <Text style={[styles.title, { color: theme.text }]}>{details.title}</Text>
          {stats ? <Text style={[styles.stats, { color: theme.textMuted }]}>{stats}</Text> : null}
          {playerError && current?.id === details.id ? (
            <Text style={[styles.stats, { color: theme.danger }]}>{playerError}</Text>
          ) : null}

          <View style={styles.channel}>
            <Pressable
              onPress={() =>
                details.channelId && router.push({ pathname: '/youtube/channel/[channelId]', params: { channelId: details.channelId } })
              }
              accessibilityRole="button"
              style={styles.channelLink}
            >
              <Avatar uri={details.channelAvatar} size={40} />
              <Text style={[styles.channelName, { color: theme.text }]} numberOfLines={1}>
                {details.channelName}
              </Text>
            </Pressable>
            {details.channelId ? <SubscribeButton subscribed={isSubscribed} onPress={toggleSubscription} /> : null}
          </View>

          <Button label="Download (MP4 or MP3)" variant="secondary" onPress={() => download({ url: details.url, title: details.title })} />

          {details.description ? (
            <Pressable onPress={() => setExpanded((e) => !e)} style={[styles.description, { backgroundColor: theme.surface }]}>
              <Text style={[styles.descriptionText, { color: theme.text }]} numberOfLines={expanded ? undefined : 4}>
                {details.description}
              </Text>
              <Text style={[styles.more, { color: theme.textMuted }]}>{expanded ? 'Show less' : 'Show more'}</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      ) : null}
      {picker}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  video: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' },
  videoLoading: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  message: { fontSize: 16, textAlign: 'center', lineHeight: 22 },
  info: { padding: 16, gap: 12, paddingBottom: 40 },
  title: { fontSize: 18, fontWeight: '700', lineHeight: 24 },
  stats: { fontSize: 13 },
  channel: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  channelLink: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  channelName: { flex: 1, fontSize: 15, fontWeight: '600' },
  description: { padding: 12, borderRadius: 10, gap: 6 },
  descriptionText: { fontSize: 14, lineHeight: 20 },
  more: { fontSize: 13, fontWeight: '600' },
});
