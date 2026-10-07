package com.jarod85.litesocial.alerts

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import android.webkit.CookieManager
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** JS side: src/features/instagramAlerts. */
class InstagramAlertsModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("InstagramAlerts")

    Function("isEnabled") { AlertPrefs.isEnabled(context) }

    Function("setEnabled") { enabled: Boolean ->
      AlertPrefs.setEnabled(context, enabled)
      if (enabled) {
        AlertPrefs.resetWatermarks(context)
        AlertNotifier.ensureChannels(context)
        CheckWorker.schedule(context)
      } else {
        CheckWorker.cancel(context)
      }
    }

    Function("getIntervalMinutes") { AlertPrefs.intervalMinutes(context) }

    Function("setIntervalMinutes") { minutes: Int ->
      AlertPrefs.setIntervalMinutes(context, minutes)
      if (AlertPrefs.isEnabled(context)) CheckWorker.schedule(context)
    }

    /** JSON from the last check, or null before the first one. */
    Function("getLastResult") { AlertPrefs.lastResult(context) }

    /** Runs a check now and returns its JSON summary. Network and cookie work stay off the JS thread. */
    AsyncFunction("checkNow") Coroutine { ->
      withContext(Dispatchers.IO) { InstagramChecker.run(context).toJson() }
    }

    /** Whether the in-app browser holds an Instagram login. The cookie store lives on the main thread. */
    AsyncFunction("hasSession") {
      val cookies = CookieManager.getInstance().getCookie("https://www.instagram.com") ?: ""
      !InstagramApi.cookieValue(cookies, "sessionid").isNullOrEmpty()
    }.runOnQueue(Queues.MAIN)

    Function("canPostNotifications") { AlertNotifier.canPost(context) }

    Function("isIgnoringBatteryOptimizations") {
      context.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(context.packageName)
    }

    /** Android's "Let Lite Social run in the background?" dialog, so checks aren't held back for hours. */
    Function("requestIgnoreBatteryOptimizations") {
      @SuppressLint("BatteryLife") // Personal app; the user asks for this in Settings.
      val request = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}"))
      startFirst(request, Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
    }

    /** Lite Social's App info page: notification and battery settings. */
    Function("openAppSettings") {
      startFirst(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}")))
    }
  }

  private fun startFirst(vararg intents: Intent) {
    for (intent in intents) {
      try {
        context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        return
      } catch (_: ActivityNotFoundException) {
        // Try the next, more general screen.
      }
    }
  }
}
