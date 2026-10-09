import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useEvent } from 'expo';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { create } from 'zustand';

import { useTheme } from '@/ui/theme';

import { getPlayer, setCaption, setLoop, setQuality, usePlayer } from '../player';
import type { VideoDetails } from '../types';

type Sheet = 'quality' | 'captions';

/** Which settings sheet is open; the buttons on the video and the row under it open the same ones. */
const useSheet = create<{ open: Sheet | null }>()(() => ({ open: null }));
const openSheet = (open: Sheet | null) => useSheet.setState({ open });

/** "Auto · 720p" (what automatic quality shows right now), or the picked quality's label. */
function useQualityLabel(details: VideoDetails): { auto: string; label: string } {
  const quality = usePlayer((s) => s.quality);
  const player = getPlayer();
  const { videoTrack } = useEvent(player, 'videoTrackChange', { videoTrack: player.videoTrack });
  const playingHeight = videoTrack?.size.height ? Math.min(videoTrack.size.height, videoTrack.size.width) : null;
  const auto = playingHeight ? `Auto · ${playingHeight}p` : 'Auto';
  const label = quality == null ? auto : (details.qualities.find((q) => q.height === quality)?.label ?? auto);
  return { auto, label };
}

/** The captions showing, without "(auto-generated)", or null when off. */
function useCaptionLabel(details: VideoDetails): string | null {
  const caption = usePlayer((s) => s.caption);
  const track = details.captions.find((c) => c.id === caption);
  return track ? track.label.replace(/\s*\(auto-generated\)$/, '') : null;
}

/**
 * Row under the video: full screen (sideways), quality, captions and loop.
 * Only for the video that is playing.
 */
export function PlayerControls({ details, onLandscape }: { details: VideoDetails; onLandscape: () => void }) {
  const theme = useTheme();
  const loop = usePlayer((s) => s.loop);
  const { label: qualityLabel } = useQualityLabel(details);
  const captionLabel = useCaptionLabel(details);

  return (
    <View style={[styles.rowWrap, { borderBottomColor: theme.border }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        <Control icon={<Ionicons name="expand" size={18} color={theme.text} />} label="Full screen" onPress={onLandscape} />
        {details.qualities.length > 0 ? (
          <Control
            icon={<Ionicons name="settings-outline" size={18} color={theme.text} />}
            label={qualityLabel}
            accessibilityLabel={`Quality: ${qualityLabel}`}
            onPress={() => openSheet('quality')}
          />
        ) : null}
        {details.captions.length > 0 ? (
          <Control
            icon={<MaterialIcons name={captionLabel ? 'closed-caption' : 'closed-caption-off'} size={20} color={captionLabel ? theme.accent : theme.text} />}
            label={captionLabel ?? 'Captions'}
            accessibilityLabel={`Captions: ${captionLabel ?? 'off'}`}
            active={captionLabel !== null}
            onPress={() => openSheet('captions')}
          />
        ) : null}
        <Control
          icon={<Ionicons name="repeat" size={18} color={loop ? theme.accent : theme.text} />}
          label={loop ? 'Loop on' : 'Loop'}
          active={loop}
          onPress={() => setLoop(!loop)}
        />
      </ScrollView>
    </View>
  );
}

/** How long the buttons on the video stay after a touch while it plays. */
const OVERLAY_HIDE_MS = 3500;

/**
 * Captions, quality and full-screen buttons in the video's top corner, where
 * YouTube has them. They show while the video is paused and for a few seconds
 * after a touch; the player's own controls work as before underneath.
 */
export function VideoOverlay({
  details,
  fullscreen,
  onFullscreen,
  children,
}: {
  details: VideoDetails;
  fullscreen: boolean;
  onFullscreen: () => void;
  children: ReactNode;
}) {
  const player = getPlayer();
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const [touched, setTouched] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const captionOn = usePlayer((s) => s.caption !== null);

  const reveal = () => {
    setTouched(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setTouched(false), OVERLAY_HIDE_MS);
  };
  useEffect(() => {
    timer.current = setTimeout(() => setTouched(false), OVERLAY_HIDE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const visible = touched || !isPlaying;
  const hasCaptions = details.captions.length > 0;
  const hasQualities = details.qualities.length > 0;

  return (
    // onTouchStart only watches touches; the video and its controls still get them.
    <View style={StyleSheet.absoluteFill} onTouchStart={reveal}>
      {children}
      {visible ? (
        <View style={[styles.overlay, fullscreen && styles.overlayFullscreen]} pointerEvents="box-none">
          {hasCaptions ? (
            <OverlayButton label={captionOn ? 'Captions: on' : 'Captions: off'} onPress={() => openSheet('captions')}>
              <MaterialIcons name={captionOn ? 'closed-caption' : 'closed-caption-off'} size={24} color="#FFFFFF" />
            </OverlayButton>
          ) : null}
          {hasQualities ? (
            <OverlayButton label="Quality and speed" onPress={() => openSheet('quality')}>
              <Ionicons name="settings-sharp" size={20} color="#FFFFFF" />
            </OverlayButton>
          ) : null}
          <OverlayButton label={fullscreen ? 'Leave full screen' : 'Full screen'} onPress={onFullscreen}>
            <Ionicons name={fullscreen ? 'contract' : 'expand'} size={22} color="#FFFFFF" />
          </OverlayButton>
        </View>
      ) : null}
    </View>
  );
}

function OverlayButton({ label, onPress, children }: { label: string; onPress: () => void; children: ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => [styles.overlayButton, pressed && { opacity: 0.6 }]}
    >
      {children}
    </Pressable>
  );
}

/** The quality or captions sheet, whichever a button opened. Render once per screen. */
export function PlayerSheet({ details }: { details: VideoDetails }) {
  const open = useSheet((s) => s.open);
  const quality = usePlayer((s) => s.quality);
  const caption = usePlayer((s) => s.caption);
  const captionsAvailable = usePlayer((s) => s.captionsAvailable);
  const captionError = usePlayer((s) => s.captionError);
  const { auto } = useQualityLabel(details);
  const close = () => openSheet(null);

  // Leaving the screen with a sheet open shouldn't reopen it on the next video.
  useEffect(() => () => openSheet(null), []);

  if (open === 'quality') {
    return (
      <SheetModal title="Quality and speed" note="Both are kept for the next videos." onClose={close}>
        <SpeedRow />
        {[{ height: null, label: auto }, ...details.qualities].map((q) => (
          <Option
            key={q.height ?? 'auto'}
            label={q.label}
            checked={q.height === quality}
            onPress={() => {
              close();
              void setQuality(q.height);
            }}
          />
        ))}
      </SheetModal>
    );
  }
  if (open === 'captions') {
    const note = !captionsAvailable
      ? "Captions can't be shown with the version of this video that's playing (a fallback YouTube sent). Try again later."
      : (captionError ?? 'The language you pick is turned on again in the next videos that have it.');
    return (
      <SheetModal title="Captions" note={note} onClose={close}>
        {[{ id: null, label: 'Off' }, ...details.captions].map((c) => (
          <Option
            key={c.id ?? 'off'}
            label={c.label}
            checked={c.id === caption}
            disabled={!captionsAvailable && c.id !== null}
            onPress={() => {
              close();
              setCaption(c.id);
            }}
          />
        ))}
      </SheetModal>
    );
  }
  return null;
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/** Playback speed (the player's own settings button, which had it, is hidden). */
function SpeedRow() {
  const theme = useTheme();
  const player = getPlayer();
  const { playbackRate } = useEvent(player, 'playbackRateChange', { playbackRate: player.playbackRate });
  return (
    <View style={styles.speed}>
      <Text style={[styles.speedLabel, { color: theme.textMuted }]}>Speed</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.speedChips}>
        {SPEEDS.map((rate) => {
          const selected = Math.abs(rate - playbackRate) < 0.01;
          return (
            <Pressable
              key={rate}
              onPress={() => {
                player.playbackRate = rate;
              }}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={`Speed ${rate}x`}
              style={[styles.speedChip, { backgroundColor: selected ? theme.accent : theme.surface }]}
            >
              {/* "simple": Android's default line breaking measured "2×" too narrow and clipped the "×". */}
              <Text style={[styles.speedChipLabel, { color: selected ? '#FFFFFF' : theme.text }]} numberOfLines={1} textBreakStrategy="simple">
                {rate === 1 ? 'Normal' : `${rate}×`}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function SheetModal({ title, note, onClose, children }: { title: string; note: string; onClose: () => void; children: ReactNode }) {
  const theme = useTheme();
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <SafeAreaView edges={['bottom']} style={[styles.sheet, { backgroundColor: theme.background }]}>
          <Text style={[styles.sheetTitle, { color: theme.text }]}>{title}</Text>
          <Text style={[styles.sheetNote, { color: theme.textMuted }]}>{note}</Text>
          <ScrollView>{children}</ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function Option({ label, checked, disabled = false, onPress }: { label: string; checked: boolean; disabled?: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ checked, disabled }}
      style={({ pressed }) => [styles.option, (pressed || disabled) && { opacity: disabled ? 0.4 : 0.6 }]}
    >
      <Text style={[styles.optionLabel, { color: theme.text }]}>{label}</Text>
      {checked ? <Ionicons name="checkmark" size={22} color={theme.accent} /> : null}
    </Pressable>
  );
}

function Control({
  icon,
  label,
  accessibilityLabel,
  active = false,
  onPress,
}: {
  icon: ReactNode;
  label: string;
  accessibilityLabel?: string;
  active?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.control,
        { backgroundColor: theme.surface, borderColor: active ? theme.accent : 'transparent' },
        pressed && { opacity: 0.6 },
      ]}
    >
      {icon}
      <Text style={[styles.controlLabel, { color: active ? theme.accent : theme.text }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  rowWrap: { borderBottomWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  control: {
    maxWidth: 220,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
  },
  controlLabel: { flexShrink: 1, fontSize: 13, fontWeight: '600' },
  overlay: { position: 'absolute', top: 8, right: 8, flexDirection: 'row', gap: 8 },
  overlayFullscreen: { top: 16, right: 24 },
  overlayButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { maxHeight: '70%', borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingTop: 16, paddingBottom: 8 },
  sheetTitle: { fontSize: 17, fontWeight: '700', paddingHorizontal: 20 },
  sheetNote: { fontSize: 13, paddingHorizontal: 20, paddingTop: 2, paddingBottom: 8 },
  speed: { paddingBottom: 8 },
  speedLabel: { fontSize: 13, fontWeight: '600', paddingHorizontal: 20, paddingBottom: 6 },
  speedChips: { flexDirection: 'row', gap: 8, paddingHorizontal: 20 },
  speedChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16 },
  speedChipLabel: { fontSize: 14, fontWeight: '600' },
  option: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14 },
  optionLabel: { flex: 1, fontSize: 16 },
});
