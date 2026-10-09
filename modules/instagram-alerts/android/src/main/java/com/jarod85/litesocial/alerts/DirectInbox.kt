package com.jarod85.litesocial.alerts

import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * The direct-message inbox, read one of two ways and turned into the same
 * shape: instagram.com's current GraphQL inbox query, or the older REST inbox
 * (/api/v1/direct_v2/inbox/) the site used before.
 */
object DirectInbox {
  data class User(val name: String, val picture: String?)

  data class Message(val senderId: String, val text: String, val atMs: Long)

  data class Thread(
    /** Numeric; opens the chat at instagram.com/direct/t/<id>/. */
    val id: String,
    val title: String?,
    val isGroup: Boolean,
    val muted: Boolean,
    /** Every id a participant goes by (Instagram id, messaging id), to that participant. */
    val users: Map<String, User>,
    /** Newest first. */
    val messages: List<Message>,
    /** Every id the signed-in account goes by in this thread. */
    val viewerIds: Set<String>,
    /** Whether the newest incoming message is unread; null when the source doesn't say. */
    val unread: Boolean?,
  ) {
    /** Their messages since your last one, newest first. Empty if you wrote last. */
    val incoming: List<Message> get() = messages.takeWhile { it.senderId !in viewerIds }
  }

  enum class Reader(val key: String, val label: String) {
    GRAPHQL("graphql", "web inbox"),
    REST("rest", "older web inbox"),
  }

  /** Messages fetched per conversation, enough for a notification with the last few. */
  private const val MESSAGES_PER_THREAD = 5
  private const val THREADS = 20

  // ------------------------------------------------------------------ GraphQL

  /** instagram.com's inbox query (PolarisDirectInboxQuery). Its id changes when Instagram updates the site. */
  private const val INBOX_DOC_ID = "27262915580045003"
  private val deviceId = UUID.randomUUID().toString()

  fun readGraphql(api: InstagramApi): List<Thread> {
    val variables = JSONObject()
      .put("device_id_for_iris_subscription", deviceId)
      .put("__relay_internal__pv__IGDIsProfessionalAccountGKrelayprovider", false)
      .put("__relay_internal__pv__IGDPinnedThreadsRenderEnabledGKrelayprovider", true)
      .put("__relay_internal__pv__IGDMaxUnreadMessagesCountrelayprovider", MESSAGES_PER_THREAD)
      .put("__relay_internal__pv__PolarisAIGMAccountLabelEnabledrelayprovider", false)
      .put("__relay_internal__pv__IGDThreadListActionsEnabledGKrelayprovider", true)
    val json = api.graphql("PolarisDirectInboxQuery", INBOX_DOC_ID, variables, "https://www.instagram.com/direct/inbox/")
    return parseGraphql(json, api.viewerId)
  }

  fun parseGraphql(json: JSONObject, viewerId: String?): List<Thread> {
    val data = json.optJSONObject("data") ?: throw InstagramApi.Failure.BadResponse("no data")
    val mailbox = data.optJSONObject("get_slide_mailbox_for_iris_subscription")
      ?: firstObjectWith(data, "threads_by_folder")
      ?: throw InstagramApi.Failure.BadResponse("no inbox in the reply")
    val edges = mailbox.optJSONObject("threads_by_folder")?.optJSONArray("edges")
      ?: throw InstagramApi.Failure.BadResponse("no conversations in the reply")
    return objects(edges).mapNotNull { edge ->
      val node = edge.optJSONObject("node") ?: return@mapNotNull null
      slideThread(node.optJSONObject("as_ig_direct_thread") ?: node, viewerId)
    }
  }

  private fun slideThread(thread: JSONObject, viewerId: String?): Thread? {
    val id = listOf("thread_id", "id", "thread_key", "thread_fbid").map { thread.optString(it) }
      .firstOrNull { it.matches(NUMERIC_ID) } ?: return null
    val viewer = thread.optJSONObject("viewer")
    val viewerIds = (ids(viewer) + listOfNotNull(viewerId, thread.optString("viewer_id").ifEmpty { null })).toSet()

    val users = mutableMapOf<String, User>()
    objects(thread.optJSONArray("users")).forEach { user -> userOf(user)?.let { u -> ids(user).forEach { users[it] = u } } }

    val messages = objects(thread.optJSONObject("slide_messages")?.optJSONArray("edges")).mapNotNull { edge ->
      val node = edge.optJSONObject("node") ?: return@mapNotNull null
      val type = node.optString("content_type").uppercase()
      if (type.endsWith("_LOG_XMAT") || type.endsWith("PARTICIPANT_XMAT")) return@mapNotNull null
      val sender = node.optJSONObject("sender")
      val senderUser = sender?.optJSONObject("user_dict")
      val senderIds = listOf(node.optString("sender_fbid")) + ids(sender) + ids(senderUser)
      val senderId = senderIds.firstOrNull { it.isNotEmpty() } ?: return@mapNotNull null
      // Known by any of its ids, so a sender is matched to the viewer or a participant whichever id it comes with.
      val known = senderIds.firstOrNull { it in viewerIds } ?: senderIds.firstOrNull { it in users } ?: senderId
      senderUser?.let(::userOf)?.let { u -> if (known !in users) users[known] = u }
      Message(known, slidePreview(node), millis(node.opt("timestamp_ms") ?: node.opt("timestamp")))
    }.sortedByDescending { it.atMs }

    // Without the viewer's messaging id, a sender who isn't a participant can only be the viewer.
    val allViewerIds = if (ids(viewer).isEmpty() && users.isNotEmpty()) {
      viewerIds + messages.map { it.senderId }.filter { it !in users }
    } else {
      viewerIds
    }

    return Thread(
      id = id,
      title = thread.optString("thread_title").ifBlank { null },
      isGroup = thread.optBoolean("is_group"),
      muted = thread.optBoolean("is_muted") || thread.optBoolean("muted"),
      users = users,
      messages = messages,
      viewerIds = allViewerIds,
      unread = if (thread.optBoolean("marked_as_unread")) true else null,
    )
  }

  private fun slidePreview(node: JSONObject): String {
    val content = node.optJSONObject("content")
    val text = (content?.optString("text_body")?.ifBlank { null } ?: node.optString("text_body")).trim()
    if (text.isNotEmpty()) return text
    val type = node.optString("content_type").uppercase()
    val xma = content?.optJSONObject("xma")
    val attachments = objects(content?.optJSONArray("attachments"))
    return when {
      xma != null -> {
        val target = xma.optString("target_url")
        when {
          type == "MONTAGE_SHARE_XMA" || "/stories/" in target -> "Shared a story"
          "/reel/" in target || "/reels/" in target -> "Shared a reel"
          "/p/" in target -> "Shared a post"
          else -> xma.optString("title_text").ifBlank { null }?.let { "Shared: $it" } ?: "Shared something"
        }
      }
      "VOICE" in type || "AUDIO" in type -> "Sent a voice message"
      content?.has("animated_media") == true || "ANIMATED" in type -> "Sent a GIF"
      "STICKER" in type -> "Sent a sticker"
      attachments.isNotEmpty() ->
        if (attachments.any { it.has("attachment_mp4_url") || it.optString("attachment_mime_type").startsWith("video") } || "VIDEO" in type) {
          "Sent a video"
        } else {
          "Sent a photo"
        }
      "VIDEO" in type -> "Sent a video"
      "IMAGE" in type || "PHOTO" in type -> "Sent a photo"
      "LIKE" in type || "HEART" in type -> "❤️"
      else -> "New message"
    }
  }

  // --------------------------------------------------------------------- REST

  fun readRest(api: InstagramApi): List<Thread> {
    val json = api.getJson(
      "/api/v1/direct_v2/inbox/?persistentBadging=true&folder=&limit=$THREADS&thread_message_limit=$MESSAGES_PER_THREAD",
      "https://www.instagram.com/direct/inbox/",
    )
    return parseRest(json, api.viewerId)
  }

  fun parseRest(json: JSONObject, viewerId: String?): List<Thread> {
    val inbox = json.optJSONObject("inbox") ?: throw InstagramApi.Failure.BadResponse("no inbox")
    val viewer = json.optJSONObject("viewer")?.let { it.optString("pk").ifEmpty { it.optString("pk_id") } }
      ?.takeIf { it.isNotEmpty() } ?: viewerId
    return objects(inbox.optJSONArray("threads")).mapNotNull { thread ->
      val id = thread.optString("thread_id").takeIf { it.matches(NUMERIC_ID) } ?: return@mapNotNull null
      val users = mutableMapOf<String, User>()
      objects(thread.optJSONArray("users")).forEach { user ->
        userOf(user)?.let { u -> listOf("pk", "pk_id", "strong_id__").map { user.optString(it) }.filter { it.isNotEmpty() }.forEach { users[it] = u } }
      }
      val messages = objects(thread.optJSONArray("items")).map { item ->
        Message(item.optString("user_id"), restPreview(item), millis(item.opt("timestamp")))
      }.sortedByDescending { it.atMs }
      val viewerIds = setOfNotNull(viewer)
      val seenAt = viewer?.let { thread.optJSONObject("last_seen_at")?.optJSONObject(it) }?.let { millis(it.opt("timestamp")) } ?: 0L
      val latest = messages.firstOrNull()
      Thread(
        id = id,
        title = thread.optString("thread_title").ifBlank { null },
        isGroup = thread.optBoolean("is_group"),
        muted = thread.optBoolean("muted"),
        users = users,
        messages = messages,
        viewerIds = viewerIds,
        unread = latest != null && latest.senderId !in viewerIds && latest.atMs > seenAt,
      )
    }
  }

  private fun restPreview(item: JSONObject): String {
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

  // ------------------------------------------------------------------ helpers

  private val NUMERIC_ID = Regex("\\d{1,40}")

  private fun objects(array: JSONArray?): List<JSONObject> =
    if (array == null) emptyList() else (0 until array.length()).mapNotNull { array.optJSONObject(it) }

  private fun ids(o: JSONObject?): List<String> =
    if (o == null) emptyList()
    else listOf("interop_messaging_user_fbid", "fbid_v2", "id", "pk", "pk_id", "igid", "strong_id__")
      .map { o.optString(it) }.filter { it.isNotEmpty() && it != "null" }

  /** "Full Name (@username)", so the account is clear even when names repeat. */
  private fun userOf(user: JSONObject): User? {
    val fullName = user.optString("full_name").ifBlank { user.optString("name") }.trim()
    val username = user.optString("username").trim()
    val name = when {
      fullName.isNotEmpty() && username.isNotEmpty() && fullName != username -> "$fullName (@$username)"
      username.isNotEmpty() -> "@$username"
      else -> fullName
    }
    if (name.isBlank()) return null
    val picture = listOf("profile_pic_url", "profile_picture_url", "profile_pic_url_hd").map { user.optString(it) }
      .firstOrNull { it.startsWith("https://") }
    return User(name, picture)
  }

  /** The first object anywhere under `root` that has `key`. */
  private fun firstObjectWith(root: JSONObject, key: String): JSONObject? {
    if (root.has(key)) return root
    for (name in root.keys()) {
      val child = root.optJSONObject(name) ?: continue
      firstObjectWith(child, key)?.let { return it }
    }
    return null
  }

  /** Instagram timestamps come as microseconds (REST), milliseconds (GraphQL) or seconds, sometimes as strings. */
  fun millis(value: Any?): Long {
    val n = when (value) {
      is Number -> value.toLong()
      is String -> value.toLongOrNull() ?: value.toDoubleOrNull()?.toLong() ?: 0L
      else -> 0L
    }
    return when {
      n > 100_000_000_000_000L -> n / 1000 // microseconds
      n in 1..99_999_999_999L -> n * 1000 // seconds
      else -> n
    }
  }
}
