import { useRouter } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { VideoRow } from '@/features/youtube/components/rows';
import { YouTubeHeader } from '@/features/youtube/components/YouTubeHeader';
import { useDownloads } from '@/features/youtube/downloads';
import { formatAge } from '@/features/youtube/format';
import { FEED_MAX_AGE_MS, subscriptionsKey, useFeed, useSubscriptions } from '@/features/youtube/stores';
import type { Video } from '@/features/youtube/types';
import { Button } from '@/ui/components';
import { useTheme } from '@/ui/theme';

/** The YouTube home: newest videos from your subscriptions, and nothing else. */
export default function SubscriptionsFeedScreen() {
  const theme = useTheme();
  const router = useRouter();
  const channels = useSubscriptions((s) => s.channels);
  const items = useFeed((s) => s.items);
  const updatedAt = useFeed((s) => s.updatedAt);
  const refreshing = useFeed((s) => s.refreshing);
  const failed = useFeed((s) => s.failed);
  const error = useFeed((s) => s.error);
  const refresh = useFeed((s) => s.refresh);
  const activeDownloads = useDownloads((s) => Object.values(s.byId).filter((d) => !['done', 'failed', 'cancelled'].includes(d.state)).length);

  const channelCount = channels.length;
  const key = subscriptionsKey(channels);
  const loadedKey = useFeed((s) => s.channelsKey);
  useEffect(() => {
    // Refresh on open when stale, and whenever subscriptions changed since the last load.
    const stale = !updatedAt || Date.now() - updatedAt > FEED_MAX_AGE_MS;
    if (channelCount > 0 && (stale || key !== loadedKey)) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const open = useCallback(
    (video: Video) => router.push({ pathname: '/youtube/watch/[videoId]', params: { videoId: video.id } }),
    [router],
  );

  const status = [
    updatedAt ? `Updated ${formatAge(updatedAt)}` : '',
    `${channelCount} channel${channelCount === 1 ? '' : 's'}`,
    failed.length > 0 ? `${failed.length} couldn't load` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={styles.screen}>
      <YouTubeHeader
        title="Subscriptions"
        backIcon="close"
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        actions={[
          { icon: 'search', label: 'Search', onPress: () => router.push('/youtube/search') },
          { icon: 'people-outline', label: 'Your channels', onPress: () => router.push('/youtube/subscriptions') },
          { icon: 'download-outline', label: 'Downloads', onPress: () => router.push('/youtube/downloads'), badge: activeDownloads },
        ]}
      />
      {channelCount === 0 ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyTitle, { color: theme.text }]}>No subscriptions yet</Text>
          <Text style={[styles.emptyBody, { color: theme.textMuted }]}>
            This feed only shows new videos from channels you subscribe to here. Lite Social doesn&apos;t use a Google
            account, so add them by searching, or import the list from Google Takeout.
          </Text>
          <Button label="Find channels" onPress={() => router.push('/youtube/search')} />
          <Button label="Import subscriptions" variant="secondary" onPress={() => router.push('/youtube/subscriptions')} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(v) => v.id}
          renderItem={({ item }) => <VideoRow video={item} onPress={open} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
          ListHeaderComponent={
            <Text style={[styles.status, { color: error ? theme.danger : theme.textMuted }]}>
              {error ? `Couldn't refresh: ${error}` : refreshing && items.length === 0 ? 'Loading your subscriptions…' : status}
            </Text>
          }
          ListEmptyComponent={
            refreshing ? null : (
              <Text style={[styles.emptyBody, styles.padded, { color: theme.textMuted }]}>No videos yet. Pull down to refresh.</Text>
            )
          }
          ListFooterComponent={
            items.length > 0 ? (
              <Text style={[styles.end, { color: theme.textMuted }]}>That&apos;s everything new from your channels.</Text>
            ) : null
          }
          initialNumToRender={6}
          windowSize={7}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  status: { fontSize: 12, paddingHorizontal: 16, paddingTop: 10 },
  empty: { flex: 1, justifyContent: 'center', padding: 28, gap: 14 },
  emptyTitle: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  emptyBody: { fontSize: 15, lineHeight: 21, textAlign: 'center' },
  padded: { padding: 28 },
  end: { textAlign: 'center', fontSize: 13, paddingVertical: 28 },
});
