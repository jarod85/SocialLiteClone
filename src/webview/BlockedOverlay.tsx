import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/ui/components';
import { useTheme } from '@/ui/theme';

interface Props {
  /** What was blocked, e.g. "Block Reels". */
  reason: string;
  platformName: string;
  onDismiss: () => void;
  onOpenSettings: () => void;
}

/** Shown instead of a page a rule blocked. The page underneath stays where it was. */
export function BlockedOverlay({ reason, platformName, onDismiss, onOpenSettings }: Props) {
  const theme = useTheme();
  return (
    <View style={[StyleSheet.absoluteFill, styles.backdrop, { backgroundColor: theme.background }]}>
      <View style={styles.card}>
        <Ionicons name="leaf-outline" size={40} color={theme.accent} />
        <Text style={[styles.title, { color: theme.text }]}>Blocked by Lite Social</Text>
        <Text style={[styles.body, { color: theme.textMuted }]}>
          This page is turned off by &ldquo;{reason}&rdquo;. You can change that in Settings.
        </Text>
        <View style={styles.buttons}>
          <Button label={`Back to ${platformName}`} onPress={onDismiss} />
          <Button label="Settings" variant="secondary" onPress={onOpenSettings} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { alignItems: 'center', justifyContent: 'center', padding: 32 },
  card: { alignItems: 'center', gap: 12, maxWidth: 360 },
  title: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  body: { fontSize: 15, lineHeight: 21, textAlign: 'center' },
  buttons: { alignSelf: 'stretch', gap: 10, marginTop: 12 },
});
