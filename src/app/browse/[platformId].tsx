import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { getPlatform } from '@/platforms/registry';
import { useTheme } from '@/ui/theme';
import { PlatformWebView } from '@/webview/PlatformWebView';

export default function BrowseScreen() {
  const { platformId } = useLocalSearchParams<{ platformId: string }>();
  const router = useRouter();
  const platform = getPlatform(platformId);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  if (!platform) return <UnknownPlatform id={platformId} onClose={close} />;
  return <PlatformWebView platform={platform} onClose={close} />;
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
