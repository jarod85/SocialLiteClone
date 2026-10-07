import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';

import { autoCheckForUpdate } from '@/features/updates/updates';
import { loadRules, useRules } from '@/rules/rulesStore';
import { useStoresHydrated } from '@/state/useStoresHydrated';
import { useTheme } from '@/ui/theme';

export default function RootLayout() {
  const theme = useTheme();
  const hydrated = useStoresHydrated();
  const rulesReady = useRules((s) => s.ready);

  useEffect(() => {
    void loadRules();
  }, []);

  useEffect(() => {
    if (hydrated) autoCheckForUpdate();
  }, [hydrated]);

  return (
    <>
      <StatusBar style="auto" />
      {hydrated && rulesReady ? (
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.background },
          }}
        />
      ) : (
        // Saved settings and cached rules load in a few milliseconds; don't open a page before they're in.
        <View style={{ flex: 1, backgroundColor: theme.background }} />
      )}
    </>
  );
}
