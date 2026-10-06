package com.jarod85.litesocial.alerts

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.service.notification.StatusBarNotification
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/** Posts Lite Social's own notification for an Instagram message. */
object MessageAlerts {
  private const val CHANNEL_ID = "instagram_messages"
  private const val GROUP = "instagram_messages"
  private const val ACCENT = 0xFFD62976.toInt()

  /**
   * Opens Instagram's inbox in Lite Social. The scheme is app.json's "scheme";
   * `at` makes every alert a distinct link, so tapping a second one still navigates.
   */
  private fun messagesUri(postedAt: Long): Uri = Uri.parse("litesocial://browse/instagram?open=messages&at=$postedAt")

  fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    val channel = NotificationChannel(CHANNEL_ID, "Instagram messages", NotificationManager.IMPORTANCE_HIGH)
    channel.description = "New Instagram direct messages. Tapping one opens your messages in Lite Social."
    manager.createNotificationChannel(channel)
  }

  /** False when the user turned off Lite Social's notifications (or this channel), or hasn't allowed them yet. */
  fun canPost(context: Context): Boolean {
    val manager = NotificationManagerCompat.from(context)
    if (!manager.areNotificationsEnabled()) return false
    ensureChannel(context)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = manager.getNotificationChannel(CHANNEL_ID) ?: return false
      if (channel.importance == NotificationManager.IMPORTANCE_NONE) return false
    }
    return true
  }

  @SuppressLint("MissingPermission") // canPost() checked areNotificationsEnabled(), which covers POST_NOTIFICATIONS.
  fun post(context: Context, sbn: StatusBarNotification) {
    val source = sbn.notification
    val extras = source.extras
    val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.takeIf { it.isNotBlank() } ?: "Instagram"
    val text = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.takeIf { it.isNotBlank() }
      ?: extras.getCharSequence(Notification.EXTRA_TEXT)?.takeIf { it.isNotBlank() }
      ?: "New message"

    val open = PendingIntent.getActivity(
      context,
      sbn.key.hashCode(),
      Intent(Intent.ACTION_VIEW, messagesUri(sbn.postTime)).setPackage(context.packageName),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    val builder = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(R.drawable.lite_social_message)
      .setColor(ACCENT)
      .setSubText("Instagram")
      .setContentTitle(title)
      .setContentText(text)
      .setStyle(NotificationCompat.BigTextStyle().bigText(text))
      .setCategory(NotificationCompat.CATEGORY_MESSAGE)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setWhen(source.`when`)
      .setShowWhen(true)
      .setContentIntent(open)
      .setAutoCancel(true)
      .setGroup(GROUP)
      // Lock screen: follows the system's "hide sensitive content" setting.
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
      .setPublicVersion(
        NotificationCompat.Builder(context, CHANNEL_ID)
          .setSmallIcon(R.drawable.lite_social_message)
          .setColor(ACCENT)
          .setContentTitle("Instagram")
          .setContentText("New message")
          .build(),
      )

    source.getLargeIcon()?.let { builder.setLargeIcon(it) } // The sender's profile picture.

    // Instagram's inline "Reply" still goes to Instagram, so you can answer without opening anything.
    source.actions
      ?.filter { !it.remoteInputs.isNullOrEmpty() }
      ?.forEach { builder.addAction(NotificationCompat.Action.Builder.fromAndroidAction(it).build()) }

    // Same Instagram notification key -> same tag, so an updated conversation replaces ours.
    NotificationManagerCompat.from(context).notify(sbn.key, 0, builder.build())
  }
}
