package com.jarod85.litesocial.alerts

import android.content.Context
import android.util.Log
import org.json.JSONObject

/**
 * One check for new Instagram messages and activity, run by CheckAlarm and
 * CheckWorker in the background and by "Check now" in Settings.
 *
 * Messages come from the inbox instagram.com reads (DirectInbox); each
 * conversation with messages newer than the last check gets an alert showing
 * who wrote what, which is removed again once the conversation has been read
 * (in Lite Social or anywhere else). Instagram's unread count says when
 * everything is read, and is the fallback alert if the inbox can't be read.
 * Activity (likes, comments, follows, mentions) comes from the activity feed.
 */
object InstagramChecker {
  private const val TAG = "LiteSocialAlerts"
  /** More new activity items than this in one check become a single summary alert. */
  private const val MAX_ACTIVITY_ALERTS = 5
  /** Messages shown in one conversation's alert. */
  private const val MAX_MESSAGE_LINES = 5
  /** CheckAlarm and CheckWorker can fire close together; the second one then skips. */
  private const val MIN_BACKGROUND_GAP_MS = 5 * 60_000L

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

  /** A check from CheckAlarm or CheckWorker, unless one just ran. */
  @Synchronized
  fun runInBackground(context: Context) {
    val now = System.currentTimeMillis()
    if (now - AlertPrefs.lastCheckAt(context) in 0 until MIN_BACKGROUND_GAP_MS) return
    AlertPrefs.setLastBackgroundAt(context, now)
    run(context)
  }

  @Synchronized
  fun run(context: Context): Result {
    AlertPrefs.setLastCheckAt(context, System.currentTimeMillis())
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

    // Instagram's unread count: cheap, and the fallback when the inbox can't be read.
    var badgeError: Exception? = null
    val badge = try {
      val json = api.getJson("/api/v1/direct_v2/get_badge_count/?no_raven=1")
      if (json.has("badge_count")) json.optInt("badge_count") else throw InstagramApi.Failure.BadResponse("no badge_count")
    } catch (e: InstagramApi.Failure.NotLoggedIn) {
      return Result(false, describe(e), describe(e), 0, 0, 0)
    } catch (e: Exception) {
      Log.w(TAG, "Unread count failed", e)
      badgeError = e
      null
    }

    var newMessages = 0
    var unread = 0
    val messages = try {
      val (threads, reader) = readInbox(context, api)
      // The first read only notes where the inbox stands; an unread-count alert stays until then.
      val baseline = !AlertPrefs.inboxBaselined(context)
      val counts = handleThreads(context, threads, badge, canNotify && !baseline)
      newMessages = counts.first
      unread = counts.second
      if (baseline) AlertPrefs.setInboxBaselined(context) else AlertNotifier.cancelUnreadCount(context)
      if (reader == DirectInbox.Reader.GRAPHQL) "OK" else "OK (${reader.label})"
    } catch (e: InboxUnreadable) {
      Log.w(TAG, "Inbox failed, using the unread count", e)
      if (badge == null && e.notLoggedIn) return Result(false, describe(e.failures.first()), describe(e.failures.first()), 0, 0, 0)
      if (badge != null) {
        newMessages = alertUnreadCount(context, badge, canNotify)
        unread = badge
        "Only the unread count is available. ${e.message}"
      } else {
        "${e.message}; unread count: ${describe(badgeError!!)}"
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

  private class InboxUnreadable(val failures: List<Exception>, message: String) : Exception(message) {
    val notLoggedIn get() = failures.all { it is InstagramApi.Failure.NotLoggedIn }
  }

  /** Tries each way of reading the inbox, the one that worked last time first. */
  private fun readInbox(context: Context, api: InstagramApi): Pair<List<DirectInbox.Thread>, DirectInbox.Reader> {
    val preferred = DirectInbox.Reader.entries.firstOrNull { it.key == AlertPrefs.inboxReader(context) }
    val order = listOfNotNull(preferred) + DirectInbox.Reader.entries.filter { it != preferred }
    val failures = mutableListOf<Exception>()
    val notes = mutableListOf<String>()
    for (reader in order) {
      try {
        val threads = when (reader) {
          DirectInbox.Reader.GRAPHQL -> DirectInbox.readGraphql(api)
          DirectInbox.Reader.REST -> DirectInbox.readRest(api)
        }
        AlertPrefs.setInboxReader(context, reader.key)
        return threads to reader
      } catch (e: Exception) {
        Log.w(TAG, "Inbox via ${reader.key} failed", e)
        failures += e
        notes += "${reader.label}: ${describe(e)}"
      }
    }
    throw InboxUnreadable(failures, notes.joinToString("; "))
  }

  /**
   * Alerts for conversations with messages newer than the last check, and
   * removes alerts for conversations read since. Returns (alerts, unread).
   */
  private fun handleThreads(context: Context, threads: List<DirectInbox.Thread>, badge: Int?, canNotify: Boolean): Pair<Int, Int> {
    val watermark = AlertPrefs.dmWatermark(context)
    var newest = watermark
    val notified = AlertPrefs.notifiedThreads(context).toMutableSet()
    var alerts = 0
    var unreadThreads = 0

    for (thread in threads) {
      thread.messages.firstOrNull()?.let { newest = maxOf(newest, it.atMs) }
      val incoming = thread.incoming
      // A zero unread count means everything is read, whatever a conversation looks like.
      val isUnread = badge != 0 && incoming.isNotEmpty() && thread.unread != false
      if (!isUnread) {
        if (notified.remove(thread.id)) AlertNotifier.cancelMessage(context, thread.id)
        continue
      }
      val fresh = incoming.any { it.atMs > watermark }
      if (thread.unread == true || fresh) unreadThreads++
      if (!fresh || thread.muted || !canNotify) continue

      // The new messages, plus the earlier unread ones while their alert is still showing.
      val shown = incoming.filter { it.atMs > watermark || thread.id in notified }.take(MAX_MESSAGE_LINES).reversed()
      val latestSender = thread.users[incoming.first().senderId]
      val title = if (thread.isGroup) {
        thread.title ?: thread.users.values.distinct().joinToString(", ") { it.name }.ifBlank { "Group chat" }
      } else {
        latestSender?.name ?: thread.title ?: "Instagram"
      }
      val lines = shown.map { message ->
        val sender = thread.users[message.senderId]?.name ?: if (thread.isGroup) "Someone" else title
        AlertNotifier.Line(sender, message.text, message.atMs)
      }
      AlertNotifier.postConversation(context, thread.id, title, thread.isGroup, lines, latestSender?.picture)
      notified += thread.id
      alerts++
    }

    AlertPrefs.setDmWatermark(context, newest)
    AlertPrefs.setNotifiedThreads(context, notified)
    return alerts to (badge ?: unreadThreads)
  }

  /** When only Instagram's unread count is known: one alert with the count, when it goes up. */
  private fun alertUnreadCount(context: Context, count: Int, canNotify: Boolean): Int {
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

  /** The activity feed; instagram.com itself POSTs for it with its page token, so that's the second try. */
  private fun activityFeed(api: InstagramApi): JSONObject {
    val path = "/api/v1/news/inbox/"
    val referer = "https://www.instagram.com/notifications/"
    val first = try {
      api.getJson(path, referer).takeIf { it.has("new_stories") || it.has("old_stories") }
    } catch (e: InstagramApi.Failure.NotLoggedIn) {
      throw e
    } catch (e: Exception) {
      Log.w(TAG, "Activity via GET failed", e)
      null
    }
    if (first != null) return first
    val tokens = api.tokens()
    val fbDtsg = tokens.fbDtsg ?: throw InstagramApi.Failure.BadResponse("no activity")
    return api.postForm(path, mapOf("fb_dtsg" to fbDtsg, "jazoest" to (tokens.jazoest ?: "")), referer)
  }

  private fun checkActivity(context: Context, api: InstagramApi, canNotify: Boolean): Int {
    val json = activityFeed(api)
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

  private fun describe(e: Exception): String = when (e) {
    is InstagramApi.Failure -> e.message ?: "Error"
    is java.net.UnknownHostException, is java.net.SocketTimeoutException, is java.net.ConnectException -> "No connection"
    else -> e.message?.take(120) ?: e.javaClass.simpleName
  }
}
