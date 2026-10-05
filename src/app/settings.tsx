import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDailyLimit } from '@/features/timeLimit/useDailyLimit';
import { platforms } from '@/platforms/registry';
import type { PlatformConfig } from '@/platforms/types';
import { refreshRules, RULES_URL, useRules } from '@/rules/rulesStore';
import { useLeaks } from '@/state/leakStore';
import { DAILY_LIMIT_OPTIONS, FEED_LIMIT_OPTIONS, useSettings, useToggles } from '@/state/settingsStore';
import { Button, Chips, LinkRow, ScreenHeader, Section, SwitchRow, TextRow } from '@/ui/components';
import { useTheme } from '@/ui/theme';

export default function SettingsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const dailyLimitMinutes = useSettings((s) => s.dailyLimitMinutes);
  const setDailyLimitMinutes = useSettings((s) => s.setDailyLimitMinutes);
  const webInspection = useSettings((s) => s.webInspection);
  const setWebInspection = useSettings((s) => s.setWebInspection);
  const limit = useDailyLimit();
  const leakCount = useLeaks((s) => s.reports.length);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top', 'bottom', 'left', 'right']}>
      <ScreenHeader title="Settings" onBack={back} />
      <ScrollView contentContainerStyle={styles.content}>
        {platforms.map((platform) => (
          <PlatformSection key={platform.id} platform={platform} />
        ))}

        <Section
          title="Daily time limit"
          footer={`Used today: ${Math.floor(limit.usedSeconds / 60)} min. When the limit is reached, a break screen covers the site. You get one "5 more minutes" a day.`}
        >
          <View style={styles.chipsTop} />
          <Chips
            options={DAILY_LIMIT_OPTIONS}
            value={dailyLimitMinutes}
            onChange={setDailyLimitMinutes}
            format={(m) => (m === 0 ? 'Off' : `${m} min`)}
          />
        </Section>

        <RulesSection />

        <Section title="Feedback">
          <LinkRow label="Leak reports" detail={String(leakCount)} onPress={() => router.push('/leaks')} />
        </Section>

        <Section title="About">
          <LinkRow label="Privacy" onPress={() => router.push('/privacy')} />
        </Section>

        <Section
          title="Advanced"
          footer="Lets a computer connected over USB inspect pages with chrome://inspect, to find out why a rule stopped working. Leave it off otherwise."
        >
          <SwitchRow label="Allow page inspection" value={webInspection} onValueChange={setWebInspection} />
        </Section>

        <Text style={[styles.version, { color: theme.textMuted }]}>
          Lite Social {Constants.expoConfig?.version ?? ''}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function PlatformSection({ platform }: { platform: PlatformConfig }) {
  const toggles = useToggles(platform);
  const setToggle = useSettings((s) => s.setToggle);
  const feedLimit = useSettings((s) => s.feedLimit);
  const setFeedLimit = useSettings((s) => s.setFeedLimit);

  return (
    <Section title={platform.name} footer="Changes apply right away, including to a page that's already open.">
      {platform.toggles.map((toggle) => (
        <View key={toggle.id}>
          <SwitchRow
            label={toggle.label}
            description={toggle.description}
            value={toggles[toggle.id]}
            onValueChange={(value) => setToggle(platform.id, toggle.id, value)}
          />
          {toggle.id === 'limitFeed' && toggles.limitFeed ? (
            <Chips options={FEED_LIMIT_OPTIONS} value={feedLimit} onChange={setFeedLimit} format={(n) => `${n} posts`} />
          ) : null}
        </View>
      ))}
    </Section>
  );
}

function RulesSection() {
  const rules = useRules((s) => s.rules);
  const source = useRules((s) => s.source);
  const checking = useRules((s) => s.checking);
  const lastCheckedAt = useRules((s) => s.lastCheckedAt);
  const lastError = useRules((s) => s.lastError);

  const sourceLabel = { bundled: 'built into the app', cached: 'downloaded earlier', remote: 'downloaded now' }[source];
  const checked = lastCheckedAt ? new Date(lastCheckedAt).toLocaleString() : 'never';

  return (
    <Section
      title="Blocking rules"
      footer={`Rules are fetched from ${RULES_URL}. They only contain what to hide and block, never code. If a download fails, the current rules stay in place.`}
    >
      <TextRow>
        Revision {rules.revision} ({rules.updated}), {sourceLabel}.{'\n'}Last successful check: {checked}.
        {lastError ? `\nLast check failed: ${lastError}.` : ''}
      </TextRow>
      <View style={styles.buttonRow}>
        <Button
          label={checking ? 'Checking...' : 'Check for rule updates'}
          variant="secondary"
          disabled={checking}
          onPress={() => void refreshRules()}
        />
      </View>
    </Section>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingBottom: 40 },
  chipsTop: { height: 14 },
  buttonRow: { paddingHorizontal: 16, paddingBottom: 14 },
  version: { textAlign: 'center', fontSize: 12, marginTop: 28 },
});
