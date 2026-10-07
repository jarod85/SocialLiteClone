import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  CHECK_INTERVAL_OPTIONS,
  checkNow as checkInstagramNow,
  hasSession as hasInstagramSession,
  openAppSettings,
  requestNotificationPermission,
  requestUnrestrictedBattery,
  setEnabled as setInstagramAlertsEnabled,
  setIntervalMinutes as setInstagramCheckInterval,
} from '@/features/instagramAlerts/instagramAlerts';
import { useInstagramAlerts } from '@/features/instagramAlerts/useInstagramAlerts';
import { useDailyLimit } from '@/features/timeLimit/useDailyLimit';
import { chooseMusicFolder } from '@/features/youtube/components/useDownloadFlow';
import { youtubeAvailable } from '@/features/youtube/native';
import { MP3_BITRATES, useSubscriptions, useYouTubeSettings, VIDEO_HEIGHTS } from '@/features/youtube/stores';
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

        <InstagramAlertsSection />

        <YouTubeSection />

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

function InstagramAlertsSection() {
  const [status, refresh] = useInstagramAlerts();
  const [checking, setChecking] = useState(false);
  if (!status.supported) return null;

  const runCheck = async () => {
    setChecking(true);
    try {
      await checkInstagramNow();
    } finally {
      setChecking(false);
      refresh();
    }
  };

  const onToggle = async (value: boolean) => {
    if (value && !(await hasInstagramSession())) {
      Alert.alert(
        'Log in to Instagram first',
        'Notifications use the Instagram login in Lite Social. Open Instagram from the start screen, log in, then turn this on.',
      );
      return;
    }
    setInstagramAlertsEnabled(value);
    refresh();
    if (!value) return;
    await requestNotificationPermission();
    refresh();
    await runCheck();
  };

  const result = status.lastResult;
  const lines: string[] = [];
  if (status.enabled && !status.canNotify) lines.push("Not working yet: Lite Social's notifications are turned off.");
  if (result) {
    const when = new Date(result.checkedAt).toLocaleString();
    if (!result.loggedIn) lines.push(`Last check (${when}): not logged in. Open Instagram in Lite Social and log in.`);
    else {
      lines.push(`Last check: ${when}.`);
      lines.push(`Messages: ${result.messages}${result.messages === 'OK' ? ` (${result.unreadConversations} unread)` : ''}.`);
      lines.push(`Activity: ${result.activity}.`);
    }
  }

  return (
    <Section
      title="Instagram notifications"
      footer={
        "Lite Social can't receive Instagram's push notifications, so it checks Instagram itself in the background, using your " +
        'Instagram login in this app. Alerts can arrive up to the interval late (Android decides the exact time). ' +
        'Nothing is stored or sent anywhere except to instagram.com.'
      }
    >
      <SwitchRow
        label="Instagram notifications"
        description="New messages (tap to open the chat) plus likes, comments, follows and mentions (tap to open your activity)."
        value={status.enabled}
        onValueChange={(value) => void onToggle(value)}
      />
      {status.enabled ? (
        <>
          <TextRow>Check every</TextRow>
          <Chips
            options={CHECK_INTERVAL_OPTIONS}
            value={status.intervalMinutes as (typeof CHECK_INTERVAL_OPTIONS)[number]}
            onChange={(minutes) => {
              setInstagramCheckInterval(minutes);
              refresh();
            }}
            format={(m) => (m === 60 ? '1 hour' : `${m} min`)}
          />
        </>
      ) : null}
      {lines.length > 0 ? <TextRow>{lines.join('\n')}</TextRow> : null}
      {status.enabled ? (
        <View style={styles.buttonColumn}>
          <Button label={checking ? 'Checking...' : 'Check now'} variant="secondary" disabled={checking} onPress={() => void runCheck()} />
          {!status.canNotify ? <Button label="Turn on notifications" onPress={openAppSettings} /> : null}
          {!status.unrestricted ? (
            <>
              <TextRow>
                Battery optimization can hold the background checks back for hours. Allow Lite Social to run in the background
                for timely alerts.
              </TextRow>
              <Button label="Allow background checks" onPress={requestUnrestrictedBattery} />
            </>
          ) : null}
        </View>
      ) : null}
    </Section>
  );
}

function YouTubeSection() {
  const musicFolder = useYouTubeSettings((s) => s.musicFolder);
  const mp3Kbps = useYouTubeSettings((s) => s.mp3Kbps);
  const setMp3Kbps = useYouTubeSettings((s) => s.setMp3Kbps);
  const videoMaxHeight = useYouTubeSettings((s) => s.videoMaxHeight);
  const setVideoMaxHeight = useYouTubeSettings((s) => s.setVideoMaxHeight);
  const subscriptions = useSubscriptions((s) => s.channels.length);
  const router = useRouter();
  if (!youtubeAvailable) return null;

  return (
    <Section
      title="YouTube"
      footer="MP3s are saved into the music folder you pick (the one Musicolet plays from); you choose the subfolder for each song. Videos go to Movies/Lite Social."
    >
      <LinkRow label="Your channels" detail={String(subscriptions)} onPress={() => router.push('/youtube/subscriptions')} />
      <LinkRow
        label="Music folder"
        detail={musicFolder?.name ?? 'Not chosen'}
        onPress={() => void chooseMusicFolder()}
      />
      <TextRow>MP3 quality</TextRow>
      <Chips options={MP3_BITRATES} value={mp3Kbps as (typeof MP3_BITRATES)[number]} onChange={setMp3Kbps} format={(k) => `${k} kbps`} />
      <TextRow>Video download quality (up to)</TextRow>
      <Chips
        options={VIDEO_HEIGHTS}
        value={videoMaxHeight as (typeof VIDEO_HEIGHTS)[number]}
        onChange={setVideoMaxHeight}
        format={(h) => `${h}p`}
      />
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
