import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { chooseMusicFolder } from '@/features/youtube/components/useDownloadFlow';
import { YouTubeHeader } from '@/features/youtube/components/YouTubeHeader';
import { cancelDownload, clearFinished, isFinished, useDownloads } from '@/features/youtube/downloads';
import { useYouTubeSettings } from '@/features/youtube/stores';
import type { DownloadUpdate } from '@/features/youtube/types';
import { Button } from '@/ui/components';
import { useTheme } from '@/ui/theme';

const STATE_LABEL: Record<DownloadUpdate['state'], string> = {
  queued: 'Waiting',
  downloading: 'Downloading',
  converting: 'Converting',
  saving: 'Saving',
  done: 'Saved',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

/** Downloads of this session. They keep running in the background with a notification. */
export default function DownloadsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const byId = useDownloads((s) => s.byId);
  const musicFolder = useYouTubeSettings((s) => s.musicFolder);
  const downloads = Object.values(byId).reverse();

  return (
    <View style={styles.screen}>
      <YouTubeHeader
        title="Downloads"
        onBack={() => router.back()}
        actions={downloads.some(isFinished) ? [{ icon: 'trash-outline', label: 'Clear finished', onPress: clearFinished }] : []}
      />
      <FlatList
        data={downloads}
        keyExtractor={(d) => d.id}
        renderItem={({ item }) => <DownloadRow download={item} />}
        ListHeaderComponent={
          <View style={[styles.folderBox, { backgroundColor: theme.surface }]}>
            <Text style={[styles.folderText, { color: theme.textMuted }]}>
              Videos (MP4) go to Movies/Lite Social. Songs (MP3) go to your Musicolet folder
              {musicFolder ? `: ${musicFolder.name}` : ' (asked on your first MP3)'}. You choose the subfolder each time.
            </Text>
            <Button label={musicFolder ? 'Change music folder' : 'Choose music folder'} variant="secondary" onPress={() => void chooseMusicFolder()} />
          </View>
        }
        ListEmptyComponent={
          <Text style={[styles.empty, { color: theme.textMuted }]}>Nothing downloaded yet. Open a video and tap Download.</Text>
        }
      />
    </View>
  );
}

function DownloadRow({ download }: { download: DownloadUpdate }) {
  const theme = useTheme();
  const active = !isFinished(download);
  const color = download.state === 'failed' ? theme.danger : theme.textMuted;
  const detail =
    download.state === 'done'
      ? download.savedTo
      : download.state === 'failed'
        ? download.error
        : `${STATE_LABEL[download.state]}${active && download.progress > 0 ? ` · ${Math.round(download.progress * 100)}%` : ''}`;
  return (
    <View style={[styles.row, { borderBottomColor: theme.border }]}>
      <Ionicons name={download.format === 'mp3' ? 'musical-notes' : 'film'} size={22} color={theme.textMuted} />
      <View style={styles.rowText}>
        <Text style={[styles.title, { color: theme.text }]} numberOfLines={2}>
          {download.title}
        </Text>
        <Text style={[styles.detail, { color }]} numberOfLines={3}>
          {download.format.toUpperCase()} · {detail}
        </Text>
        {active ? (
          <View style={[styles.track, { backgroundColor: theme.border }]}>
            <View style={[styles.fill, { width: `${Math.max(2, download.progress * 100)}%`, backgroundColor: theme.accent }]} />
          </View>
        ) : null}
      </View>
      {active ? (
        <Pressable onPress={() => cancelDownload(download.id)} accessibilityRole="button" accessibilityLabel="Cancel download" hitSlop={8}>
          <Ionicons name="close-circle-outline" size={24} color={theme.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  folderBox: { margin: 16, padding: 14, borderRadius: 12, gap: 12 },
  folderText: { fontSize: 13, lineHeight: 19 },
  empty: { textAlign: 'center', padding: 24, fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  rowText: { flex: 1, gap: 4 },
  title: { fontSize: 15, fontWeight: '600' },
  detail: { fontSize: 13 },
  track: { height: 4, borderRadius: 2, overflow: 'hidden', marginTop: 4 },
  fill: { height: 4 },
});
