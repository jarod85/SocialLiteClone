import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/ui/theme';

interface Props {
  platformName: string;
  description: string;
  onRetry: () => void;
}

/** Shown over the WebView when the main page fails to load (offline, DNS, TLS...). */
export function LoadErrorView({ platformName, description, onRetry }: Props) {
  const theme = useTheme();
  return (
    <View style={[StyleSheet.absoluteFill, styles.container, { backgroundColor: theme.background }]}>
      <Text style={[styles.title, { color: theme.text }]}>Couldn&apos;t load {platformName}</Text>
      <Text style={[styles.description, { color: theme.textMuted }]}>{description}</Text>
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        style={({ pressed }) => [styles.button, { backgroundColor: theme.accent }, pressed && { opacity: 0.7 }]}
      >
        <Text style={styles.buttonText}>Try again</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  title: { fontSize: 18, fontWeight: '600' },
  description: { fontSize: 14, textAlign: 'center' },
  button: { marginTop: 8, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
});
