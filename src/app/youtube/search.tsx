import { useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ChannelRow, VideoRow } from '@/features/youtube/components/rows';
import { YouTubeHeader } from '@/features/youtube/components/YouTubeHeader';
import { routeForLink } from '@/features/youtube/links';
import { youtube } from '@/features/youtube/native';
import { useSubscriptions } from '@/features/youtube/stores';
import type { Channel, SearchItem, Video } from '@/features/youtube/types';
import { useTheme } from '@/ui/theme';

type Kind = 'channels' | 'videos';

/** Find channels to subscribe to (default), or a specific video. Shorts never show. */
export default function SearchScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<Kind>('channels');
  const [items, setItems] = useState<SearchItem[]>([]);
  const [nextPage, setNextPage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const requestRef = useRef(0);

  const channels = useSubscriptions((s) => s.channels);
  const subscribe = useSubscriptions((s) => s.subscribe);
  const unsubscribe = useSubscriptions((s) => s.unsubscribe);
  const subscribed = new Set(channels.map((c) => c.id));

  const linkRoute = routeForLink(query);

  const run = useCallback(async (text: string, k: Kind) => {
    const q = text.trim();
    if (!q || routeForLink(q)) return;
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const page = await youtube().search(q, k);
      if (request !== requestRef.current) return;
      setItems(page.items);
      setNextPage(page.nextPage);
    } catch (e) {
      if (request === requestRef.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, []);

  const loadMore = async () => {
    if (!nextPage || loading) return;
    const request = requestRef.current;
    setLoading(true);
    try {
      const page = await youtube().more(nextPage);
      if (request !== requestRef.current) return;
      setItems((prev) => [...prev, ...page.items.filter((i) => !prev.some((p) => p.id === i.id))]);
      setNextPage(page.nextPage);
    } catch {
      setNextPage(null);
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  };

  const toggle = (channel: Channel) =>
    subscribed.has(channel.id)
      ? unsubscribe(channel.id)
      : subscribe({ id: channel.id, title: channel.title, thumbnail: channel.thumbnail });

  const openVideo = useCallback(
    (video: Video) => router.push({ pathname: '/youtube/watch/[videoId]', params: { videoId: video.id } }),
    [router],
  );

  return (
    <View style={styles.screen}>
      <YouTubeHeader title="Search" onBack={() => router.back()} />
      <View style={styles.searchBox}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => void run(query, kind)}
          placeholder="Channel name, video, or a YouTube link"
          placeholderTextColor={theme.textMuted}
          returnKeyType="search"
          autoFocus
          autoCorrect={false}
          style={[styles.input, { color: theme.text, backgroundColor: theme.surface }]}
        />
        <View style={styles.tabs}>
          {(['channels', 'videos'] as const).map((k) => (
            <Pressable
              key={k}
              onPress={() => {
                setKind(k);
                if (query.trim()) void run(query, k);
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected: kind === k }}
              style={[styles.tab, { borderColor: kind === k ? theme.text : theme.border }, kind === k && { backgroundColor: theme.text }]}
            >
              <Text style={[styles.tabText, { color: kind === k ? theme.background : theme.text }]}>
                {k === 'channels' ? 'Channels' : 'Videos'}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {linkRoute ? (
        <Pressable
          onPress={() => router.push(linkRoute as never)}
          accessibilityRole="button"
          style={[styles.linkCard, { backgroundColor: theme.surface }]}
        >
          <Text style={[styles.linkText, { color: theme.accent }]}>Open this YouTube link</Text>
        </Pressable>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => `${i.type}:${i.id}`}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) =>
            item.type === 'channel' ? (
              <ChannelRow
                channel={item}
                subscribed={subscribed.has(item.id)}
                onPress={() => router.push({ pathname: '/youtube/channel/[channelId]', params: { channelId: item.id } })}
                onToggleSubscription={() => toggle(item)}
              />
            ) : (
              <VideoRow video={item} onPress={openVideo} />
            )
          }
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.5}
          ListEmptyComponent={
            loading ? null : (
              <Text style={[styles.hint, { color: error ? theme.danger : theme.textMuted }]}>
                {error ?? (searched ? 'Nothing found.' : 'Search for a channel and tap Subscribe. Its new videos appear in your feed.')}
              </Text>
            )
          }
          ListFooterComponent={loading ? <ActivityIndicator style={styles.loading} color={theme.textMuted} /> : null}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  searchBox: { padding: 12, gap: 10 },
  input: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 16 },
  tabs: { flexDirection: 'row', gap: 8 },
  tab: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  tabText: { fontSize: 14, fontWeight: '600' },
  linkCard: { margin: 16, padding: 16, borderRadius: 12, alignItems: 'center' },
  linkText: { fontSize: 16, fontWeight: '600' },
  hint: { padding: 28, textAlign: 'center', fontSize: 15, lineHeight: 21 },
  loading: { margin: 20 },
});
