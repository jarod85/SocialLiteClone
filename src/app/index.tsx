import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDailyLimit } from '@/features/timeLimit/useDailyLimit';
import { UpdateBanner } from '@/features/updates/UpdateBanner';
import { platforms } from '@/platforms/registry';
import { useTheme } from '@/ui/theme';

/** Platform picker: the app's home screen. */
export default function HomeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const limit = useDailyLimit();
  const usedMinutes = Math.floor(limit.usedSeconds / 60);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: theme.text }]}>Lite Social</Text>
          <Pressable
            onPress={() => router.push('/settings')}
            accessibilityRole="button"
            accessibilityLabel="Settings"
            hitSlop={8}
            style={({ pressed }) => pressed && { opacity: 0.5 }}
          >
            <Ionicons name="settings-outline" size={26} color={theme.text} />
          </Pressable>
        </View>
        <Text style={[styles.subtitle, { color: theme.textMuted }]}>
          The useful parts of social media, without the endless feed.
        </Text>

        <UpdateBanner />

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
            <Ionicons name="chevron-forward" size={20} color={theme.textMuted} />
          </Pressable>
        ))}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open YouTube"
          onPress={() => router.push('/youtube')}
          style={({ pressed }) => [
            styles.card,
            { backgroundColor: theme.surface, borderColor: theme.border },
            pressed && { opacity: 0.7 },
          ]}
        >
          <View style={[styles.swatch, { backgroundColor: '#E62117' }]} />
          <View style={styles.cardText}>
            <Text style={[styles.cardTitle, { color: theme.text }]}>YouTube</Text>
            <Text style={[styles.cardTagline, { color: theme.textMuted }]}>
              Your subscriptions only. No Shorts, no ads, plays in the background
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={theme.textMuted} />
        </Pressable>

        <Text style={[styles.usage, { color: theme.textMuted }]}>
          Today: {usedMinutes} min
          {limit.limitMinutes > 0 ? ` of ${limit.limitMinutes} min` : ''}
        </Text>

        <Pressable onPress={() => router.push('/privacy')} accessibilityRole="link">
          <Text style={[styles.note, { color: theme.textMuted }]}>
            You log in on the platform&apos;s own website. Lite Social never sees your password, cookies or
            messages. <Text style={{ color: theme.accent }}>Privacy</Text>
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 24, gap: 16 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 24 },
  title: { fontSize: 32, fontWeight: '700' },
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
  usage: { fontSize: 14, marginTop: 8 },
  note: { fontSize: 13, marginTop: 8, lineHeight: 18 },
});
