import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import { requestNotificationPermission } from '@/features/instagramAlerts/instagramAlerts';

import { startDownload } from '../downloads';
import { youtube } from '../native';
import { useYouTubeSettings } from '../stores';
import type { MusicFolder } from '../types';

import { FolderPicker } from './FolderPicker';

interface Target {
  url: string;
  title: string;
}

/** Asks for the music folder (once) and keeps access to it. */
export async function chooseMusicFolder(): Promise<MusicFolder | null> {
  const folder = await youtube().pickMusicFolder();
  if (folder) useYouTubeSettings.getState().setMusicFolder(folder);
  return folder;
}

/**
 * Download button flow: MP4 or MP3? For MP3, which Musicolet folder? Returns
 * `start(video)` and the folder picker element to render.
 */
export function useDownloadFlow() {
  const router = useRouter();
  const musicFolder = useYouTubeSettings((s) => s.musicFolder);
  const lastFolderPath = useYouTubeSettings((s) => s.lastFolderPath);
  const setLastFolderPath = useYouTubeSettings((s) => s.setLastFolderPath);
  const [mp3Target, setMp3Target] = useState<Target | null>(null);

  const started = useCallback(
    (format: string) => {
      void requestNotificationPermission(); // Progress and "saved" notifications.
      Alert.alert('Download started', `The ${format} downloads in the background. You'll get a notification when it's saved.`, [
        { text: 'OK' },
        { text: 'Show downloads', onPress: () => router.push('/youtube/downloads') },
      ]);
    },
    [router],
  );

  const askForMp3Folder = useCallback(async (target: Target) => {
    let folder = useYouTubeSettings.getState().musicFolder;
    if (folder && !youtube().hasMusicFolderAccess(folder.uri)) folder = null;
    if (!folder) {
      const proceed = await new Promise<boolean>((resolve) =>
        Alert.alert(
          'Choose your music folder',
          'Pick the folder Musicolet plays from (usually "Music"). Lite Social only gets access to that folder. You only do this once.',
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Choose folder', onPress: () => resolve(true) },
          ],
          { cancelable: true, onDismiss: () => resolve(false) },
        ),
      );
      if (!proceed) return;
      folder = await chooseMusicFolder();
      if (!folder) return;
    }
    setMp3Target(target);
  }, []);

  const start = useCallback(
    (target: Target) => {
      Alert.alert('Download', target.title, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Video (MP4)',
          onPress: () => {
            startDownload(target, 'mp4');
            started('video');
          },
        },
        { text: 'Audio (MP3)', onPress: () => void askForMp3Folder(target) },
      ]);
    },
    [askForMp3Folder, started],
  );

  const picker =
    mp3Target && musicFolder ? (
      <FolderPicker
        visible
        root={musicFolder}
        initialPath={lastFolderPath}
        title={mp3Target.title}
        onCancel={() => setMp3Target(null)}
        onSave={(path) => {
          setLastFolderPath(path);
          startDownload(mp3Target, 'mp3', path);
          setMp3Target(null);
          started('MP3');
        }}
        onChangeRoot={() => {
          void chooseMusicFolder();
        }}
      />
    ) : null;

  return { start, picker };
}
