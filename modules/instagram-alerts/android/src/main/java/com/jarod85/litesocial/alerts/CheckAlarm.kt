package com.jarod85.litesocial.alerts

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/**
 * The main trigger for background checks.
 *
 * While the phone lies still with the screen off (Doze), Android runs no
 * WorkManager jobs at all, so CheckWorker alone can leave alerts hours late,
 * by when the message has often been read elsewhere and the alert is dropped.
 * Alarms set with setAndAllowWhileIdle still fire then (at most every 9
 * minutes per app), and an app exempt from battery optimization may use the
 * network during them. The check runs right here, kept alive with goAsync().
 * The alarm is one-shot and re-armed every time; it's also re-armed after a
 * reboot or an app update, which clear alarms.
 */
class CheckAlarm : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val app = context.applicationContext
    if (!AlertPrefs.isEnabled(app)) return
    arm(app)
    if (intent.action != ACTION_CHECK) return

    // Without the battery exemption there's no network while dozing; CheckWorker covers the next maintenance window.
    val power = app.getSystemService(PowerManager::class.java)
    if (power.isDeviceIdleMode && !power.isIgnoringBatteryOptimizations(app.packageName)) return

    val pending = goAsync()
    val finished = AtomicBoolean(false)
    val finish = { if (finished.compareAndSet(false, true)) pending.finish() }
    thread(name = "LiteSocialAlerts") {
      try {
        InstagramChecker.runInBackground(app)
      } finally {
        finish()
      }
    }
    // A broadcast must finish within a minute; a check stuck on a slow network is given up before that.
    Handler(Looper.getMainLooper()).postDelayed(finish, BUDGET_MS)
  }

  companion object {
    private const val ACTION_CHECK = "com.jarod85.litesocial.alerts.CHECK"
    private const val BUDGET_MS = 50_000L

    /** (Re)schedules the next check one interval from now. */
    fun arm(context: Context) {
      val delay = AlertPrefs.intervalMinutes(context) * 60_000L
      context.getSystemService(AlarmManager::class.java)
        .setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + delay, pendingIntent(context))
    }

    fun disarm(context: Context) {
      context.getSystemService(AlarmManager::class.java).cancel(pendingIntent(context))
    }

    private fun pendingIntent(context: Context): PendingIntent =
      PendingIntent.getBroadcast(
        context,
        0,
        Intent(context, CheckAlarm::class.java).setAction(ACTION_CHECK),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
  }
}
