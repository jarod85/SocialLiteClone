import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/ui/components';
import { useTheme } from '@/ui/theme';

import { installUpdate, useUpdates } from './updates';

/** "A new version is available" card for the start screen. Renders nothing when up to date. */
export function UpdateBanner() {
  const theme = useTheme();
  const available = useUpdates((s) => s.available);
  const progress = useUpdates((s) => s.progress);
  if (!available) return null;

  const firstNote = available.notes.split(/\r?\n/).find((line) => line.trim())?.replace(/^[-*#\s]+/, '');
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.accent }]}>
      <View style={styles.row}>
        <Ionicons name="arrow-down-circle" size={26} color={theme.accent} />
        <View style={styles.text}>
          <Text style={[styles.title, { color: theme.text }]}>Lite Social {available.version} is available</Text>
          {firstNote ? (
            <Text style={[styles.notes, { color: theme.textMuted }]} numberOfLines={2}>
              {firstNote}
            </Text>
          ) : null}
        </View>
      </View>
      {progress !== null ? (
        <View style={[styles.track, { backgroundColor: theme.border }]}>
          <View style={[styles.fill, { width: `${Math.max(2, progress * 100)}%`, backgroundColor: theme.accent }]} />
        </View>
      ) : (
        <Button label="Install update" onPress={() => void installUpdate()} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  text: { flex: 1, gap: 2 },
  title: { fontSize: 16, fontWeight: '600' },
  notes: { fontSize: 13 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6 },
});
