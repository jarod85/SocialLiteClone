import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useRouter } from 'expo-router';
import { Alert, FlatList, StyleSheet, Text, View } from 'react-native';

import { ChannelRow } from '@/features/youtube/components/rows';
import { YouTubeHeader } from '@/features/youtube/components/YouTubeHeader';
import { parseSubscriptionsExport } from '@/features/youtube/importSubscriptions';
import { useSubscriptions } from '@/features/youtube/stores';
import { Button } from '@/ui/components';
import { useTheme } from '@/ui/theme';

/** The channels you follow, stored on this phone. Import them from Google Takeout or NewPipe. */
export default function SubscriptionsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const channels = useSubscriptions((s) => s.channels);
  const unsubscribe = useSubscriptions((s) => s.unsubscribe);
  const importMany = useSubscriptions((s) => s.importMany);

  const importFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'application/json', 'text/plain', '*/*'],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const text = await new File(result.assets[0].uri).text();
      const found = parseSubscriptionsExport(text);
      if (found.length === 0) {
        Alert.alert('No channels found', 'Pick subscriptions.csv from Google Takeout, or a NewPipe subscriptions export (.json).');
        return;
      }
      const added = importMany(found);
      Alert.alert('Imported', `${added} new channel${added === 1 ? '' : 's'} added (${found.length} in the file).`);
    } catch (e) {
      Alert.alert("Couldn't import", e instanceof Error ? e.message : String(e));
    }
  };

  const confirmUnsubscribe = (id: string, title: string) =>
    Alert.alert('Unsubscribe?', title, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Unsubscribe', style: 'destructive', onPress: () => unsubscribe(id) },
    ]);

  return (
    <View style={styles.screen}>
      <YouTubeHeader
        title={`Your channels (${channels.length})`}
        onBack={() => router.back()}
        actions={[{ icon: 'add', label: 'Find channels', onPress: () => router.push('/youtube/search') }]}
      />
      <FlatList
        data={channels}
        keyExtractor={(c) => c.id}
        renderItem={({ item }) => (
          <ChannelRow
            channel={item}
            subscribed
            onPress={() => router.push({ pathname: '/youtube/channel/[channelId]', params: { channelId: item.id } })}
            onToggleSubscription={() => confirmUnsubscribe(item.id, item.title)}
          />
        )}
        ListHeaderComponent={
          <View style={[styles.importBox, { backgroundColor: theme.surface }]}>
            <Text style={[styles.importText, { color: theme.textMuted }]}>
              Bring your YouTube subscriptions over: on a computer, go to takeout.google.com, select only &quot;YouTube and
              YouTube Music&quot; → subscriptions, download it, put subscriptions.csv on your phone and import it here. NewPipe
              exports (.json) work too.
            </Text>
            <Button label="Import subscriptions file" onPress={() => void importFile()} />
          </View>
        }
        ListEmptyComponent={
          <Text style={[styles.empty, { color: theme.textMuted }]}>No channels yet. Import a file, or tap + to search.</Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  importBox: { margin: 16, padding: 14, borderRadius: 12, gap: 12 },
  importText: { fontSize: 13, lineHeight: 19 },
  empty: { textAlign: 'center', padding: 24, fontSize: 15 },
});
