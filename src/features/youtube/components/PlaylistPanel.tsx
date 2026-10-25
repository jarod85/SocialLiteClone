import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Image } from 'expo-image';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/ui/theme';

import { formatDuration } from '../format';
import { playInPlaylist, skip, usePlayer } from '../player';
import { stepInPlaylist, usePlaylists, type Playlist } from '../playlists';
import { useYouTubeSettings } from '../stores';
import type { Video } from '../types';

/** The playlist playing, where in it, and where Next and Previous go (null: nowhere). */
export function useQueuePosition(): { playlist: Playlist; videoId: string; at: number; next: number | null; previous: number | null } | null {
  const queue = usePlayer((s) => s.queue);
  const playlist = usePlaylists((s) => (queue ? s.playlists.find((p) => p.id === queue.playlistId) : undefined));
  const loop = useYouTubeSettings((s) => s.loopPlaylist);
  if (!queue || !playlist) return null;
  const ids = playlist.videos.map((v) => v.id);
  return {
    playlist,
    videoId: queue.videoId,
    at: ids.indexOf(queue.videoId),
    next: stepInPlaylist(ids, queue.videoId, queue.index, 1, loop),
    previous: stepInPlaylist(ids, queue.videoId, queue.index, -1, loop),
  };
}

/** Autoplay and Loop playlist, kept for every playlist. */
export function PlaylistToggles() {
  const theme = useTheme();
  const autoplay = useYouTubeSettings((s) => s.autoplay);
  const loop = useYouTubeSettings((s) => s.loopPlaylist);
  const setAutoplay = useYouTubeSettings((s) => s.setAutoplay);
  const setLoop = useYouTubeSettings((s) => s.setLoopPlaylist);
  return (
    <>
      <Chip
        icon={<MaterialIcons name="playlist-play" size={20} color={autoplay ? theme.accent : theme.text} />}
        label={autoplay ? 'Autoplay on' : 'Autoplay off'}
        active={autoplay}
        onPress={() => setAutoplay(!autoplay)}
      />
      <Chip
        icon={<Ionicons name="repeat" size={18} color={loop ? theme.accent : theme.text} />}
        label={loop ? 'Loop playlist on' : 'Loop playlist'}
        active={loop}
        onPress={() => setLoop(!loop)}
      />
    </>
  );
}

/**
 * On the watch screen while a playlist plays: its name, what's next,
 * Previous / Next, Autoplay and Loop playlist, and its videos to jump to.
 */
export function PlaylistPanel() {
  const theme = useTheme();
  const position = useQueuePosition();
  const current = usePlayer((s) => s.current);
  const queueError = usePlayer((s) => s.queueError);
  const autoplay = useYouTubeSettings((s) => s.autoplay);
  const [open, setOpen] = useState(false);
  if (!position) return null;
  const { playlist, videoId, at, next, previous } = position;
  const loading = current?.id !== videoId;
  const nextVideo = next !== null ? playlist.videos[next] : null;
  const count = playlist.videos.length;

  const status = loading
    ? `Loading "${playlist.videos[at]?.title ?? 'the next video'}"…`
    : nextVideo
      ? `${autoplay ? 'Next' : 'Next (Autoplay is off)'}: ${nextVideo.title}`
      : count > 0
        ? 'Last video of the playlist'
        : 'This playlist is empty now';

  return (
    <View style={[styles.panel, { backgroundColor: theme.surface }]}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Playlist ${playlist.title}, ${at >= 0 ? at + 1 : '–'} of ${count}`}
        style={styles.panelHeader}
      >
        <MaterialIcons name="playlist-play" size={24} color={theme.text} />
        <View style={styles.panelText}>
          <Text style={[styles.panelTitle, { color: theme.text }]} numberOfLines={1}>
            {playlist.title}
          </Text>
          <Text style={[styles.panelStatus, { color: theme.textMuted }]} numberOfLines={1}>
            {`${at >= 0 ? at + 1 : '–'} / ${count} · ${status}`}
          </Text>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={20} color={theme.textMuted} />
      </Pressable>
      {queueError ? <Text style={[styles.error, { color: theme.danger }]}>{queueError}</Text> : null}

      <View style={styles.chips}>
        <Chip
          icon={<Ionicons name="play-skip-back" size={16} color={previous === null ? theme.disabled : theme.text} />}
          label="Previous"
          disabled={previous === null}
          onPress={() => void skip(-1)}
        />
        <Chip
          icon={<Ionicons name="play-skip-forward" size={16} color={next === null ? theme.disabled : theme.text} />}
          label="Next"
          disabled={next === null}
          onPress={() => void skip(1)}
        />
        <PlaylistToggles />
      </View>

      {open
        ? playlist.videos.map((video, index) => (
            <PlaylistVideoRow
              key={video.id}
              video={video}
              index={index}
              playing={video.id === videoId}
              onPress={() => void playInPlaylist(index)}
            />
          ))
        : null}
    </View>
  );
}

/** A video in a playlist: its number (or a "playing" mark), thumbnail, title and channel, and optional buttons after. */
export function PlaylistVideoRow({
  video,
  index,
  playing,
  onPress,
  children,
}: {
  video: Video;
  index: number;
  playing: boolean;
  onPress: () => void;
  children?: ReactNode;
}) {
  const theme = useTheme();
  const duration = video.isLive ? 'LIVE' : formatDuration(video.durationSeconds);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${index + 1}. ${video.title}${playing ? ', playing' : ''}`}
      style={({ pressed }) => [styles.row, playing && { backgroundColor: theme.border }, pressed && { opacity: 0.7 }]}
    >
      <View style={styles.number}>
        {playing ? (
          <Ionicons name="play" size={14} color={theme.accent} />
        ) : (
          <Text style={[styles.numberText, { color: theme.textMuted }]}>{index + 1}</Text>
        )}
      </View>
      <View style={[styles.thumbnail, { backgroundColor: theme.surface }]}>
        {video.thumbnail ? (
          <Image source={{ uri: video.thumbnail }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={video.id} />
        ) : null}
        {duration ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{duration}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: theme.text }]} numberOfLines={2}>
          {video.title}
        </Text>
        {video.channelName ? (
          <Text style={[styles.rowSubtitle, { color: theme.textMuted }]} numberOfLines={1}>
            {video.channelName}
          </Text>
        ) : null}
      </View>
      {children}
    </Pressable>
  );
}

function Chip({
  icon,
  label,
  active = false,
  disabled = false,
  onPress,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
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
      accessibilityState={{ selected: active, disabled }}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: theme.background, borderColor: active ? theme.accent : theme.border },
        pressed && { opacity: 0.6 },
      ]}
    >
      {icon}
      <Text style={[styles.chipLabel, { color: disabled ? theme.disabled : active ? theme.accent : theme.text }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: { borderRadius: 12, paddingVertical: 4, overflow: 'hidden' },
  panelHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8 },
  panelText: { flex: 1, gap: 2 },
  panelTitle: { fontSize: 15, fontWeight: '700' },
  panelStatus: { fontSize: 13 },
  error: { fontSize: 13, paddingHorizontal: 12, paddingBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, paddingBottom: 10, paddingTop: 2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 18,
    borderWidth: 1,
  },
  chipLabel: { fontSize: 13, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 8, paddingVertical: 8 },
  number: { width: 22, alignItems: 'center' },
  numberText: { fontSize: 13, fontWeight: '600' },
  thumbnail: { width: 112, aspectRatio: 16 / 9, borderRadius: 8, overflow: 'hidden' },
  badge: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    backgroundColor: 'rgba(0,0,0,0.8)',
  },
  badgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '600' },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 14, fontWeight: '600', lineHeight: 19 },
  rowSubtitle: { fontSize: 12 },
});
