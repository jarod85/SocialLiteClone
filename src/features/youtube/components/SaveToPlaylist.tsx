import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { create } from 'zustand';

import { Button } from '@/ui/components';
import { useTheme } from '@/ui/theme';

import { usePlaylists } from '../playlists';
import type { Video } from '../types';

/** The video the "Save to playlist" sheet is open for. */
const useSaveSheet = create<{ video: Video | null }>()(() => ({ video: null }));

export function openSaveToPlaylist(video: Video): void {
  useSaveSheet.setState({ video });
}

const close = () => useSaveSheet.setState({ video: null });

/**
 * "Save to playlist": tick the playlists the video should be in, or make a new
 * one with it. Rendered once, in the YouTube layout, for every screen.
 */
export function SaveToPlaylistSheet() {
  const theme = useTheme();
  const video = useSaveSheet((s) => s.video);
  const playlists = usePlaylists((s) => s.playlists);
  const addVideo = usePlaylists((s) => s.addVideo);
  const removeVideo = usePlaylists((s) => s.removeVideo);
  const createPlaylist = usePlaylists((s) => s.create);
  const [naming, setNaming] = useState(false);

  if (!video) return null;

  return (
    <>
      <Modal visible={!naming} transparent animationType="fade" onRequestClose={close}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close" />
          <SafeAreaView edges={['bottom']} style={[styles.sheet, { backgroundColor: theme.background }]}>
            <Text style={[styles.title, { color: theme.text }]}>Save to playlist</Text>
            <Text style={[styles.note, { color: theme.textMuted }]} numberOfLines={1}>
              {video.title}
            </Text>
            <ScrollView>
              {playlists.map((p) => {
                const saved = p.videos.some((v) => v.id === video.id);
                return (
                  <Pressable
                    key={p.id}
                    onPress={() => (saved ? removeVideo(p.id, video.id) : addVideo(p.id, video))}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: saved }}
                    style={({ pressed }) => [styles.option, pressed && { opacity: 0.6 }]}
                  >
                    <Ionicons name={saved ? 'checkbox' : 'square-outline'} size={24} color={saved ? theme.accent : theme.textMuted} />
                    <Text style={[styles.optionLabel, { color: theme.text }]} numberOfLines={1}>
                      {p.title}
                    </Text>
                    <Text style={[styles.count, { color: theme.textMuted }]}>{p.videos.length}</Text>
                  </Pressable>
                );
              })}
              <Pressable
                onPress={() => setNaming(true)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.option, pressed && { opacity: 0.6 }]}
              >
                <Ionicons name="add" size={24} color={theme.accent} />
                <Text style={[styles.optionLabel, { color: theme.accent }]}>New playlist</Text>
              </Pressable>
            </ScrollView>
            <View style={styles.done}>
              <Button label="Done" variant="secondary" onPress={close} />
            </View>
          </SafeAreaView>
        </View>
      </Modal>
      <NamePrompt
        visible={naming}
        title="New playlist"
        confirmLabel="Create"
        onCancel={() => setNaming(false)}
        onConfirm={(name) => {
          createPlaylist(name, video);
          setNaming(false);
        }}
      />
    </>
  );
}

/**
 * Asks for a playlist's name. It sits near the top of the screen so the
 * keyboard never covers it.
 */
export function NamePrompt({
  visible,
  title,
  initial = '',
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  initial?: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: (name: string) => void;
}) {
  const theme = useTheme();
  const [name, setName] = useState(initial);
  const [shown, setShown] = useState(visible);
  // Start from `initial` each time it opens.
  if (visible !== shown) {
    setShown(visible);
    if (visible) setName(initial);
  }
  const confirm = () => {
    if (name.trim()) onConfirm(name.trim());
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.promptBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} accessibilityLabel="Cancel" />
        <View style={[styles.prompt, { backgroundColor: theme.background }]}>
          <Text style={[styles.promptTitle, { color: theme.text }]}>{title}</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Name"
            placeholderTextColor={theme.textMuted}
            autoFocus
            maxLength={150}
            returnKeyType="done"
            onSubmitEditing={confirm}
            style={[styles.input, { color: theme.text, borderColor: theme.border }]}
          />
          <View style={styles.promptButtons}>
            <Button label="Cancel" variant="secondary" onPress={onCancel} />
            <Button label={confirmLabel} onPress={confirm} disabled={!name.trim()} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { maxHeight: '70%', borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingTop: 16, paddingBottom: 8 },
  title: { fontSize: 17, fontWeight: '700', paddingHorizontal: 20 },
  note: { fontSize: 13, paddingHorizontal: 20, paddingTop: 2, paddingBottom: 8 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 13 },
  optionLabel: { flex: 1, fontSize: 16 },
  count: { fontSize: 14 },
  done: { paddingHorizontal: 20, paddingTop: 8 },
  promptBackdrop: { flex: 1, justifyContent: 'flex-start', paddingTop: 96, paddingHorizontal: 24, backgroundColor: 'rgba(0,0,0,0.4)' },
  prompt: { borderRadius: 14, padding: 20, gap: 14 },
  promptTitle: { fontSize: 17, fontWeight: '700' },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  promptButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
});
