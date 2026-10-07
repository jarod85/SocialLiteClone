import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/ui/components';
import { useTheme } from '@/ui/theme';

const POINTS: [string, string][] = [
  [
    'You log in on the real site',
    'There is no Lite Social login screen. You sign in on the platform’s own page inside the app, so your password, 2FA codes and session go straight to the platform.',
  ],
  [
    'Your session stays in the browser',
    'Cookies live in the in-app browser’s own storage, just as they would in a normal browser. The only exception is Instagram notifications (below).',
  ],
  [
    'Filtering only hides things',
    'Lite Social adds a stylesheet and a small script to the page to hide and block things. They look at the page only to decide what to hide. They never collect, store or send your messages, posts or anything else you see.',
  ],
  [
    'What the app keeps',
    'Your settings, today’s total time, any leak reports you create (a page address without its query, plus how many items each rule caught), your YouTube channel list and its cached feed. All of it stays on this phone.',
  ],
  [
    'Instagram notifications (optional, Android)',
    'If you turn them on, a background check uses your Instagram login from the in-app browser to ask instagram.com, the same way the site itself does, for new messages and activity. The login cookies are only ever sent to instagram.com. Sender names, message previews and activity texts go straight into a notification on this phone; nothing is saved or sent anywhere else.',
  ],
  [
    'YouTube',
    'YouTube runs without a Google account. Searches, channel pages, your feed and videos are loaded directly from YouTube by the app (with the open-source NewPipe Extractor). YouTube sees requests from your phone, but they aren’t linked to any account. Downloads are saved on this phone only.',
  ],
  [
    'What goes over the network',
    'Besides the platforms themselves, the app makes one request: it downloads the public blocking-rules file. That request carries no account or browsing data. There are no analytics and no tracking.',
  ],
];

export default function PrivacyScreen() {
  const theme = useTheme();
  const router = useRouter();
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top', 'bottom', 'left', 'right']}>
      <ScreenHeader title="Privacy" onBack={back} />
      <ScrollView contentContainerStyle={styles.content}>
        {POINTS.map(([title, body]) => (
          <Text key={title} style={[styles.body, { color: theme.textMuted }]}>
            <Text style={[styles.title, { color: theme.text }]}>{title}. </Text>
            {body}
          </Text>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 20, gap: 16, paddingBottom: 40 },
  title: { fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 22 },
});
