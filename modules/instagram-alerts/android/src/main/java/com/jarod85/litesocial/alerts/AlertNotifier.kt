package com.jarod85.litesocial.alerts

import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Shader
import android.net.Uri
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.graphics.drawable.IconCompat
import java.net.HttpURLConnection
import java.net.URL

/** Lite Social's own notifications for Instagram messages and activity. */
object AlertNotifier {
  private const val MESSAGES_CHANNEL = "instagram_messages"
  private const val ACTIVITY_CHANNEL = "instagram_activity"
  private const val MESSAGES_GROUP = "instagram_messages"
  private const val ACTIVITY_GROUP = "instagram_activity"
  private const val ACCENT = 0xFFD62976.toInt()
  private const val DM_TAG = "ig-dm:"
  private const val ACTIVITY_TAG = "ig-activity:"
  private const val BADGE_TAG = "ig-dm-badge"
  private const val TEST_TAG = "ig-test"

  enum class Target(val open: String) { THREAD("thread"), INBOX("messages"), ACTIVITY("activity") }

  fun ensureChannels(context: Context) {
    val manager = context.getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(MESSAGES_CHANNEL) == null) {
      manager.createNotificationChannel(
        NotificationChannel(MESSAGES_CHANNEL, "Instagram messages", NotificationManager.IMPORTANCE_HIGH).apply {
          description = "New direct messages. Tapping one opens the conversation in Lite Social."
        },
      )
    }
    if (manager.getNotificationChannel(ACTIVITY_CHANNEL) == null) {
      manager.createNotificationChannel(
        NotificationChannel(ACTIVITY_CHANNEL, "Instagram activity", NotificationManager.IMPORTANCE_DEFAULT).apply {
          description = "Likes, comments, follows and mentions. Tapping one opens your activity in Lite Social."
        },
      )
    }
  }

  /**
   * False when the user turned off Lite Social's notifications, hasn't allowed
   * them yet, or turned off the "Instagram messages" category.
   */
  fun canPost(context: Context): Boolean {
    if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false
    val messages = context.getSystemService(NotificationManager::class.java).getNotificationChannel(MESSAGES_CHANNEL)
    return messages == null || messages.importance != NotificationManager.IMPORTANCE_NONE
  }

  /** One message in a conversation alert. */
  data class Line(val sender: String, val text: String, val atMs: Long)

  /** A sample message alert, from Settings, to see that alerts show up and how. */
  fun postTest(context: Context) {
    val now = System.currentTimeMillis()
    val builder = conversation(
      context,
      "Lite Social",
      isGroup = false,
      listOf(Line("Lite Social", "Instagram messages will show up like this: who wrote, and what they said.", now)),
      avatar = null,
    ).setContentIntent(open(context, Target.INBOX, null, now))
    notify(context, TEST_TAG, builder)
  }

  /**
   * A conversation's new messages, as Android shows chats: the sender's name
   * and picture with each message (up to the last few), the group's name for
   * group chats. Tapping opens the conversation.
   */
  fun postConversation(context: Context, threadId: String, title: String, isGroup: Boolean, lines: List<Line>, picture: String?) {
    if (lines.isEmpty()) return
    val latest = lines.last()
    val builder = conversation(context, title, isGroup, lines, loadAvatar(picture))
      .setContentIntent(open(context, Target.THREAD, threadId, latest.atMs))
    notify(context, DM_TAG + threadId, builder)
  }

  private fun conversation(context: Context, title: String, isGroup: Boolean, lines: List<Line>, avatar: Bitmap?): NotificationCompat.Builder {
    val latest = lines.last()
    val style = NotificationCompat.MessagingStyle(Person.Builder().setName("You").build())
    if (isGroup) style.setConversationTitle(title).setGroupConversation(true)
    val people = mutableMapOf<String, Person>()
    for (line in lines) {
      val person = people.getOrPut(line.sender) {
        Person.Builder().setName(line.sender).apply {
          // One picture per alert: the latest sender's.
          if (avatar != null && line.sender == latest.sender) setIcon(IconCompat.createWithBitmap(avatar))
        }.build()
      }
      style.addMessage(line.text, line.atMs, person)
    }
    return base(context, MESSAGES_CHANNEL, MESSAGES_GROUP, latest.atMs)
      .setContentTitle(title)
      .setContentText(if (isGroup) "${latest.sender}: ${latest.text}" else latest.text)
      .setStyle(style)
      .setCategory(NotificationCompat.CATEGORY_MESSAGE)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setPublicVersion(publicVersion(context, MESSAGES_CHANNEL, "New message"))
      .apply { if (avatar != null) setLargeIcon(avatar) }
  }

  /** Fallback when only the unread count is known. */
  fun postUnreadCount(context: Context, count: Int) {
    val text = if (count == 1) "1 unread message" else "$count unread messages"
    val builder = base(context, MESSAGES_CHANNEL, MESSAGES_GROUP, System.currentTimeMillis())
      .setContentTitle("Instagram")
      .setContentText(text)
      .setCategory(NotificationCompat.CATEGORY_MESSAGE)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setContentIntent(open(context, Target.INBOX, null, System.currentTimeMillis()))
    notify(context, BADGE_TAG, builder)
  }

  fun postActivity(context: Context, id: String, text: String, picture: String?, atMs: Long) {
    val builder = base(context, ACTIVITY_CHANNEL, ACTIVITY_GROUP, atMs)
      .setContentTitle("Instagram")
      .setContentText(text)
      .setStyle(NotificationCompat.BigTextStyle().bigText(text))
      .setCategory(NotificationCompat.CATEGORY_SOCIAL)
      .setContentIntent(open(context, Target.ACTIVITY, null, atMs))
      .setPublicVersion(publicVersion(context, ACTIVITY_CHANNEL, "New activity"))
    loadAvatar(picture)?.let { builder.setLargeIcon(it) }
    notify(context, ACTIVITY_TAG + id, builder)
  }

  fun cancelMessage(context: Context, threadId: String) {
    NotificationManagerCompat.from(context).cancel(DM_TAG + threadId, 0)
  }

  fun cancelUnreadCount(context: Context) {
    NotificationManagerCompat.from(context).cancel(BADGE_TAG, 0)
  }

  private fun base(context: Context, channel: String, group: String, whenMs: Long): NotificationCompat.Builder {
    ensureChannels(context)
    return NotificationCompat.Builder(context, channel)
      .setSmallIcon(if (channel == MESSAGES_CHANNEL) R.drawable.lite_social_message else R.drawable.lite_social_activity)
      .setColor(ACCENT)
      .setSubText("Instagram")
      .setWhen(whenMs)
      .setShowWhen(true)
      .setAutoCancel(true)
      .setGroup(group)
      // Lock screen: follows the system's "hide sensitive content" setting.
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
  }

  private fun publicVersion(context: Context, channel: String, text: String) =
    NotificationCompat.Builder(context, channel)
      .setSmallIcon(if (channel == MESSAGES_CHANNEL) R.drawable.lite_social_message else R.drawable.lite_social_activity)
      .setColor(ACCENT)
      .setContentTitle("Instagram")
      .setContentText(text)
      .build()

  /**
   * Opens Instagram in Lite Social (scheme from app.json). Only named targets
   * and a numeric thread id go into the link; src/platforms/registry.ts turns
   * them into a path. `at` makes every alert a distinct link, so tapping a
   * second one still navigates.
   */
  private fun open(context: Context, target: Target, threadId: String?, at: Long): PendingIntent {
    val uri = Uri.Builder().scheme("litesocial").authority("browse").appendPath("instagram")
      .appendQueryParameter("open", target.open)
      .apply { if (threadId != null) appendQueryParameter("thread", threadId) }
      .appendQueryParameter("at", at.toString())
      .build()
    return PendingIntent.getActivity(
      context,
      uri.toString().hashCode(),
      Intent(Intent.ACTION_VIEW, uri).setPackage(context.packageName),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  @SuppressLint("MissingPermission") // Callers check canPost(), which covers POST_NOTIFICATIONS.
  private fun notify(context: Context, tag: String, builder: NotificationCompat.Builder) {
    NotificationManagerCompat.from(context).notify(tag, 0, builder.build())
  }

  /** The sender's profile picture from Instagram's CDN, cropped round. Optional: null on any problem. */
  private fun loadAvatar(url: String?): Bitmap? {
    if (url.isNullOrEmpty() || !url.startsWith("https://")) return null
    return try {
      val connection = URL(url).openConnection() as HttpURLConnection
      connection.connectTimeout = 8_000
      connection.readTimeout = 8_000
      val bitmap = connection.inputStream.use { BitmapFactory.decodeStream(it) } ?: return null
      connection.disconnect()
      circle(bitmap)
    } catch (_: Exception) {
      null
    }
  }

  private fun circle(source: Bitmap): Bitmap {
    val size = minOf(source.width, source.height)
    val output = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      shader = BitmapShader(source, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP)
    }
    Canvas(output).drawCircle(size / 2f, size / 2f, size / 2f, paint)
    return output
  }
}
