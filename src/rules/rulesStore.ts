/**
 * Where the active rules come from:
 *   1. The copy bundled into the app (rules/rules.json): always there.
 *   2. The last good download, cached on the device.
 *   3. A fresh download from RULES_URL, checked once per launch and on demand.
 * Whichever valid copy has the highest `revision` wins. A download that fails
 * or doesn't validate changes nothing. Fixing breakage after a site redesign
 * is a matter of editing rules/rules.json, bumping `revision` and pushing.
 *
 * The request is a plain GET for a public file: no cookies, no user data.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import type { RulesFile } from '@/core/types';

import bundledJson from '../../rules/rules.json';
import { validateRules } from './schema';

export const RULES_URL =
  process.env.EXPO_PUBLIC_RULES_URL || 'https://raw.githubusercontent.com/jarod85/SocialLiteClone/main/rules/rules.json';

const CACHE_KEY = 'lite-social.rules-cache.v1';
const FETCH_TIMEOUT_MS = 10_000;

export type RulesSource = 'bundled' | 'cached' | 'remote';

const bundledResult = validateRules(bundledJson);
/** Tests guarantee the bundled file is valid; if it somehow isn't, run unfiltered rather than crash. */
export const BUNDLED_RULES: RulesFile = bundledResult.ok
  ? bundledResult.rules
  : { schemaVersion: 1, revision: 0, updated: '', minEngineVersion: 1, platforms: {} };

interface RulesState {
  rules: RulesFile;
  source: RulesSource;
  ready: boolean;
  checking: boolean;
  lastCheckedAt: number | null;
  lastError: string | null;
}

export const useRules = create<RulesState>(() => ({
  rules: BUNDLED_RULES,
  source: 'bundled',
  ready: false,
  checking: false,
  lastCheckedAt: null,
  lastError: null,
}));

interface CacheEntry {
  rules: unknown;
  fetchedAt: number;
}

/** Load the cached copy (if newer than the bundled one), then check for updates in the background. */
export async function loadRules(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (raw) {
      const cache = JSON.parse(raw) as CacheEntry;
      const result = validateRules(cache.rules);
      useRules.setState({ lastCheckedAt: cache.fetchedAt });
      if (result.ok && result.rules.revision > BUNDLED_RULES.revision) {
        useRules.setState({ rules: result.rules, source: 'cached' });
      }
    }
  } catch {
    // Corrupt cache: ignore it, the bundled rules are already active.
  }
  useRules.setState({ ready: true });
  void refreshRules();
}

export async function refreshRules(): Promise<void> {
  if (useRules.getState().checking) return;
  useRules.setState({ checking: true });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(RULES_URL, {
      signal: controller.signal,
      credentials: 'omit',
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json: unknown = await response.json();
    const result = validateRules(json);
    if (!result.ok) throw new Error(result.error);

    const fetchedAt = Date.now();
    if (result.rules.revision >= useRules.getState().rules.revision) {
      useRules.setState({ rules: result.rules, source: 'remote' });
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ rules: json, fetchedAt } satisfies CacheEntry));
    }
    useRules.setState({ lastCheckedAt: fetchedAt, lastError: null });
  } catch (error) {
    useRules.setState({
      lastError: controller.signal.aborted ? 'Timed out' : error instanceof Error ? error.message : 'Unknown error',
    });
  } finally {
    clearTimeout(timeout);
    useRules.setState({ checking: false });
  }
}
