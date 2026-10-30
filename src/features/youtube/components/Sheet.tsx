import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/ui/theme';

/** A list of choices sliding up from the bottom (quality, captions, download captions). */
export function SheetModal({ title, note, onClose, children }: { title: string; note: string; onClose: () => void; children: ReactNode }) {
  const theme = useTheme();
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <SafeAreaView edges={['bottom']} style={[styles.sheet, { backgroundColor: theme.background }]}>
          <Text style={[styles.sheetTitle, { color: theme.text }]}>{title}</Text>
          <Text style={[styles.sheetNote, { color: theme.textMuted }]}>{note}</Text>
          <ScrollView>{children}</ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

export function Option({ label, checked, disabled = false, onPress }: { label: string; checked: boolean; disabled?: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ checked, disabled }}
      style={({ pressed }) => [styles.option, (pressed || disabled) && { opacity: disabled ? 0.4 : 0.6 }]}
    >
      <Text style={[styles.optionLabel, { color: theme.text }]}>{label}</Text>
      {checked ? <Ionicons name="checkmark" size={22} color={theme.accent} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { maxHeight: '70%', borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingTop: 16, paddingBottom: 8 },
  sheetTitle: { fontSize: 17, fontWeight: '700', paddingHorizontal: 20 },
  sheetNote: { fontSize: 13, paddingHorizontal: 20, paddingTop: 2, paddingBottom: 8 },
  option: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14 },
  optionLabel: { flex: 1, fontSize: 16 },
});
