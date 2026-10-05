import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/ui/components';
import { useTheme } from '@/ui/theme';

interface Props {
  usedMinutes: number;
  limitMinutes: number;
  canSnooze: boolean;
  onSnooze: () => void;
  onClose: () => void;
}

/** The gentle lock: covers the site once today's limit is used up. */
export function LockOverlay({ usedMinutes, limitMinutes, canSnooze, onSnooze, onClose }: Props) {
  const theme = useTheme();
  return (
    <View style={[StyleSheet.absoluteFill, styles.backdrop, { backgroundColor: theme.background }]}>
      <View style={styles.card}>
        <Ionicons name="moon-outline" size={44} color={theme.accent} />
        <Text style={[styles.title, { color: theme.text }]}>Time for a break</Text>
        <Text style={[styles.body, { color: theme.textMuted }]}>
          You&apos;ve spent {usedMinutes} minutes here today. Your daily limit is {limitMinutes} minutes. It resets at
          midnight.
        </Text>
        <View style={styles.buttons}>
          <Button label="Close" onPress={onClose} />
          {canSnooze ? <Button label="5 more minutes" variant="secondary" onPress={onSnooze} /> : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { alignItems: 'center', justifyContent: 'center', padding: 32 },
  card: { alignItems: 'center', gap: 12, maxWidth: 360 },
  title: { fontSize: 22, fontWeight: '700', textAlign: 'center' },
  body: { fontSize: 15, lineHeight: 21, textAlign: 'center' },
  buttons: { alignSelf: 'stretch', gap: 10, marginTop: 12 },
});
