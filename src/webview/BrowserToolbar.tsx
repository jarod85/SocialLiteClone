import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { type Theme, useTheme } from '@/ui/theme';

interface Props {
  title: string;
  canGoBack: boolean;
  onBack: () => void;
  onHome: () => void;
  onReload: () => void;
  onClose: () => void;
}

/**
 * Slim bar above the site. Kept deliberately small so the site's own navigation
 * stays the main way around; this bar only adds what a bare WebView lacks
 * (back on iOS, reload on Android where there's no pull-to-refresh, a way out).
 */
export function BrowserToolbar({ title, canGoBack, onBack, onHome, onReload, onClose }: Props) {
  const theme = useTheme();
  return (
    <View style={[styles.bar, { backgroundColor: theme.background, borderBottomColor: theme.border }]}>
      <ToolbarButton icon="close" label="Close" onPress={onClose} theme={theme} />
      <ToolbarButton icon="chevron-back" label="Back" onPress={onBack} disabled={!canGoBack} theme={theme} />
      <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
        {title}
      </Text>
      <ToolbarButton icon="refresh" label="Reload" onPress={onReload} theme={theme} />
      <ToolbarButton icon="home-outline" label="Home" onPress={onHome} theme={theme} />
    </View>
  );
}

function ToolbarButton({
  icon,
  label,
  onPress,
  disabled = false,
  theme,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  disabled?: boolean;
  theme: Theme;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      hitSlop={8}
      style={({ pressed }) => [styles.button, pressed && { opacity: 0.5 }]}
    >
      <Ionicons name={icon} size={22} color={disabled ? theme.disabled : theme.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  button: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '600',
  },
});
