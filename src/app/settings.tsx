import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  openAppSettings,
  openListenerSettings,
  requestNotificationPermission,
  setEnabled as setMessageAlertsEnabled,
} from '@/features/messageAlerts/messageAlerts';
import { useMessageAlerts } from '@/features/messageAlerts/useMessageAlerts';
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

        <MessageAlertsSection />

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

function MessageAlertsSection() {
  const [status, refresh] = useMessageAlerts();
  if (!status.supported) return null;

  const askForListenerAccess = () =>
    Alert.alert(
      'Allow notification access',
      'On the next screen, turn on Lite Social. It only acts on Instagram message notifications.\n\n' +
        'If the switch is greyed out ("Restricted setting"), go back, tap "App info", then ⋮ → "Allow restricted settings", and try again.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Continue', onPress: openListenerSettings },
      ],
    );

  const onToggle = async (value: boolean) => {
    setMessageAlertsEnabled(value);
    refresh();
    if (!value) return;
    await requestNotificationPermission();
    refresh();
    if (!status.listenerAccess) askForListenerAccess();
  };

  let state: string;
  if (!status.enabled) state = '';
  else if (!status.listenerAccess) state = 'Not working yet: Lite Social needs Notification access.';
  else if (!status.canNotify) state = "Not working yet: Lite Social's notifications are turned off.";
  else state = 'On. New Instagram messages show up as Lite Social notifications.';

  return (
    <Section
      title="Message alerts"
      footer={
        'Needs the Instagram app installed and logged in, with only Messages notifications on (Instagram → Settings → Notifications). ' +
        "Lite Social replaces those notifications with its own; nothing is stored or sent anywhere. Instagram's Reply button still works."
      }
    >
      <SwitchRow
        label="Instagram message alerts"
        description="Get notified about new messages. Tapping one opens your inbox in Lite Social instead of the Instagram app."
        value={status.enabled}
        onValueChange={(value) => void onToggle(value)}
      />
      {state ? <TextRow>{state}</TextRow> : null}
      {status.enabled && !status.listenerAccess ? (
        <View style={styles.buttonColumn}>
          <Button label="Allow notification access" onPress={askForListenerAccess} />
          <Button label="App info" variant="secondary" onPress={openAppSettings} />
        </View>
      ) : null}
      {status.enabled && status.listenerAccess && !status.canNotify ? (
        <View style={styles.buttonColumn}>
          <Button label="Turn on notifications" onPress={openAppSettings} />
        </View>
      ) : null}
      {!status.enabled && status.listenerAccess ? (
        <>
          <TextRow>Lite Social still has Notification access but ignores everything while this is off. You can remove the access too.</TextRow>
          <View style={styles.buttonColumn}>
            <Button label="Notification access" variant="secondary" onPress={openListenerSettings} />
          </View>
        </>
      ) : null}
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
  buttonColumn: { paddingHorizontal: 16, paddingBottom: 14, gap: 10 },
  version: { textAlign: 'center', fontSize: 12, marginTop: 28 },
});
