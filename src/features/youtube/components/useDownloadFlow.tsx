import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import { requestNotificationPermission } from '@/features/instagramAlerts/instagramAlerts';

import { pickCaption } from '../captions';
import { startDownload } from '../downloads';
import { youtube } from '../native';
import { useYouTubeSettings } from '../stores';
import type { CaptionTrack, MusicFolder } from '../types';

import { FolderPicker } from './FolderPicker';
import { Option, SheetModal } from './Sheet';

interface Target {
  url: string;
  title: string;
  /** The video's caption tracks, offered for MP4 downloads. */
  captions?: CaptionTrack[];
}

/** Asks for the music folder (once) and keeps access to it. */
export async function chooseMusicFolder(): Promise<MusicFolder | null> {
  const folder = await youtube().pickMusicFolder();
  if (folder) useYouTubeSettings.getState().setMusicFolder(folder);
  return folder;
}

/**
 * Download button flow: MP4 or MP3? For MP4, which captions (if the video has
 * any)? For MP3, which Musicolet folder? Returns `start(video)` and the
 * element to render (folder picker or captions sheet).
 */
export function useDownloadFlow() {
  const router = useRouter();
  const musicFolder = useYouTubeSettings((s) => s.musicFolder);
  const lastFolderPath = useYouTubeSettings((s) => s.lastFolderPath);
  const setLastFolderPath = useYouTubeSettings((s) => s.setLastFolderPath);
  const [mp3Target, setMp3Target] = useState<Target | null>(null);
  const [mp4Target, setMp4Target] = useState<Target | null>(null);

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

  const downloadMp4 = useCallback(
    (target: Target, caption: CaptionTrack | null) => {
      startDownload(target, 'mp4', [], caption);
      started(caption ? `video with ${caption.label} captions` : 'video');
    },
    [started],
  );

  const start = useCallback(
    (target: Target) => {
      Alert.alert('Download', target.title, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Video (MP4)',
          onPress: () => {
            if (target.captions?.length) setMp4Target(target);
            else downloadMp4(target, null);
          },
        },
        { text: 'Audio (MP3)', onPress: () => void askForMp3Folder(target) },
      ]);
    },
    [askForMp3Folder, downloadMp4],
  );

  let element = null;
  if (mp3Target && musicFolder) {
    element = (
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
    );
  } else if (mp4Target) {
    element = <CaptionChoice target={mp4Target} onClose={() => setMp4Target(null)} onPick={(caption) => downloadMp4(mp4Target, caption)} />;
  }

  return { start, picker: element };
}

/** "Captions in the video": none, or one of the video's languages. The choice is offered first next time. */
function CaptionChoice({ target, onClose, onPick }: { target: Target; onClose: () => void; onPick: (caption: CaptionTrack | null) => void }) {
  const captions = target.captions ?? [];
  const { downloadCaptionLanguage, captionLanguage, setDownloadCaptionLanguage } = useYouTubeSettings.getState();
  const remembered = downloadCaptionLanguage ?? captionLanguage;
  const preselected = remembered === 'off' ? null : pickCaption(captions, remembered);
  const pick = (caption: CaptionTrack | null) => {
    setDownloadCaptionLanguage(caption ? caption.language : 'off');
    onClose();
    onPick(caption);
  };
  return (
    <SheetModal
      title="Captions in the video"
      note={
        "Pick a language to add its captions to the MP4. They're saved in the video and as an .srt file next to it in " +
        "Movies/Lite Social, which Samsung's video player and most others show (turn on subtitles in the player if they don't)."
      }
      onClose={onClose}
    >
      <Option label="No captions" checked={preselected === null} onPress={() => pick(null)} />
      {captions.map((c) => (
        <Option key={c.id} label={c.label} checked={c.id === preselected?.id} onPress={() => pick(c)} />
      ))}
    </SheetModal>
  );
}
