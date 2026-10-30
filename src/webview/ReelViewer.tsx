import Ionicons from '@expo/vector-icons/Ionicons';
import { useEvent } from 'expo';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  type GestureResponderEvent,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ReelDetails } from '@/core/types';
import { pause as pauseYouTube } from '@/features/youtube/player';

import { MAX_SPEED, MIN_SPEED, speedForSlide } from './reelSpeed';

export type ReelState = { requestId: string; state: 'loading' } | { requestId: string; state: 'ready'; reel: ReelDetails };

/** The strip along the left side that sets the speed, as a share of the screen width. */
const SPEED_ZONE = 0.3;
const HOLD_MS = 350;
const TAP_MOVE = 10;
const DISMISS_DISTANCE = 140;

/**
 * A reel full screen, the way the Instagram app shows it: edge to edge, on a
 * loop, with the account and caption at the bottom. Tap to pause, hold to
 * pause while you look, slide up or down along the left side for 0.5× to 2×,
 * swipe down or press Back to close.
 */
export function ReelViewer({ reel, onClose }: { reel: ReelState; onClose: () => void }) {
  useEffect(() => {
    pauseYouTube(); // One sound at a time.
  }, []);
  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <StatusBar style="light" />
      {reel.state === 'ready' ? (
        <ReelPlayer key={reel.requestId} reel={reel.reel} onClose={onClose} />
      ) : (
        <View style={[styles.screen, styles.loading]}>
          <ActivityIndicator size="large" color="#FFFFFF" />
          <CloseButton onPress={onClose} />
        </View>
      )}
    </Modal>
  );
}

type Mode = 'undecided' | 'speed' | 'dismiss' | 'none';

/** One touch on the reel, from finger down to finger up. */
interface Gesture {
  mode: Mode;
  startX: number;
  startY: number;
  startSpeed: number;
  startedAt: number;
  lastY: number;
  lastAt: number;
  velocityY: number;
  inSpeedZone: boolean;
  /** Held still long enough to pause. */
  held: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

// The player comes from a hook; these change it from event handlers.
function setPlaybackRate(player: VideoPlayer, rate: number) {
  player.playbackRate = rate;
}
function setMutedOn(player: VideoPlayer, muted: boolean) {
  player.muted = muted;
}
function seekTo(player: VideoPlayer, seconds: number) {
  player.currentTime = seconds;
}

function ReelPlayer({ reel, onClose }: { reel: ReelDetails; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const player = useVideoPlayer({ uri: reel.video, contentType: 'progressive' }, (p) => {
    p.loop = true;
    p.timeUpdateEventInterval = 0.25;
    p.play();
  });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const { status, error } = useEvent(player, 'statusChange', { status: player.status, error: undefined });
  const [firstFrame, setFirstFrame] = useState(false);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [sliding, setSliding] = useState(false);
  const [holding, setHolding] = useState(false);
  const [captionOpen, setCaptionOpen] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [drag] = useState(() => new Animated.Value(0));
  const gesture = useRef<Gesture | null>(null);

  useEffect(
    () => () => {
      if (gesture.current?.timer) clearTimeout(gesture.current.timer);
    },
    [],
  );

  const setRate = (rate: number) => {
    setPlaybackRate(player, rate);
    setSpeed(rate);
  };

  const endHold = (g: Gesture) => {
    if (g.timer) clearTimeout(g.timer);
    g.timer = null;
    if (!g.held) return;
    g.held = false;
    setHolding(false);
    if (!userPaused) player.play();
  };

  const onGrant = (e: GestureResponderEvent) => {
    const { pageX, pageY, timestamp } = e.nativeEvent;
    const g: Gesture = {
      mode: 'undecided',
      startX: pageX,
      startY: pageY,
      startSpeed: speed,
      startedAt: timestamp,
      lastY: pageY,
      lastAt: timestamp,
      velocityY: 0,
      inSpeedZone: pageX < width * SPEED_ZONE,
      held: false,
      timer: null,
    };
    g.timer = setTimeout(() => {
      // Hold to pause while you look, as in the Instagram app.
      g.timer = null;
      g.held = true;
      setHolding(true);
      player.pause();
    }, HOLD_MS);
    gesture.current = g;
  };

  const onMove = (e: GestureResponderEvent) => {
    const g = gesture.current;
    if (!g) return;
    const { pageX, pageY, timestamp } = e.nativeEvent;
    const dx = pageX - g.startX;
    const dy = pageY - g.startY;
    if (timestamp > g.lastAt) g.velocityY = (pageY - g.lastY) / (timestamp - g.lastAt);
    g.lastY = pageY;
    g.lastAt = timestamp;
    if (g.mode === 'undecided' && Math.hypot(dx, dy) > TAP_MOVE) {
      if (g.timer) clearTimeout(g.timer);
      g.timer = null;
      const vertical = Math.abs(dy) > Math.abs(dx);
      if (g.inSpeedZone && vertical) {
        g.mode = 'speed';
        setSliding(true);
        endHold(g); // Rested the finger before sliding: that's a speed change, not a hold.
      } else if (g.held) g.mode = 'none';
      else if (dy > 0 && vertical) g.mode = 'dismiss';
      else g.mode = 'none';
    }
    if (g.mode === 'speed') {
      const next = speedForSlide(g.startSpeed, dy, height);
      if (next !== speed) setRate(next);
    } else if (g.mode === 'dismiss') {
      drag.setValue(Math.max(0, dy));
    }
  };

  const onRelease = (e: GestureResponderEvent) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.timer) clearTimeout(g.timer);
    g.timer = null;
    const dy = e.nativeEvent.pageY - g.startY;
    if (g.held) {
      endHold(g);
    } else if (g.mode === 'dismiss') {
      if (dy > DISMISS_DISTANCE || g.velocityY > 1.2) {
        Animated.timing(drag, { toValue: height, duration: 160, useNativeDriver: true }).start(onClose);
      } else {
        Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
      }
    } else if (g.mode === 'undecided' && e.nativeEvent.timestamp - g.startedAt < HOLD_MS) {
      // A tap: pause or play.
      if (player.playing) {
        player.pause();
        setUserPaused(true);
      } else {
        player.play();
        setUserPaused(false);
      }
    }
    if (g.mode === 'speed') setSliding(false);
  };

  const onTerminate = () => {
    const g = gesture.current;
    gesture.current = null;
    if (g) endHold(g);
    setSliding(false);
    Animated.spring(drag, { toValue: 0, useNativeDriver: true }).start();
  };

  // A reel that fills most of the screen fills all of it (cropping a little), as Instagram does; others fit inside.
  const videoRatio = reel.width > 0 && reel.height > 0 ? reel.width / reel.height : 9 / 16;
  const fill = Math.abs(videoRatio - width / height) / (width / height) < 0.25;
  const backdrop = drag.interpolate({ inputRange: [0, height], outputRange: [1, 0.2], extrapolate: 'clamp' });
  const scale = drag.interpolate({ inputRange: [0, height], outputRange: [1, 0.85], extrapolate: 'clamp' });
  const chrome = !holding; // Holding hides everything but the video, like Instagram.

  return (
    <Animated.View style={[styles.screen, { opacity: backdrop }]}>
      <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateY: drag }, { scale }] }]}>
        {!firstFrame && reel.poster ? (
          <Image source={{ uri: reel.poster }} style={StyleSheet.absoluteFill} contentFit={fill ? 'cover' : 'contain'} />
        ) : null}
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          nativeControls={false}
          contentFit={fill ? 'cover' : 'contain'}
          surfaceType="textureView"
          fullscreenOptions={{ enable: false }}
          onFirstFrameRender={() => setFirstFrame(true)}
        />
        <View
          style={StyleSheet.absoluteFill}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderTerminationRequest={() => false}
          onResponderGrant={onGrant}
          onResponderMove={onMove}
          onResponderRelease={onRelease}
          onResponderTerminate={onTerminate}
        />

        {status === 'error' ? (
          <View style={[StyleSheet.absoluteFill, styles.loading]} pointerEvents="none">
            <Text style={styles.error}>{`Couldn't play this reel${error?.message ? `: ${error.message}` : '.'}`}</Text>
          </View>
        ) : !firstFrame || status === 'loading' ? (
          <View style={[StyleSheet.absoluteFill, styles.loading]} pointerEvents="none">
            <ActivityIndicator size="large" color="#FFFFFF" />
          </View>
        ) : !isPlaying && userPaused && !holding ? (
          <View style={[StyleSheet.absoluteFill, styles.loading]} pointerEvents="none">
            <View style={styles.bigPlay}>
              <Ionicons name="play" size={44} color="#FFFFFF" style={{ marginLeft: 5 }} />
            </View>
          </View>
        ) : null}

        {sliding ? <SpeedGauge speed={speed} top={insets.top} /> : null}

        {chrome ? (
          <>
            <View style={[styles.topBar, { top: insets.top + 6 }]} pointerEvents="box-none">
              <CloseButton onPress={onClose} inline />
              <View style={styles.topRight} pointerEvents="box-none">
                {speed !== 1 && !sliding ? (
                  <Pressable onPress={() => setRate(1)} accessibilityRole="button" accessibilityLabel={`Speed ${speed}×. Back to normal speed`} style={styles.speedChip}>
                    <Text style={styles.speedChipText} textBreakStrategy="simple">{`${formatSpeed(speed)} · 1×`}</Text>
                  </Pressable>
                ) : null}
                <RoundButton
                  label={muted ? 'Turn sound on' : 'Mute'}
                  icon={muted ? 'volume-mute' : 'volume-high'}
                  onPress={() => {
                    setMutedOn(player, !muted);
                    setMuted(!muted);
                  }}
                />
              </View>
            </View>

            <View style={[styles.bottom, { paddingBottom: insets.bottom + 18 }]} pointerEvents="box-none">
              {reel.username ? (
                <View style={styles.account} pointerEvents="none">
                  {reel.avatar ? <Image source={{ uri: reel.avatar }} style={styles.avatar} /> : <View style={styles.avatar} />}
                  <Text style={styles.username} numberOfLines={1}>
                    {reel.username}
                  </Text>
                </View>
              ) : null}
              {reel.caption ? (
                <Pressable onPress={() => setCaptionOpen((o) => !o)} accessibilityRole="button" accessibilityLabel="Caption">
                  <Text style={styles.caption} numberOfLines={captionOpen ? 12 : 2}>
                    {reel.caption}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </>
        ) : null}
        <Progress player={player} duration={reel.duration} bottom={insets.bottom} />
      </Animated.View>
    </Animated.View>
  );
}

function formatSpeed(speed: number): string {
  return `${Number(speed.toFixed(2))}×`;
}

/** Shown while sliding along the left side: the speed, and where it sits between 0.5× and 2×. */
function SpeedGauge({ speed, top }: { speed: number; top: number }) {
  const fraction = (speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED);
  return (
    <>
      <View style={[styles.speedBadge, { top: top + 64 }]} pointerEvents="none">
        <Ionicons name="speedometer-outline" size={18} color="#FFFFFF" />
        <Text style={styles.speedBadgeText} textBreakStrategy="simple">
          {formatSpeed(speed)}
        </Text>
      </View>
      <View style={styles.gauge} pointerEvents="none">
        <View style={[styles.gaugeFill, { height: `${Math.max(4, fraction * 100)}%` }]} />
      </View>
    </>
  );
}

/** Thin bar along the bottom; drag along it to move through the reel. */
function Progress({ player, duration, bottom }: { player: VideoPlayer; duration: number; bottom: number }) {
  const { width } = useWindowDimensions();
  const { currentTime } = useEvent(player, 'timeUpdate', {
    currentTime: player.currentTime,
    bufferedPosition: 0,
    currentLiveTimestamp: null,
    currentOffsetFromLive: null,
  });
  const [scrub, setScrub] = useState<number | null>(null);
  const total = player.duration > 0 ? player.duration : duration;

  const seek = (e: GestureResponderEvent) => {
    const fraction = Math.min(1, Math.max(0, e.nativeEvent.pageX / width));
    setScrub(fraction);
    if (total > 0) seekTo(player, fraction * total);
  };

  const fraction = scrub ?? (total > 0 ? Math.min(1, currentTime / total) : 0);
  return (
    <View
      style={[styles.progressArea, { bottom }]}
      onStartShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={seek}
      onResponderMove={seek}
      onResponderRelease={() => setScrub(null)}
      onResponderTerminate={() => setScrub(null)}
      accessibilityLabel="Position in the reel"
    >
      <View style={[styles.progressTrack, scrub !== null && styles.progressTrackActive]}>
        <View style={[styles.progressFill, { width: `${fraction * 100}%` }]} />
      </View>
    </View>
  );
}

function CloseButton({ onPress, inline = false }: { onPress: () => void; inline?: boolean }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={inline ? undefined : [styles.topBar, { top: insets.top + 6 }]} pointerEvents="box-none">
      <RoundButton label="Close" icon="close" onPress={onPress} />
    </View>
  );
}

function RoundButton({ label, icon, onPress }: { label: string; icon: 'close' | 'volume-mute' | 'volume-high'; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => [styles.round, pressed && { opacity: 0.6 }]}
    >
      <Ionicons name={icon} size={24} color="#FFFFFF" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  loading: { alignItems: 'center', justifyContent: 'center' },
  error: { color: '#FFFFFF', fontSize: 15, textAlign: 'center', paddingHorizontal: 32 },
  bigPlay: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  topBar: { position: 'absolute', left: 10, right: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  round: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)' },
  speedChip: { height: 32, paddingHorizontal: 12, borderRadius: 16, justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' },
  speedChipText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  speedBadge: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  speedBadgeText: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  gauge: {
    position: 'absolute',
    left: 14,
    top: '30%',
    height: '40%',
    width: 6,
    borderRadius: 3,
    overflow: 'hidden',
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  gaugeFill: { width: 6, borderRadius: 3, backgroundColor: '#FFFFFF' },
  bottom: { position: 'absolute', left: 0, right: 64, bottom: 0, paddingHorizontal: 16, gap: 8 },
  account: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.25)' },
  username: { flexShrink: 1, color: '#FFFFFF', fontSize: 15, fontWeight: '700', textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4 },
  caption: { color: '#FFFFFF', fontSize: 14, lineHeight: 19, textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4 },
  progressArea: { position: 'absolute', left: 0, right: 0, height: 22, justifyContent: 'flex-end' },
  progressTrack: { height: 2, backgroundColor: 'rgba(255,255,255,0.3)' },
  progressTrackActive: { height: 5 },
  progressFill: { height: '100%', backgroundColor: '#FFFFFF' },
});
