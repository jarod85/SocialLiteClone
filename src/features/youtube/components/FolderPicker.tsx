import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/ui/components';
import { useTheme } from '@/ui/theme';

import { youtube } from '../native';
import type { MusicFolder } from '../types';

interface Listing {
  key: string;
  path: string[];
  folders: string[];
  error: string | null;
}

/** Lists `path`, or the top folder if `path` is gone. */
async function listFolders(root: string, path: string[]): Promise<Omit<Listing, 'key'>> {
  try {
    return { path, folders: await youtube().listFolders(root, path), error: null };
  } catch (e) {
    if (path.length > 0) return listFolders(root, []);
    return { path, folders: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * "Where should this MP3 go?" Browses the subfolders of the chosen Musicolet
 * music folder; you can go into any of them, make a new one, and save there.
 */
export function FolderPicker({
  visible,
  root,
  initialPath,
  title,
  onCancel,
  onSave,
  onChangeRoot,
}: {
  visible: boolean;
  root: MusicFolder;
  initialPath: string[];
  title: string;
  onCancel: () => void;
  onSave: (path: string[]) => void;
  onChangeRoot: () => void;
}) {
  const theme = useTheme();
  // The folder asked for (by tapping), and what was last listed. Listing falls back to the top
  // when a remembered folder was moved or deleted, so the two can differ.
  const [requested, setRequested] = useState<string[]>(initialPath);
  const [listing, setListing] = useState<Listing | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const requestedKey = requested.join('/');

  useEffect(() => {
    if (!visible) return;
    let active = true;
    void listFolders(root.uri, requested).then((result) => {
      if (active) setListing({ ...result, key: `${root.uri}|${requestedKey}` });
    });
    return () => {
      active = false;
    };
    // `requested` is covered by its key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, root.uri, requestedKey]);

  const loading = listing?.key !== `${root.uri}|${requestedKey}`;
  const path = listing?.path ?? requested;
  const folders = loading ? null : (listing?.folders ?? []);
  const error = createError ?? listing?.error ?? null;

  const go = (next: string[]) => {
    setCreateError(null);
    setRequested(next);
  };

  const createFolder = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const created = await youtube().createFolder(root.uri, path, name);
      setNewName('');
      go([...path, created]);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    }
  };

  const location = [root.name, ...path].join(' / ');

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}>
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <Pressable onPress={onCancel} accessibilityRole="button" accessibilityLabel="Cancel" hitSlop={8} style={styles.iconButton}>
            <Ionicons name="close" size={24} color={theme.text} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={[styles.headerTitle, { color: theme.text }]}>Save MP3 to Musicolet</Text>
            <Text style={[styles.headerSubtitle, { color: theme.textMuted }]} numberOfLines={1}>
              {title}
            </Text>
          </View>
        </View>

        <View style={[styles.location, { backgroundColor: theme.surface }]}>
          <Ionicons name="folder-open" size={20} color={theme.accent} />
          <Text style={[styles.locationText, { color: theme.text }]} numberOfLines={2}>
            {location}
          </Text>
          {path.length > 0 ? (
            <Pressable onPress={() => go(path.slice(0, -1))} accessibilityRole="button" accessibilityLabel="Up one folder" hitSlop={8}>
              <Ionicons name="arrow-up" size={22} color={theme.text} />
            </Pressable>
          ) : null}
        </View>

        {folders === null ? (
          <ActivityIndicator style={styles.loading} color={theme.textMuted} />
        ) : (
          <FlatList
            data={folders}
            keyExtractor={(name) => name}
            ListEmptyComponent={
              <Text style={[styles.empty, { color: theme.textMuted }]}>{error ?? 'No folders here. Save here, or make one below.'}</Text>
            }
            renderItem={({ item }) => (
              <Pressable
                onPress={() => go([...path, item])}
                accessibilityRole="button"
                style={({ pressed }) => [styles.folder, { borderBottomColor: theme.border }, pressed && { opacity: 0.6 }]}
              >
                <Ionicons name="folder" size={22} color={theme.textMuted} />
                <Text style={[styles.folderName, { color: theme.text }]} numberOfLines={1}>
                  {item}
                </Text>
                <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
              </Pressable>
            )}
          />
        )}

        <View style={[styles.footer, { borderTopColor: theme.border }]}>
          <View style={styles.newFolder}>
            <TextInput
              value={newName}
              onChangeText={setNewName}
              placeholder="New folder name"
              placeholderTextColor={theme.textMuted}
              style={[styles.input, { color: theme.text, borderColor: theme.border }]}
              onSubmitEditing={() => void createFolder()}
              returnKeyType="done"
            />
            <Button label="Create" variant="secondary" onPress={() => void createFolder()} disabled={!newName.trim()} />
          </View>
          <Button label={`Save in ${path.length > 0 ? path[path.length - 1] : root.name}`} onPress={() => onSave(path)} />
          <Pressable onPress={onChangeRoot} accessibilityRole="button" hitSlop={6}>
            <Text style={[styles.changeRoot, { color: theme.accent }]}>Use a different music folder…</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1 },
  headerTitle: { fontSize: 17, fontWeight: '700' },
  headerSubtitle: { fontSize: 13 },
  location: { flexDirection: 'row', alignItems: 'center', gap: 10, margin: 16, padding: 12, borderRadius: 10 },
  locationText: { flex: 1, fontSize: 15, fontWeight: '600' },
  loading: { marginTop: 40 },
  empty: { padding: 24, textAlign: 'center', fontSize: 14 },
  folder: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  folderName: { flex: 1, fontSize: 16 },
  footer: { padding: 16, gap: 12, borderTopWidth: StyleSheet.hairlineWidth },
  newFolder: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  input: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  changeRoot: { textAlign: 'center', fontSize: 14 },
});
