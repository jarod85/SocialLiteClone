import { useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { formatLeakReport, type LeakReport, useLeaks } from '@/state/leakStore';
import { Button, ScreenHeader } from '@/ui/components';
import { useTheme } from '@/ui/theme';

/**
 * Local "Report a leak" notes. They never leave the phone unless you share
 * them, for example to whoever maintains rules.json.
 */
export default function LeaksScreen() {
  const theme = useTheme();
  const router = useRouter();
  const reports = useLeaks((s) => s.reports);
  const remove = useLeaks((s) => s.remove);
  const clear = useLeaks((s) => s.clear);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const shareAll = () => {
    void Share.share({ message: `Lite Social leak reports\n\n${reports.map(formatLeakReport).join('\n\n')}` });
  };

  const confirmClear = () =>
    Alert.alert('Delete all leak reports?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: clear },
    ]);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top', 'bottom', 'left', 'right']}>
      <ScreenHeader title="Leak reports" onBack={back} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.intro, { color: theme.textMuted }]}>
          Tap the flag in the browser toolbar when something should have been hidden but wasn&apos;t. Each report
          keeps the page address and how many items each rule caught on that page. A rule showing 0 where you saw
          the thing is the one that broke. Reports stay on this phone.
        </Text>

        {reports.length === 0 ? (
          <Text style={[styles.empty, { color: theme.textMuted }]}>No reports yet.</Text>
        ) : (
          <>
            <View style={styles.actions}>
              <Button label="Share all" onPress={shareAll} />
              <Button label="Delete all" variant="danger" onPress={confirmClear} />
            </View>
            {reports.map((report) => (
              <ReportCard key={report.id} report={report} onDelete={() => remove(report.id)} />
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ReportCard({ report, onDelete }: { report: LeakReport; onDelete: () => void }) {
  const theme = useTheme();
  const counts = report.counts ? Object.entries(report.counts) : null;
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Text style={[styles.cardDate, { color: theme.textMuted }]}>
        {new Date(report.createdAt).toLocaleString()} · rules r{report.rulesRevision}
      </Text>
      <Text style={[styles.cardUrl, { color: theme.text }]} selectable>
        {report.url}
      </Text>
      {counts === null ? (
        <Text style={[styles.count, { color: theme.textMuted }]}>The page didn&apos;t answer, so there are no rule counts.</Text>
      ) : (
        counts.map(([rule, n]) => (
          <Text key={rule} style={[styles.count, { color: n === 0 ? theme.danger : theme.textMuted }]}>
            {rule}: {n}
          </Text>
        ))
      )}
      <Pressable onPress={onDelete} accessibilityRole="button" hitSlop={8} style={styles.delete}>
        <Text style={{ color: theme.danger }}>Delete</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  intro: { fontSize: 14, lineHeight: 20 },
  empty: { fontSize: 15, textAlign: 'center', marginTop: 32 },
  actions: { flexDirection: 'row', gap: 10 },
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 4 },
  cardDate: { fontSize: 12 },
  cardUrl: { fontSize: 14, fontWeight: '500', marginBottom: 4 },
  count: { fontSize: 13, fontVariant: ['tabular-nums'] },
  delete: { alignSelf: 'flex-end', marginTop: 4 },
});
