package com.jarod85.litesocial.alerts

import android.content.Context
import android.content.SharedPreferences

/**
 * Settings and bookkeeping for Instagram alerts, readable by the background
 * check while the app isn't running.
 *
 * Watermarks remember the newest message and activity already handled, so
 * each check only alerts about what's new since the last one.
 */
object AlertPrefs {
  private const val FILE = "lite_social_instagram_alerts"
  private const val KEY_ENABLED = "enabled"
  private const val KEY_INTERVAL = "interval_minutes"
  private const val KEY_DM_WATERMARK = "dm_watermark_us"
  private const val KEY_ACTIVITY_WATERMARK = "activity_watermark_ms"
  private const val KEY_BADGE = "dm_badge"
  private const val KEY_NOTIFIED_THREADS = "notified_threads"
  private const val KEY_LAST_RESULT = "last_result"

  const val DEFAULT_INTERVAL_MINUTES = 15
  /** Android runs periodic background work at most every 15 minutes. */
  val INTERVAL_OPTIONS = listOf(15, 30, 60)

  private fun prefs(context: Context): SharedPreferences =
    context.getSharedPreferences(FILE, Context.MODE_PRIVATE)

  fun isEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_ENABLED, false)

  fun setEnabled(context: Context, enabled: Boolean) {
    prefs(context).edit().putBoolean(KEY_ENABLED, enabled).apply()
  }

  fun intervalMinutes(context: Context): Int =
    prefs(context).getInt(KEY_INTERVAL, DEFAULT_INTERVAL_MINUTES).takeIf { it in INTERVAL_OPTIONS }
      ?: DEFAULT_INTERVAL_MINUTES

  fun setIntervalMinutes(context: Context, minutes: Int) {
    prefs(context).edit().putInt(KEY_INTERVAL, minutes).apply()
  }

  /** Newest direct message handled so far, in Instagram's microsecond timestamps. */
  fun dmWatermark(context: Context): Long = prefs(context).getLong(KEY_DM_WATERMARK, 0)

  fun setDmWatermark(context: Context, us: Long) {
    prefs(context).edit().putLong(KEY_DM_WATERMARK, us).apply()
  }

  /** Newest activity item (likes, comments, follows) handled so far, in milliseconds. */
  fun activityWatermark(context: Context): Long = prefs(context).getLong(KEY_ACTIVITY_WATERMARK, 0)

  fun setActivityWatermark(context: Context, ms: Long) {
    prefs(context).edit().putLong(KEY_ACTIVITY_WATERMARK, ms).apply()
  }

  /** Last unread-messages count from the fallback badge endpoint. */
  fun badge(context: Context): Int = prefs(context).getInt(KEY_BADGE, 0)

  fun setBadge(context: Context, count: Int) {
    prefs(context).edit().putInt(KEY_BADGE, count).apply()
  }

  /** Threads with a message alert showing, so it can be removed once the message is read. */
  fun notifiedThreads(context: Context): Set<String> =
    prefs(context).getStringSet(KEY_NOTIFIED_THREADS, emptySet())?.toSet() ?: emptySet()

  fun setNotifiedThreads(context: Context, threads: Set<String>) {
    prefs(context).edit().putStringSet(KEY_NOTIFIED_THREADS, threads).apply()
  }

  /** Summary of the last check (JSON), shown in Settings. */
  fun lastResult(context: Context): String? = prefs(context).getString(KEY_LAST_RESULT, null)

  fun setLastResult(context: Context, json: String) {
    prefs(context).edit().putString(KEY_LAST_RESULT, json).apply()
  }

  /** Start from "now": only what arrives after alerts were switched on is announced. */
  fun resetWatermarks(context: Context) {
    val now = System.currentTimeMillis()
    prefs(context).edit()
      .putLong(KEY_DM_WATERMARK, now * 1000)
      .putLong(KEY_ACTIVITY_WATERMARK, now)
      .putInt(KEY_BADGE, Int.MAX_VALUE) // The first badge read becomes the baseline.
      .putStringSet(KEY_NOTIFIED_THREADS, emptySet())
      .apply()
  }
}
