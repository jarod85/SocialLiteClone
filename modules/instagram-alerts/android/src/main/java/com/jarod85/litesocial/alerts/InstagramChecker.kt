package com.jarod85.litesocial.alerts

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject

/**
 * One check for new Instagram messages and activity, run by CheckWorker in the
 * background and by "Check now" in Settings.
 *
 * Messages come from the inbox the web app uses; each unread conversation with
 * a message newer than the last check gets an alert, which is removed again
 * once the conversation has been read (in Lite Social or anywhere else).
 * Activity (likes, comments, follows, mentions) comes from the activity feed.
 * If the inbox can't be read, the unread-messages count is the fallback.
 */
object InstagramChecker {
  private const val TAG = "LiteSocialAlerts"
  /** More new activity items than this in one check become a single summary alert. */
  private const val MAX_ACTIVITY_ALERTS = 5

  data class Result(
    val loggedIn: Boolean,
    val messages: String,
    val activity: String,
    val newMessages: Int,
    val newActivity: Int,
    val unreadConversations: Int,
  ) {
    fun toJson(): String = JSONObject()
      .put("checkedAt", System.currentTimeMillis())
      .put("loggedIn", loggedIn)
      .put("messages", messages)
      .put("activity", activity)
      .put("newMessages", newMessages)
      .put("newActivity", newActivity)
      .put("unreadConversations", unreadConversations)
      .toString()
  }

  @Synchronized
  fun run(context: Context): Result {
    val result = try {
      check(context)
    } catch (e: Exception) {
      Log.w(TAG, "Check failed", e)
      Result(loggedIn = true, messages = describe(e), activity = describe(e), newMessages = 0, newActivity = 0, unreadConversations = 0)
    }
    AlertPrefs.setLastResult(context, result.toJson())
    Log.i(TAG, "Check: ${result.toJson()}")
    return result
  }

  private fun check(context: Context): Result {
    val api = InstagramApi.create(context)
      ?: return Result(false, "Not logged in", "Not logged in", 0, 0, 0)
    val canNotify = AlertNotifier.canPost(context)

    var newMessages = 0
    var unread = 0
    val messages = try {
      val counts = checkInbox(context, api, canNotify)
      newMessages = counts.first
      unread = counts.second
      "OK"
    } catch (e: InstagramApi.Failure.NotLoggedIn) {
      return Result(false, describe(e), describe(e), 0, 0, 0)
    } catch (e: Exception) {
      Log.w(TAG, "Inbox failed, trying the unread count", e)
      try {
        newMessages = checkBadge(context, api, canNotify)
        "Only the unread count is available (${describe(e)})"
      } catch (badge: Exception) {
        describe(e)
      }
    }

    var newActivity = 0
    val activity = try {
      newActivity = checkActivity(context, api, canNotify)
      "OK"
    } catch (e: Exception) {
      Log.w(TAG, "Activity failed", e)
      describe(e)
    }

    return Result(true, messages, activity, newMessages, newActivity, unread)
  }

  /** Returns (new message alerts, unread conversations). */
  private fun checkInbox(context: Context, api: InstagramApi, canNotify: Boolean): Pair<Int, Int> {
    val json = api.getJson("/api/v1/direct_v2/inbox/?persistentBadging=true&folder=&limit=20&thread_message_limit=1")
    val inbox = json.optJSONObject("inbox") ?: throw InstagramApi.Failure.BadResponse("no inbox")
    val threads = inbox.optJSONArray("threads") ?: JSONArray()
    val viewer = json.optJSONObject("viewer")?.let { it.optString("pk").ifEmpty { it.optString("pk_id") } }
      ?.takeIf { it.isNotEmpty() } ?: api.viewerId

    val watermark = AlertPrefs.dmWatermark(context)
    var newest = watermark
    val notified = AlertPrefs.notifiedThreads(context).toMutableSet()
    var alerts = 0
    var unread = 0

    for (i in 0 until threads.length()) {
      val thread = threads.optJSONObject(i) ?: continue
      val threadId = thread.optString("thread_id").takeIf { it.matches(Regex("\\d{1,40}")) } ?: continue
      val items = thread.optJSONArray("items") ?: JSONArray()
      val latest = items.optJSONObject(0)
      latest?.let { newest = maxOf(newest, timestamp(it)) }
      // Their latest message, if the latest one isn't yours.
      val incoming = latest?.takeIf { it.optString("user_id") != viewer }
      val seenAt = viewer?.let { thread.optJSONObject("last_seen_at")?.optJSONObject(it) }?.let { timestamp(it) } ?: 0L
      val isUnread = incoming != null && timestamp(incoming) > seenAt

      if (!isUnread) {
        if (notified.remove(threadId)) AlertNotifier.cancelMessage(context, threadId)
        continue
      }
      unread++
      if (thread.optBoolean("muted") || timestamp(incoming!!) <= watermark || !canNotify) continue

      val sender = findUser(thread.optJSONArray("users"), incoming.optString("user_id"))
      val senderName = sender?.let { it.optString("full_name").ifBlank { it.optString("username") } }?.ifBlank { null }
      val preview = preview(incoming)
      val isGroup = thread.optBoolean("is_group")
      val title = if (isGroup) thread.optString("thread_title").ifBlank { "Group chat" } else senderName ?: thread.optString("thread_title").ifBlank { "Instagram" }
      val text = if (isGroup && senderName != null) "$senderName: $preview" else preview
      AlertNotifier.postMessage(context, threadId, title, text, sender?.optString("profile_pic_url"), timestamp(incoming) / 1000)
      notified += threadId
      alerts++
    }

    AlertPrefs.setDmWatermark(context, newest)
    AlertPrefs.setNotifiedThreads(context, notified)
    if (unread == 0) AlertNotifier.cancelUnreadCount(context)
    return alerts to unread
  }

  private fun checkBadge(context: Context, api: InstagramApi, canNotify: Boolean): Int {
    val json = api.getJson("/api/v1/direct_v2/get_badge_count/?no_raven=1")
    if (!json.has("badge_count")) throw InstagramApi.Failure.BadResponse("no badge_count")
    val count = json.optInt("badge_count")
    val previous = AlertPrefs.badge(context)
    AlertPrefs.setBadge(context, count)
    return when {
      count == 0 -> {
        AlertNotifier.cancelUnreadCount(context)
        0
      }
      count > previous && canNotify -> {
        AlertNotifier.postUnreadCount(context, count)
        1
      }
      else -> 0
    }
  }

  private fun checkActivity(context: Context, api: InstagramApi, canNotify: Boolean): Int {
    val json = api.getJson("/api/v1/news/inbox/")
    if (!json.has("new_stories") && !json.has("old_stories")) throw InstagramApi.Failure.BadResponse("no activity")
    val watermark = AlertPrefs.activityWatermark(context)
    var newest = watermark

    data class Item(val id: String, val text: String, val picture: String?, val atMs: Long)
    val fresh = mutableListOf<Item>()
    for (key in listOf("new_stories", "old_stories")) {
      val stories = json.optJSONArray(key) ?: continue
      for (i in 0 until stories.length()) {
        val story = stories.optJSONObject(i) ?: continue
        val args = story.optJSONObject("args") ?: continue
        val atMs = (args.optDouble("timestamp", 0.0) * 1000).toLong()
        if (atMs <= 0) continue
        newest = maxOf(newest, atMs)
        if (atMs <= watermark) continue
        val text = args.optString("text").ifBlank { args.optString("rich_text") }.trim()
        if (text.isEmpty()) continue
        val id = story.optString("pk").ifEmpty { args.optString("tuuid") }.ifEmpty { atMs.toString() }
        fresh += Item(id, text, args.optString("profile_image").ifEmpty { null }, atMs)
      }
    }
    AlertPrefs.setActivityWatermark(context, newest)
    if (!canNotify || fresh.isEmpty()) return 0

    val distinct = fresh.distinctBy { it.id }.sortedBy { it.atMs }
    if (distinct.size > MAX_ACTIVITY_ALERTS) {
      val latest = distinct.last()
      AlertNotifier.postActivity(
        context,
        "summary",
        "${distinct.size} new notifications. Latest: ${latest.text}",
        latest.picture,
        latest.atMs,
      )
      return distinct.size
    }
    distinct.forEach { AlertNotifier.postActivity(context, it.id, it.text, it.picture, it.atMs) }
    return distinct.size
  }

  /** Instagram timestamps are microseconds, sometimes sent as strings. */
  private fun timestamp(item: JSONObject): Long = item.optString("timestamp").toLongOrNull() ?: 0L

  private fun findUser(users: JSONArray?, id: String): JSONObject? {
    if (users == null) return null
    for (i in 0 until users.length()) {
      val user = users.optJSONObject(i) ?: continue
      if (user.optString("pk") == id || user.optString("pk_id") == id || user.optString("strong_id__") == id) return user
    }
    return null
  }

  private fun preview(item: JSONObject): String {
    val text = when (item.optString("item_type")) {
      "text" -> item.optString("text")
      "like" -> "❤️"
      "link" -> item.optJSONObject("link")?.optString("text")
      "media" -> if (item.optJSONObject("media")?.optInt("media_type") == 2) "Sent a video" else "Sent a photo"
      "raven_media", "visual_media" -> "Sent a photo or video"
      "voice_media" -> "Sent a voice message"
      "animated_media" -> "Sent a GIF"
      "media_share", "xma_media_share" -> "Shared a post"
      "clip", "xma_clip" -> "Shared a reel"
      "story_share", "xma_story_share" -> "Shared a story"
      "reel_share" -> item.optJSONObject("reel_share")?.optString("text")?.ifBlank { null } ?: "Replied to your story"
      "profile" -> "Shared a profile"
      "action_log" -> item.optJSONObject("action_log")?.optString("description")
      else -> null
    }
    return text?.trim()?.ifEmpty { null } ?: "New message"
  }

  private fun describe(e: Exception): String = when (e) {
    is InstagramApi.Failure -> e.message ?: "Error"
    is java.net.UnknownHostException, is java.net.SocketTimeoutException, is java.net.ConnectException -> "No connection"
    else -> e.message?.take(120) ?: e.javaClass.simpleName
  }
}
