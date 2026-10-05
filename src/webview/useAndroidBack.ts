import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { BackHandler, Platform } from 'react-native';

/**
 * Route Android's hardware/gesture back to the WebView's own history while this
 * screen is focused. `handler` returns true when it consumed the press; false
 * lets the router pop the screen as usual.
 */
export function useAndroidBack(handler: () => boolean) {
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return;
      const subscription = BackHandler.addEventListener('hardwareBackPress', handler);
      return () => subscription.remove();
    }, [handler]),
  );
}
