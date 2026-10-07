import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';

import { Avatar, SubscribeButton, VideoRow } from '@/features/youtube/components/rows';
import { YouTubeHeader } from '@/features/youtube/components/YouTubeHeader';
import { formatCount } from '@/features/youtube/format';
import { videoPage, youtube } from '@/features/youtube/native';
import { useSubscriptions } from '@/features/youtube/stores';
import type { ChannelPage, Video } from '@/features/youtube/types';
import { Button } from '@/ui/components';
import { useTheme } from '@/ui/theme';

/** A channel's long-form uploads (its Videos tab: no Shorts) and a Subscribe button. */
export default function ChannelScreen() {
  const theme = useTheme();
  const router = useRouter();
  // A "UC…" id, or a channel URL for @handle links.
  const { channelId } = useLocalSearchParams<{ channelId: string }>();
  const [channel, setChannel] = useState<ChannelPage | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [nextPage, setNextPage] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSubscribed = useSubscriptions((s) => (channel ? s.channels.some((c) => c.id === channel.id) : false));
  const subscribe = useSubscriptions((s) => s.subscribe);
  const unsubscribe = useSubscriptions((s) => s.unsubscribe);

  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    youtube()
      .channel(decodeURIComponent(channelId))
      .then((page) => {
        if (!active) return;
        setChannel(page);
        setVideos(page.videos);
        setNextPage(page.nextPage);
      })
      .catch((e) => active && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      active = false;
    };
  }, [channelId, attempt]);

  const retry = () => {
    setError(null);
    setAttempt((n) => n + 1);
  };

  const loadMore = async () => {
    if (!nextPage || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await youtube().more(nextPage);
      const more = videoPage(page.items).map((v) => ({ ...v, channelId: channel?.id, channelName: channel?.title }));
      setVideos((prev) => [...prev, ...more.filter((v) => !prev.some((p) => p.id === v.id))]);
      setNextPage(page.nextPage);
    } catch {
      setNextPage(null);
    } finally {
      setLoadingMore(false);
    }
  };

  const openVideo = useCallback(
    (video: Video) => router.push({ pathname: '/youtube/watch/[videoId]', params: { videoId: video.id } }),
    [router],
  );

  const toggle = () => {
    if (!channel) return;
    if (isSubscribed) unsubscribe(channel.id);
    else subscribe({ id: channel.id, title: channel.title, thumbnail: channel.avatar });
  };

  return (
    <View style={styles.screen}>
      <YouTubeHeader title={channel?.title ?? 'Channel'} onBack={() => router.back()} />
      {error ? (
        <View style={styles.centered}>
          <Text style={[styles.error, { color: theme.textMuted }]}>{error}</Text>
          <Button label="Try again" onPress={retry} />
        </View>
      ) : !channel ? (
        <ActivityIndicator style={styles.loading} color={theme.textMuted} />
      ) : (
        <FlatList
          data={videos}
          keyExtractor={(v) => v.id}
          renderItem={({ item }) => <VideoRow video={item} onPress={openVideo} />}
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.6}
          ListHeaderComponent={
            <View style={[styles.header, { borderBottomColor: theme.border }]}>
              <Avatar uri={channel.avatar} size={64} />
              <View style={styles.headerText}>
                <Text style={[styles.title, { color: theme.text }]} numberOfLines={2}>
                  {channel.title}
                </Text>
                {channel.subscriberCount != null ? (
                  <Text style={[styles.subs, { color: theme.textMuted }]}>{formatCount(channel.subscriberCount)} subscribers</Text>
                ) : null}
              </View>
              <SubscribeButton subscribed={isSubscribed} onPress={toggle} />
            </View>
          }
          ListEmptyComponent={<Text style={[styles.error, { color: theme.textMuted }]}>This channel has no videos.</Text>}
          ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.loading} color={theme.textMuted} /> : null}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  loading: { margin: 32 },
  error: { fontSize: 15, textAlign: 'center', padding: 24 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  headerText: { flex: 1, gap: 3 },
  title: { fontSize: 19, fontWeight: '700' },
  subs: { fontSize: 13 },
});
