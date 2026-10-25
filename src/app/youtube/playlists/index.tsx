import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { NamePrompt } from '@/features/youtube/components/SaveToPlaylist';
import { YouTubeHeader } from '@/features/youtube/components/YouTubeHeader';
import { usePlayer } from '@/features/youtube/player';
import { usePlaylists, type Playlist } from '@/features/youtube/playlists';
import { Button } from '@/ui/components';
import { useTheme } from '@/ui/theme';

/** Your playlists, newest first. They're kept on this phone. */
export default function PlaylistsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const playlists = usePlaylists((s) => s.playlists);
  const create = usePlaylists((s) => s.create);
  const playingId = usePlayer((s) => s.queue?.playlistId ?? null);
  const [naming, setNaming] = useState(false);

  const open = (id: string) => router.push({ pathname: '/youtube/playlists/[playlistId]', params: { playlistId: id } });

  return (
    <View style={styles.screen}>
      <YouTubeHeader
        title="Playlists"
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/youtube'))}
        actions={[{ icon: 'add', label: 'New playlist', onPress: () => setNaming(true) }]}
      />
      <FlatList
        data={playlists}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => <PlaylistRow playlist={item} playing={item.id === playingId} onPress={() => open(item.id)} />}
        contentContainerStyle={playlists.length === 0 ? styles.emptyContainer : undefined}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: theme.text }]}>No playlists yet</Text>
            <Text style={[styles.emptyBody, { color: theme.textMuted }]}>
              Make one here, or tap the playlist button next to any video (or Save to playlist under it). A playlist
              plays its videos one after another.
            </Text>
            <Button label="New playlist" onPress={() => setNaming(true)} />
          </View>
        }
      />
      <NamePrompt
        visible={naming}
        title="New playlist"
        confirmLabel="Create"
        onCancel={() => setNaming(false)}
        onConfirm={(name) => {
          setNaming(false);
          open(create(name));
        }}
      />
    </View>
  );
}

function PlaylistRow({ playlist, playing, onPress }: { playlist: Playlist; playing: boolean; onPress: () => void }) {
  const theme = useTheme();
  const cover = playlist.videos.find((v) => v.thumbnail)?.thumbnail;
  const count = playlist.videos.length;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${playlist.title}, ${count} video${count === 1 ? '' : 's'}${playing ? ', playing' : ''}`}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
    >
      <View style={[styles.cover, { backgroundColor: theme.surface }]}>
        {cover ? <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={playlist.id} /> : null}
        <View style={styles.coverCount}>
          <MaterialIcons name="playlist-play" size={18} color="#FFFFFF" />
          <Text style={styles.coverCountText}>{count}</Text>
        </View>
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.title, { color: theme.text }]} numberOfLines={2}>
          {playlist.title}
        </Text>
        <Text style={[styles.subtitle, { color: playing ? theme.accent : theme.textMuted }]}>
          {playing ? 'Playing now' : `${count} video${count === 1 ? '' : 's'}`}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  emptyContainer: { flexGrow: 1 },
  empty: { flex: 1, justifyContent: 'center', padding: 28, gap: 14 },
  emptyTitle: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  emptyBody: { fontSize: 15, lineHeight: 21, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 10 },
  cover: { width: 140, aspectRatio: 16 / 9, borderRadius: 10, overflow: 'hidden' },
  coverCount: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 52,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  coverCountText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  rowText: { flex: 1, gap: 4 },
  title: { fontSize: 16, fontWeight: '600', lineHeight: 21 },
  subtitle: { fontSize: 13 },
});
