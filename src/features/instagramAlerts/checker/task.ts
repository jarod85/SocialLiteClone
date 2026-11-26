/**
 * The background check on iOS: an expo-background-task task. iOS decides when it
 * runs (at most every `minimumInterval` minutes, often less, never after the app was
 * swiped away), unlike Android's alarm. The task must be defined when the JavaScript
 * starts, so this file is imported from the app's root (via iosAlerts.ios.ts).
 */
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { runInBackground } from './checker';
import { useAlertsState } from './state';

export const TASK = 'lite-social-instagram-check';

TaskManager.defineTask(TASK, async () => {
  try {
    // Woken in the background: the saved state isn't loaded yet.
    await useAlertsState.persist.rehydrate();
    if (useAlertsState.getState().enabled) await runInBackground();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function schedule(minutes: number): Promise<void> {
  await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: minutes });
}

export async function unschedule(): Promise<void> {
  if (await TaskManager.isTaskRegisteredAsync(TASK)) await BackgroundTask.unregisterTaskAsync(TASK);
}
