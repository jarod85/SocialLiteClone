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
  /** Until 1.5.2: microseconds, Instagram's REST timestamps. Read once to carry the watermark over. */
  private const val KEY_DM_WATERMARK_US = "dm_watermark_us"
  private const val KEY_DM_WATERMARK = "dm_watermark_ms"
  private const val KEY_ACTIVITY_WATERMARK = "activity_watermark_ms"
  private const val KEY_BADGE = "dm_badge"
  private const val KEY_NOTIFIED_THREADS = "notified_threads"
  private const val KEY_LAST_RESULT = "last_result"
  private const val KEY_LAST_CHECK_AT = "last_check_at"
  private const val KEY_LAST_BACKGROUND_AT = "last_background_at"
  private const val KEY_WEB_TOKENS = "web_tokens"
  private const val KEY_WEB_TOKENS_OWNER = "web_tokens_owner"
  private const val KEY_WEB_TOKENS_AT = "web_tokens_at"
  private const val KEY_WWW_CLAIM = "www_claim"
  private const val KEY_INBOX_READER = "inbox_reader"
  private const val KEY_INBOX_BASELINED = "inbox_baselined"

  /** instagram.com's page tokens are fetched again after this long. */
  private const val WEB_TOKENS_MAX_AGE_MS = 6 * 60 * 60_000L

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

  /** Newest direct message handled so far, in milliseconds. */
  fun dmWatermark(context: Context): Long {
    val p = prefs(context)
    if (p.contains(KEY_DM_WATERMARK)) return p.getLong(KEY_DM_WATERMARK, 0)
    return p.getLong(KEY_DM_WATERMARK_US, 0) / 1000
  }

  fun setDmWatermark(context: Context, ms: Long) {
    prefs(context).edit().putLong(KEY_DM_WATERMARK, ms).remove(KEY_DM_WATERMARK_US).apply()
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

  /** When the last check of any kind ran (ms), so overlapping triggers don't check twice in a row. */
  fun lastCheckAt(context: Context): Long = prefs(context).getLong(KEY_LAST_CHECK_AT, 0)

  fun setLastCheckAt(context: Context, ms: Long) {
    prefs(context).edit().putLong(KEY_LAST_CHECK_AT, ms).apply()
  }

  /** When a background check last ran (ms), shown in Settings to tell whether Android lets them run. 0: never. */
  fun lastBackgroundAt(context: Context): Long = prefs(context).getLong(KEY_LAST_BACKGROUND_AT, 0)

  fun setLastBackgroundAt(context: Context, ms: Long) {
    prefs(context).edit().putLong(KEY_LAST_BACKGROUND_AT, ms).apply()
  }

  /** instagram.com's page tokens (JSON, see InstagramApi.tokens) for this account, if fetched recently. */
  fun webTokens(context: Context, owner: String?): String? {
    val p = prefs(context)
    val fresh = System.currentTimeMillis() - p.getLong(KEY_WEB_TOKENS_AT, 0) in 0 until WEB_TOKENS_MAX_AGE_MS
    if (!fresh || owner == null || p.getString(KEY_WEB_TOKENS_OWNER, null) != owner) return null
    return p.getString(KEY_WEB_TOKENS, null)
  }

  /** Null json forgets them. */
  fun setWebTokens(context: Context, owner: String?, json: String?) {
    prefs(context).edit()
      .putString(KEY_WEB_TOKENS, json)
      .putString(KEY_WEB_TOKENS_OWNER, owner)
      .putLong(KEY_WEB_TOKENS_AT, if (json == null) 0 else System.currentTimeMillis())
      .apply()
  }

  /** The X-IG-WWW-Claim value Instagram last handed out, sent back like the site does. */
  fun wwwClaim(context: Context): String? = prefs(context).getString(KEY_WWW_CLAIM, null)

  fun setWwwClaim(context: Context, claim: String) {
    prefs(context).edit().putString(KEY_WWW_CLAIM, claim).apply()
  }

  /** The way of reading the message inbox that worked last time, tried first next time. */
  fun inboxReader(context: Context): String? = prefs(context).getString(KEY_INBOX_READER, null)

  fun setInboxReader(context: Context, reader: String) {
    prefs(context).edit().putString(KEY_INBOX_READER, reader).apply()
  }

  /**
   * Whether the inbox has been read once since alerts were turned on (or since
   * this app version), so the message watermark is meaningful. Until then a
   * check only notes the newest message, rather than alerting about every
   * conversation since alerts were turned on.
   */
  fun inboxBaselined(context: Context): Boolean = prefs(context).getBoolean(KEY_INBOX_BASELINED, false)

  fun setInboxBaselined(context: Context) {
    prefs(context).edit().putBoolean(KEY_INBOX_BASELINED, true).apply()
  }

  /** Start from "now": only what arrives after alerts were switched on is announced. */
  fun resetWatermarks(context: Context) {
    val now = System.currentTimeMillis()
    prefs(context).edit()
      .putLong(KEY_DM_WATERMARK, now)
      .remove(KEY_DM_WATERMARK_US)
      .putLong(KEY_ACTIVITY_WATERMARK, now)
      .putInt(KEY_BADGE, Int.MAX_VALUE) // The first badge read becomes the baseline.
      .putStringSet(KEY_NOTIFIED_THREADS, emptySet())
      .putBoolean(KEY_INBOX_BASELINED, true)
      .apply()
  }
}
