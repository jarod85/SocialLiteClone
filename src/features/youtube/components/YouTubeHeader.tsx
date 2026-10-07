import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/ui/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

export interface HeaderAction {
  icon: IconName;
  label: string;
  onPress: () => void;
  badge?: number;
}

/** Slim bar at the top of every YouTube screen: back/close, title, actions. */
export function YouTubeHeader({
  title,
  onBack,
  backIcon = 'chevron-back',
  actions = [],
}: {
  title: string;
  onBack: () => void;
  backIcon?: IconName;
  actions?: HeaderAction[];
}) {
  const theme = useTheme();
  return (
    <View style={[styles.bar, { borderBottomColor: theme.border, backgroundColor: theme.background }]}>
      <IconButton icon={backIcon} label="Back" onPress={onBack} />
      <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
        {title}
      </Text>
      {actions.map((a) => (
        <IconButton key={a.label} {...a} />
      ))}
    </View>
  );
}

function IconButton({ icon, label, onPress, badge }: HeaderAction) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      style={({ pressed }) => [styles.button, pressed && { opacity: 0.5 }]}
    >
      <Ionicons name={icon} size={23} color={theme.text} />
      {badge ? (
        <View style={[styles.badge, { backgroundColor: theme.accent }]}>
          <Text style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { height: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { flex: 1, fontSize: 18, fontWeight: '700', marginLeft: 4 },
  button: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700' },
});
