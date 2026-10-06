package com.jarod85.litesocial.alerts

import android.content.Context

/** The on/off switch from Lite Social's settings, readable by the listener while the app isn't running. */
object AlertPrefs {
  private const val FILE = "lite_social_message_alerts"
  private const val KEY_ENABLED = "enabled"

  fun isEnabled(context: Context): Boolean =
    context.getSharedPreferences(FILE, Context.MODE_PRIVATE).getBoolean(KEY_ENABLED, false)

  fun setEnabled(context: Context, enabled: Boolean) {
    context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putBoolean(KEY_ENABLED, enabled).apply()
  }
}
