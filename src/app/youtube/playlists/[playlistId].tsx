import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { PlaylistToggles, PlaylistVideoRow } from '@/features/youtube/components/PlaylistPanel';
import { NamePrompt } from '@/features/youtube/components/SaveToPlaylist';
import { YouTubeHeader, type HeaderAction } from '@/features/youtube/components/YouTubeHeader';
import { formatDuration } from '@/features/youtube/format';
import { startPlaylist, usePlayer } from '@/features/youtube/player';
import { usePlaylists } from '@/features/youtube/playlists';
import { Button } from '@/ui/components';
import { useTheme } from '@/ui/theme';

/**
 * One playlist: Play all (or tap a video to start there), Autoplay and Loop
 * playlist, and editing: rename, reorder, remove videos, delete.
 */
export default function PlaylistScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { playlistId } = useLocalSearchParams<{ playlistId: string }>();
  const playlist = usePlaylists((s) => s.playlists.find((p) => p.id === playlistId));
  const rename = usePlaylists((s) => s.rename);
  const remove = usePlaylists((s) => s.remove);
  const removeVideo = usePlaylists((s) => s.removeVideo);
  const moveVideo = usePlaylists((s) => s.moveVideo);
  const playingVideoId = usePlayer((s) => (s.queue?.playlistId === playlistId ? s.queue.videoId : null));
  const [editing, setEditing] = useState(false);
  const [renaming, setRenaming] = useState(false);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/youtube/playlists'));

  if (!playlist) {
    return (
      <View style={styles.screen}>
        <YouTubeHeader title="Playlist" onBack={back} />
        <View style={styles.centered}>
          <Text style={[styles.message, { color: theme.text }]}>This playlist was deleted.</Text>
          <Button label="Back" onPress={back} />
        </View>
      </View>
    );
  }

  const playFrom = (index: number) => {
    const video = playlist.videos[index];
    if (!video) return;
    startPlaylist(playlist, index);
    router.push({ pathname: '/youtube/watch/[videoId]', params: { videoId: video.id } });
  };

  const confirmDelete = () =>
    Alert.alert('Delete playlist?', `"${playlist.title}" and its list of videos. The videos stay on YouTube.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          remove(playlist.id);
          back();
        },
      },
    ]);

  const count = playlist.videos.length;
  const total = playlist.videos.reduce((sum, v) => sum + (v.isLive ? 0 : (v.durationSeconds ?? 0)), 0);
  const summary = [`${count} video${count === 1 ? '' : 's'}`, total > 0 ? formatDuration(total) : ''].filter(Boolean).join(' · ');

  const actions: HeaderAction[] = editing
    ? [{ icon: 'checkmark', label: 'Done editing', onPress: () => setEditing(false) }]
    : [
        ...(count > 0 ? [{ icon: 'swap-vertical', label: 'Reorder or remove videos', onPress: () => setEditing(true) } as const] : []),
        { icon: 'pencil', label: 'Rename playlist', onPress: () => setRenaming(true) },
        { icon: 'trash-outline', label: 'Delete playlist', onPress: confirmDelete },
      ];

  return (
    <View style={styles.screen}>
      <YouTubeHeader title={editing ? 'Edit playlist' : 'Playlist'} onBack={back} actions={actions} />
      <FlatList
        data={playlist.videos}
        keyExtractor={(v) => v.id}
        ListHeaderComponent={
          <View style={[styles.header, { borderBottomColor: theme.border }]}>
            <Text style={[styles.title, { color: theme.text }]}>{playlist.title}</Text>
            <Text style={[styles.summary, { color: theme.textMuted }]}>{summary}</Text>
            {count > 0 && !editing ? (
              <>
                <Button label={playingVideoId ? 'Play from the start' : 'Play all'} onPress={() => playFrom(0)} />
                <View style={styles.toggles}>
                  <PlaylistToggles />
                </View>
              </>
            ) : null}
            {editing ? (
              <Text style={[styles.summary, { color: theme.textMuted }]}>Move videos up or down, or take them out.</Text>
            ) : null}
          </View>
        }
        renderItem={({ item, index }) => (
          <PlaylistVideoRow video={item} index={index} playing={item.id === playingVideoId} onPress={() => (editing ? undefined : playFrom(index))}>
            {editing ? (
              <View style={styles.editButtons}>
                <EditButton icon="arrow-up" label="Move up" disabled={index === 0} onPress={() => moveVideo(playlist.id, index, index - 1)} />
                <EditButton
                  icon="arrow-down"
                  label="Move down"
                  disabled={index === count - 1}
                  onPress={() => moveVideo(playlist.id, index, index + 1)}
                />
                <EditButton icon="close" label="Remove from playlist" onPress={() => removeVideo(playlist.id, item.id)} />
              </View>
            ) : null}
          </PlaylistVideoRow>
        )}
        ListEmptyComponent={
          <Text style={[styles.empty, { color: theme.textMuted }]}>
            No videos yet. Tap the playlist button next to a video, or Save to playlist under it, to add it here.
          </Text>
        }
        contentContainerStyle={styles.list}
      />
      <NamePrompt
        visible={renaming}
        title="Rename playlist"
        initial={playlist.title}
        confirmLabel="Save"
        onCancel={() => setRenaming(false)}
        onConfirm={(name) => {
          rename(playlist.id, name);
          setRenaming(false);
        }}
      />
    </View>
  );
}

function EditButton({
  icon,
  label,
  disabled = false,
  onPress,
}: {
  icon: 'arrow-up' | 'arrow-down' | 'close';
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      hitSlop={4}
      style={({ pressed }) => [styles.editButton, pressed && { opacity: 0.5 }]}
    >
      <Ionicons name={icon} size={20} color={disabled ? theme.disabled : icon === 'close' ? theme.danger : theme.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  message: { fontSize: 16, textAlign: 'center' },
  list: { paddingBottom: 24 },
  header: { padding: 16, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, marginBottom: 6 },
  title: { fontSize: 22, fontWeight: '700' },
  summary: { fontSize: 13 },
  toggles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  editButtons: { flexDirection: 'row' },
  editButton: { width: 34, height: 40, alignItems: 'center', justifyContent: 'center' },
  empty: { padding: 28, textAlign: 'center', fontSize: 15, lineHeight: 21 },
});
