/**
 * App updates over the internet (Android). New versions are published as
 * GitHub Releases (scripts/publish-release.ps1). The app checks for one on
 * launch (at most every few hours) and in Settings; installing downloads the
 * APK and opens Android's installer, where you confirm. The native module
 * (modules/app-updater) only installs a newer Lite Social signed with the same
 * key as the installed one.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { requireOptionalNativeModule } from 'expo';
import { Alert, Platform } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { type AvailableUpdate, compareVersions, latestReleasePageUrl, parseRelease, parseReleasePageUrl } from './releases';

interface UpdaterModule {
  getInstalledVersion(): { versionName: string; versionCode: number };
  canInstallPackages(): boolean;
  openInstallPermissionSettings(): void;
  downloadAndInstall(url: string): Promise<void>;
  addListener(event: 'onUpdateProgress', listener: (e: { progress: number }) => void): { remove(): void };
}

const native = Platform.OS === 'android' ? requireOptionalNativeModule<UpdaterModule>('LiteSocialUpdater') : null;

export const updatesSupported = native !== null;

/** Override with EXPO_PUBLIC_RELEASES_URL when building from a fork. */
export const RELEASES_URL =
  process.env.EXPO_PUBLIC_RELEASES_URL ?? 'https://api.github.com/repos/jarod85/SocialLiteClone/releases/latest';

/** Automatic checks at most this often. */
const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

interface UpdatesState {
  /** A newer version than the installed one, if the last check found one. */
  available: AvailableUpdate | null;
  lastCheckedAt: number | null;
  checking: boolean;
  error: string | null;
  /** 0..1 while downloading, null otherwise. */
  progress: number | null;
}

export const useUpdates = create<UpdatesState>()(
  persist(() => ({ available: null, lastCheckedAt: null, checking: false, error: null, progress: null }) as UpdatesState, {
    name: 'lite-social.updates',
    version: 1,
    storage: createJSONStorage(() => AsyncStorage),
    partialize: (s) => ({ available: s.available, lastCheckedAt: s.lastCheckedAt }),
  }),
);

export function installedVersion(): string {
  return native?.getInstalledVersion().versionName ?? '';
}

export async function checkForUpdate(): Promise<void> {
  if (!native || useUpdates.getState().checking) return;
  useUpdates.setState({ checking: true, error: null });
  try {
    const latest = await fetchLatestRelease();
    const newer = latest && compareVersions(latest.version, installedVersion()) > 0 ? latest : null;
    useUpdates.setState({ available: newer, lastCheckedAt: Date.now(), checking: false });
  } catch (e) {
    useUpdates.setState({ checking: false, error: e instanceof Error ? e.message : String(e) });
  }
}

/** The latest release, or null if there is none yet. */
async function fetchLatestRelease(): Promise<AvailableUpdate | null> {
  let apiError: unknown;
  try {
    const response = await fetch(RELEASES_URL, { headers: { Accept: 'application/vnd.github+json' } });
    if (response.status === 404) return null;
    if (response.ok) return parseRelease(await response.json());
    apiError = new Error(`HTTP ${response.status}`);
  } catch (e) {
    apiError = e;
  }
  // The API refused (often its hourly limit, shared by everyone on this network): ask github.com instead.
  const page = latestReleasePageUrl(RELEASES_URL);
  if (!page) throw apiError;
  const response = await fetch(page, { method: 'HEAD' });
  if (!response.ok) throw apiError;
  return parseReleasePageUrl(response.url);
}

/** On launch: checks if the last check is old enough. Drops a stale offer once it's installed. */
export function autoCheckForUpdate(): void {
  if (!native) return;
  const { available, lastCheckedAt } = useUpdates.getState();
  if (available && compareVersions(available.version, installedVersion()) <= 0) useUpdates.setState({ available: null });
  if (!lastCheckedAt || Date.now() - lastCheckedAt > AUTO_CHECK_INTERVAL_MS) void checkForUpdate();
}

export async function installUpdate(): Promise<void> {
  const { available, progress } = useUpdates.getState();
  if (!native || !available || progress !== null) return;
  if (!native.canInstallPackages()) {
    Alert.alert(
      'Allow Lite Social to install updates',
      'On the next screen, turn on "Allow from this source". Then tap Install again. You only do this once, and you still confirm every update.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Continue', onPress: () => native.openInstallPermissionSettings() },
      ],
    );
    return;
  }
  const subscription = native.addListener('onUpdateProgress', ({ progress: p }) => useUpdates.setState({ progress: p }));
  useUpdates.setState({ progress: 0, error: null });
  try {
    await native.downloadAndInstall(available.apkUrl);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    useUpdates.setState({ error: message });
    Alert.alert("Couldn't install the update", message);
  } finally {
    subscription.remove();
    useUpdates.setState({ progress: null });
  }
}
