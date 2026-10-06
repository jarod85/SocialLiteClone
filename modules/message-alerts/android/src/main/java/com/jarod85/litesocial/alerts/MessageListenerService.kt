package com.jarod85.litesocial.alerts

import android.app.Notification
import android.os.Build
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/**
 * Swaps Instagram's message notifications for Lite Social ones, so tapping a
 * message alert opens the inbox in Lite Social instead of the Instagram app
 * (and its Reels tab).
 *
 * The system delivers every app's notifications here; anything not from
 * Instagram is ignored on the first line. Nothing is stored or sent anywhere:
 * the sender and text go straight into the replacement notification.
 *
 * Fails open: Instagram's notification is only removed after ours was posted,
 * and never when Lite Social isn't allowed to post, so no message alert is lost.
 */
class MessageListenerService : NotificationListenerService() {
  override fun onNotificationPosted(sbn: StatusBarNotification) {
    try {
      handle(sbn)
    } catch (_: Exception) {
      // Leave Instagram's notification as it is.
    }
  }

  private fun handle(sbn: StatusBarNotification) {
    if (sbn.packageName !in SOURCE_PACKAGES) return
    if (!AlertPrefs.isEnabled(this)) return
    val notification = sbn.notification
    if (!isMessage(notification)) return
    if (!MessageAlerts.canPost(this)) return

    if (notification.flags and Notification.FLAG_GROUP_SUMMARY != 0) {
      // The "N new messages" bundle header. Android groups ours by itself.
      cancelNotification(sbn.key)
      return
    }
    MessageAlerts.post(this, sbn)
    cancelNotification(sbn.key)
  }

  /** Direct messages only. Likes, comments and follows are left to Instagram's own settings. */
  private fun isMessage(notification: Notification): Boolean {
    if (notification.category == Notification.CATEGORY_MESSAGE) return true
    if (notification.extras?.containsKey(Notification.EXTRA_MESSAGES) == true) return true
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = notification.channelId?.lowercase() ?: return false
      return "direct" in channel || "message" in channel
    }
    return false
  }

  companion object {
    private val SOURCE_PACKAGES = setOf("com.instagram.android", "com.instagram.lite")
  }
}
