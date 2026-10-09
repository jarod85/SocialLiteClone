import { Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DailyLimitGate } from '@/features/timeLimit/DailyLimitGate';
import { MiniPlayer } from '@/features/youtube/components/MiniPlayer';
import { useFullscreen } from '@/features/youtube/fullscreen';
import { listenToDownloads } from '@/features/youtube/downloads';
import { youtubeAvailable } from '@/features/youtube/native';
import { pause } from '@/features/youtube/player';
import { Button } from '@/ui/components';
import { useTheme } from '@/ui/theme';

/**
 * The YouTube section: a native client (no Google account) that
 * only shows your subscriptions. Shorts, recommendations and ads never appear,
 * except in YouTube's own player, a fallback you choose when YouTube blocks the
 * network (watch/[videoId].tsx).
 */
export default function YouTubeLayout() {
  const theme = useTheme();
  const router = useRouter();
  const fullscreen = useFullscreen((s) => s.on);

  useEffect(() => {
    listenToDownloads();
  }, []);

  if (!youtubeAvailable) {
    return (
      <SafeAreaView style={[styles.centered, { backgroundColor: theme.background }]}>
        <Text style={[styles.message, { color: theme.text }]}>YouTube needs the installed Android app. It isn&apos;t available in Expo Go.</Text>
        <Button label="Back" onPress={() => router.back()} />
      </SafeAreaView>
    );
  }

  return (
    // In full screen the video reaches every edge; the system bars are hidden then.
    <SafeAreaView
      style={[styles.screen, { backgroundColor: fullscreen ? '#000' : theme.background }]}
      edges={fullscreen ? [] : ['top', 'bottom', 'left', 'right']}
    >
      <View style={styles.screen}>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.background } }} />
        <DailyLimitGate active onLock={pause} onClose={() => router.replace('/')} />
      </View>
      <MiniPlayer />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  message: { fontSize: 16, textAlign: 'center' },
});
