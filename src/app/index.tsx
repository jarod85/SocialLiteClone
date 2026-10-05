import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { platforms } from '@/platforms/registry';
import { useTheme } from '@/ui/theme';

/** Platform picker: the app's home screen. */
export default function HomeScreen() {
  const theme = useTheme();
  const router = useRouter();

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.title, { color: theme.text }]}>Lite Social</Text>
        <Text style={[styles.subtitle, { color: theme.textMuted }]}>
          The useful parts of social media, without the endless feed.
        </Text>

        {platforms.map((platform) => (
          <Pressable
            key={platform.id}
            accessibilityRole="button"
            accessibilityLabel={`Open ${platform.name}`}
            onPress={() => router.push({ pathname: '/browse/[platformId]', params: { platformId: platform.id } })}
            style={({ pressed }) => [
              styles.card,
              { backgroundColor: theme.surface, borderColor: theme.border },
              pressed && { opacity: 0.7 },
            ]}
          >
            <View style={[styles.swatch, { backgroundColor: platform.accentColor }]} />
            <View style={styles.cardText}>
              <Text style={[styles.cardTitle, { color: theme.text }]}>{platform.name}</Text>
              <Text style={[styles.cardTagline, { color: theme.textMuted }]}>{platform.tagline}</Text>
            </View>
          </Pressable>
        ))}

        <Text style={[styles.note, { color: theme.textMuted }]}>
          You log in on the platform&apos;s own website. Lite Social never sees your password, cookies or
          messages.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 24, gap: 16 },
  title: { fontSize: 32, fontWeight: '700', marginTop: 24 },
  subtitle: { fontSize: 16, marginBottom: 16 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 16,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  swatch: { width: 40, height: 40, borderRadius: 10 },
  cardText: { flex: 1, gap: 2 },
  cardTitle: { fontSize: 18, fontWeight: '600' },
  cardTagline: { fontSize: 14 },
  note: { fontSize: 13, marginTop: 16, lineHeight: 18 },
});
