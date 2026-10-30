import { useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { Alert, SectionList, StyleSheet, Text, View } from 'react-native';

import { VideoRow } from '@/features/youtube/components/rows';
import { YouTubeHeader } from '@/features/youtube/components/YouTubeHeader';
import { formatAge, formatDuration } from '@/features/youtube/format';
import { historyGroup, historyVideo, newestFirst, resumePosition, useHistory } from '@/features/youtube/history';
import type { Video } from '@/features/youtube/types';
import { useTheme } from '@/ui/theme';

/** Videos you've watched in Lite Social, newest first. Stored on this phone only. */
export default function HistoryScreen() {
  const theme = useTheme();
  const router = useRouter();
  const entries = useHistory((s) => s.entries);
  const remove = useHistory((s) => s.remove);
  const clear = useHistory((s) => s.clear);

  const sections = useMemo(() => {
    const groups = new Map<string, ReturnType<typeof newestFirst>>();
    for (const entry of newestFirst(Object.values(entries))) {
      const title = historyGroup(entry.watchedAt);
      groups.set(title, [...(groups.get(title) ?? []), entry]);
    }
    return Array.from(groups, ([title, data]) => ({ title, data }));
  }, [entries]);

  const open = useCallback(
    (video: Video) => router.push({ pathname: '/youtube/watch/[videoId]', params: { videoId: video.id } }),
    [router],
  );

  const confirmRemove = useCallback(
    (video: Video) =>
      Alert.alert('Remove from history?', video.title, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => remove(video.id) },
      ]),
    [remove],
  );

  const confirmClear = () =>
    Alert.alert('Clear watch history?', 'Every video is removed from the list, and videos start from the beginning again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: clear },
    ]);

  const count = Object.keys(entries).length;

  return (
    <View style={styles.screen}>
      <YouTubeHeader
        title="History"
        onBack={() => router.back()}
        actions={count > 0 ? [{ icon: 'trash-outline', label: 'Clear watch history', onPress: confirmClear }] : []}
      />
      <SectionList
        sections={sections}
        keyExtractor={(entry) => entry.id}
        renderItem={({ item }) => {
          const resume = resumePosition(item);
          const detail = [item.channelName, resume > 0 ? `stopped at ${formatDuration(resume)}` : '', `watched ${formatAge(item.watchedAt)}`]
            .filter(Boolean)
            .join(' · ');
          return <VideoRow video={historyVideo(item)} onPress={open} onLongPress={confirmRemove} subtitle={detail} />;
        }}
        renderSectionHeader={({ section }) => (
          <Text style={[styles.section, { color: theme.text, backgroundColor: theme.background }]}>{section.title}</Text>
        )}
        ListHeaderComponent={
          count > 0 ? (
            <Text style={[styles.note, { color: theme.textMuted }]}>
              Kept on this phone only. Videos continue where you stopped. Press and hold a video to remove it.
            </Text>
          ) : null
        }
        ListEmptyComponent={
          <Text style={[styles.empty, { color: theme.textMuted }]}>No history yet. Videos you watch show up here.</Text>
        }
        stickySectionHeadersEnabled
        initialNumToRender={6}
        windowSize={7}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  note: { fontSize: 12, paddingHorizontal: 16, paddingTop: 10 },
  section: { fontSize: 16, fontWeight: '700', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 },
  empty: { textAlign: 'center', padding: 28, fontSize: 15 },
});
