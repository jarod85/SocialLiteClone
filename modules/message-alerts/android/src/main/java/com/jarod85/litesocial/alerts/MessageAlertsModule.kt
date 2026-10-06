package com.jarod85.litesocial.alerts

import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** JS side: src/features/messageAlerts. */
class MessageAlertsModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("MessageAlerts")

    Function("isEnabled") { AlertPrefs.isEnabled(context) }

    Function("setEnabled") { enabled: Boolean ->
      AlertPrefs.setEnabled(context, enabled)
      if (enabled) MessageAlerts.ensureChannel(context)
    }

    Function("hasListenerAccess") {
      NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName)
    }

    Function("canPostNotifications") { MessageAlerts.canPost(context) }

    /** Android's Notification access screen, on Lite Social's entry where the OS supports it. */
    Function("openListenerSettings") {
      val component = ComponentName(context, MessageListenerService::class.java).flattenToString()
      val detail = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS)
          .putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, component)
      } else {
        null
      }
      startFirst(detail, Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
    }

    /** Lite Social's App info page: notification settings, and "Allow restricted settings" for sideloaded installs. */
    Function("openAppSettings") {
      startFirst(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}")))
    }
  }

  private fun startFirst(vararg intents: Intent?) {
    for (intent in intents) {
      if (intent == null) continue
      try {
        context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        return
      } catch (_: ActivityNotFoundException) {
        // Try the next, more general screen.
      }
    }
  }
}
