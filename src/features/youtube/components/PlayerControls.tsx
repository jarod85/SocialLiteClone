import Ionicons from '@expo/vector-icons/Ionicons';
import { useEvent } from 'expo';
import { useState, type ComponentProps } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/ui/theme';

import { getPlayer, setLoop, setQuality, usePlayer } from '../player';
import type { VideoDetails } from '../types';

/**
 * Row under the video: full screen in landscape, quality, and loop. Only for
 * the video that is playing.
 */
export function PlayerControls({ details, onLandscape }: { details: VideoDetails; onLandscape: () => void }) {
  const theme = useTheme();
  const quality = usePlayer((s) => s.quality);
  const loop = usePlayer((s) => s.loop);
  const player = getPlayer();
  const { videoTrack } = useEvent(player, 'videoTrackChange', { videoTrack: player.videoTrack });
  const [picking, setPicking] = useState(false);

  // What automatic quality is showing right now, e.g. "Auto · 720p".
  const playingHeight = videoTrack?.size.height ? Math.min(videoTrack.size.height, videoTrack.size.width) : null;
  const auto = playingHeight ? `Auto · ${playingHeight}p` : 'Auto';
  const qualityLabel = quality == null ? auto : (details.qualities.find((q) => q.height === quality)?.label ?? auto);

  return (
    <View style={[styles.row, { borderBottomColor: theme.border }]}>
      <Control icon="phone-landscape-outline" label="Landscape" onPress={onLandscape} />
      {details.qualities.length > 0 ? (
        <Control icon="options-outline" label={qualityLabel} accessibilityLabel={`Quality: ${qualityLabel}`} onPress={() => setPicking(true)} />
      ) : null}
      <Control icon="repeat" label={loop ? 'Loop on' : 'Loop'} active={loop} onPress={() => setLoop(!loop)} />

      <Modal visible={picking} transparent animationType="fade" onRequestClose={() => setPicking(false)}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setPicking(false)} accessibilityLabel="Close" />
          <SafeAreaView edges={['bottom']} style={[styles.sheet, { backgroundColor: theme.background }]}>
            <Text style={[styles.sheetTitle, { color: theme.text }]}>Quality</Text>
            <Text style={[styles.sheetNote, { color: theme.textMuted }]}>Also used for the next videos.</Text>
            <ScrollView>
              {[{ height: null, label: auto }, ...details.qualities].map((q) => (
                <Pressable
                  key={q.height ?? 'auto'}
                  onPress={() => {
                    setPicking(false);
                    void setQuality(q.height);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: q.height === quality }}
                  style={({ pressed }) => [styles.option, pressed && { opacity: 0.6 }]}
                >
                  <Text style={[styles.optionLabel, { color: theme.text }]}>{q.label}</Text>
                  {q.height === quality ? <Ionicons name="checkmark" size={22} color={theme.accent} /> : null}
                </Pressable>
              ))}
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
    </View>
  );
}

function Control({
  icon,
  label,
  accessibilityLabel,
  active = false,
  onPress,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  accessibilityLabel?: string;
  active?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const color = active ? theme.accent : theme.text;
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
      <Ionicons name={icon} size={18} color={color} />
      <Text style={[styles.controlLabel, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  control: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
  },
  controlLabel: { fontSize: 13, fontWeight: '600' },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { maxHeight: '70%', borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingTop: 16, paddingBottom: 8 },
  sheetTitle: { fontSize: 17, fontWeight: '700', paddingHorizontal: 20 },
  sheetNote: { fontSize: 13, paddingHorizontal: 20, paddingTop: 2, paddingBottom: 8 },
  option: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14 },
  optionLabel: { flex: 1, fontSize: 16 },
});
