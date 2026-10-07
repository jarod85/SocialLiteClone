import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { getPlatform, startPath } from '@/platforms/registry';
import { useTheme } from '@/ui/theme';
import { PlatformWebView } from '@/webview/PlatformWebView';

export default function BrowseScreen() {
  // `open`, `thread` and `at` come from Instagram alerts: litesocial://browse/instagram?open=thread&thread=<id>&at=<time>.
  const { platformId, open, thread, at } = useLocalSearchParams<{
    platformId: string;
    open?: string;
    thread?: string;
    at?: string;
  }>();
  const router = useRouter();
  const platform = getPlatform(platformId);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  if (!platform) return <UnknownPlatform id={platformId} onClose={close} />;
  // Settings opens on top, so the page stays loaded and toggles apply to it live.
  return (
    <PlatformWebView
      platform={platform}
      openPath={startPath(platform, open, thread)}
      openKey={at}
      onClose={close}
      onOpenSettings={() => router.push('/settings')}
    />
  );
}

function UnknownPlatform({ id, onClose }: { id: string | undefined; onClose: () => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.centered, { backgroundColor: theme.background }]}>
      <Text style={{ color: theme.text }}>Unknown platform: {id ?? '(none)'}</Text>
      <Pressable accessibilityRole="button" onPress={onClose}>
        <Text style={{ color: theme.accent }}>Go back</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
});
