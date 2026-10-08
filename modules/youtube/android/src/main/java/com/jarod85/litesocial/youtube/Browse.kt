package com.jarod85.litesocial.youtube

import android.content.Context
import android.text.Html
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import org.schabi.newpipe.extractor.InfoItem
import org.schabi.newpipe.extractor.ListExtractor
import org.schabi.newpipe.extractor.Page
import org.schabi.newpipe.extractor.channel.ChannelInfo
import org.schabi.newpipe.extractor.channel.tabs.ChannelTabInfo
import org.schabi.newpipe.extractor.channel.tabs.ChannelTabs
import org.schabi.newpipe.extractor.feed.FeedInfo
import org.schabi.newpipe.extractor.linkhandler.ListLinkHandler
import org.schabi.newpipe.extractor.linkhandler.SearchQueryHandler
import org.schabi.newpipe.extractor.search.SearchInfo
import org.schabi.newpipe.extractor.services.youtube.linkHandler.YoutubeSearchQueryHandlerFactory
import org.schabi.newpipe.extractor.stream.Description
import org.schabi.newpipe.extractor.stream.StreamInfo
import org.schabi.newpipe.extractor.stream.StreamInfoItem
import org.schabi.newpipe.extractor.stream.StreamType
import java.util.UUID

/**
 * Everything the YouTube screens read: search, channels, the subscriptions
 * feed and a video's details. Recommendations (home, trending, related videos)
 * are never fetched. Shorts are filtered out of every list.
 */
class Browse(private val context: Context) {
  /** Continuation tokens handed to JS, so "load more" can resume a list. Kept in memory only. */
  private val pages = object : LinkedHashMap<String, Pair<Any, Page>>(32, 0.75f, true) {
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Pair<Any, Page>>?) = size > 50
  }

  private fun remember(handler: Any, page: Page?): String? {
    if (page == null) return null
    val token = UUID.randomUUID().toString()
    synchronized(pages) { pages[token] = handler to page }
    return token
  }

  private fun recall(token: String): Pair<Any, Page> =
    synchronized(pages) { pages[token] } ?: throw IllegalStateException("This list expired. Pull down to reload it.")

  suspend fun search(query: String, kind: String): Map<String, Any?> = io {
    val filter = when (kind) {
      "videos" -> YoutubeSearchQueryHandlerFactory.VIDEOS
      "channels" -> YoutubeSearchQueryHandlerFactory.CHANNELS
      else -> YoutubeSearchQueryHandlerFactory.ALL
    }
    val yt = Extractor.youtube
    val handler = yt.searchQHFactory.fromQuery(query, listOf(filter), "")
    val info = SearchInfo.getInfo(yt, handler)
    page(Extractor.items(info.relatedItems), remember(handler, info.nextPage))
  }

  suspend fun more(token: String): Map<String, Any?> = io {
    val (handler, page) = recall(token)
    val yt = Extractor.youtube
    val result: ListExtractor.InfoItemsPage<out InfoItem> = when (handler) {
      is SearchQueryHandler -> SearchInfo.getMoreItems(yt, handler, page)
      is ListLinkHandler -> ChannelTabInfo.getMoreItems(yt, handler, page)
      else -> throw IllegalStateException("Unknown list")
    }
    page(Extractor.items(result.items), remember(handler, result.nextPage))
  }

  /** A channel's header and its long-form uploads (the Videos tab never contains Shorts). */
  suspend fun channel(idOrUrl: String): Map<String, Any?> = io {
    val yt = Extractor.youtube
    val url = if (idOrUrl.startsWith("UC")) Extractor.channelUrl(idOrUrl) else idOrUrl
    val info = ChannelInfo.getInfo(yt, url)
    val id = info.id.removePrefix("channel/")
    val videosTab = info.tabs.firstOrNull { it.contentFilters.contains(ChannelTabs.VIDEOS) }
    var videos: List<Map<String, Any?>> = emptyList()
    var next: String? = null
    if (videosTab != null) {
      val tab = ChannelTabInfo.getInfo(yt, videosTab)
      videos = Extractor.items(tab.relatedItems).map { it + ("channelId" to id) + ("channelName" to info.name) }
      next = remember(videosTab, tab.nextPage)
    }
    mapOf(
      "id" to id,
      "url" to Extractor.channelUrl(id),
      "title" to info.name,
      "avatar" to Extractor.pickImage(info.avatars, 176)?.let(Extractor::absolute),
      "banner" to Extractor.pickImage(info.banners, 1060)?.let(Extractor::absolute),
      "subscriberCount" to info.subscriberCount.takeIf { it >= 0 },
      "description" to info.description,
      "videos" to videos,
      "nextPage" to next,
    )
  }

  /**
   * Newest long-form uploads of every subscribed channel. Each channel's Videos
   * tab supplies the list (no Shorts, with durations); its RSS feed, fetched
   * alongside, supplies exact upload times. If the tab fails, the RSS entries
   * minus Shorts are used. Channels that fail entirely are reported, so the app
   * can keep their earlier videos.
   */
  suspend fun feed(channelIds: List<String>): Map<String, Any?> = withContext(Dispatchers.IO) {
    Extractor.init()
    val limit = Semaphore(FEED_PARALLELISM)
    val results = coroutineScope {
      channelIds.distinct().map { id ->
        async { limit.withPermit { id to runCatching { channelFeed(id) } } }
      }.awaitAll()
    }
    mapOf(
      "items" to results.flatMap { (_, r) -> r.getOrNull() ?: emptyList() },
      "failed" to results.mapNotNull { (id, r) ->
        r.exceptionOrNull()?.let { mapOf("channelId" to id, "error" to Errors.describe(it)) }
      },
    )
  }

  private suspend fun channelFeed(id: String): List<Map<String, Any?>> = coroutineScope {
    val yt = Extractor.youtube
    val rss = async { runCatching { FeedInfo.getInfo(yt, Extractor.channelUrl(id)).relatedItems } }
    val tab = async {
      runCatching {
        val extractor = yt.getChannelTabExtractorFromId("channel/$id", ChannelTabs.VIDEOS)
        extractor.fetchPage()
        ChannelTabInfo.getInfo(extractor).relatedItems
      }
    }
    val rssItems = rss.await().getOrNull().orEmpty()
    val exactDates = rssItems.mapNotNull { item -> Extractor.videoId(item.url)?.let { it to Extractor.millis(item.uploadDate) } }.toMap()
    val channelName = rssItems.firstOrNull()?.uploaderName
    val tabItems = tab.await()

    val videos: List<Map<String, Any?>> = when {
      tabItems.isSuccess -> Extractor.items(tabItems.getOrThrow()).map { video ->
        val exact = exactDates[video["id"]]
        video + ("channelId" to id) + ("channelName" to (video["channelName"] ?: channelName)) +
          (if (exact != null) mapOf("uploadedAt" to exact) else emptyMap())
      }
      rss.await().isSuccess -> rssItems.filterNot(Extractor::isShort).mapNotNull(Extractor::video)
        .map { it + ("channelId" to id) }
      else -> throw tabItems.exceptionOrNull() ?: IllegalStateException("No videos")
    }
    videos.take(FEED_ITEMS_PER_CHANNEL)
  }

  /** Details, a playable source and nothing else: no related videos, no comments. */
  suspend fun video(url: String): Map<String, Any?> = withContext(Dispatchers.IO) {
    val yt = Extractor.youtube
    val info = try {
      StreamInfo.getInfo(yt, url)
    } catch (e: Exception) {
      // YouTube decides per request (each one gets a fresh visitor id), so a second try sometimes passes.
      if (!Errors.isBlocked(e)) throw e
      delay(BLOCKED_RETRY_DELAY_MS)
      StreamInfo.getInfo(yt, url)
    }
    val id = info.id
    val isLive = info.streamType == StreamType.LIVE_STREAM || info.streamType == StreamType.AUDIO_LIVE_STREAM
    mapOf(
      "id" to id,
      "url" to Extractor.watchUrl(id),
      "title" to info.name,
      "channelName" to info.uploaderName,
      "channelId" to info.uploaderUrl?.let { Extractor.channelId(it) },
      "channelAvatar" to Extractor.pickImage(info.uploaderAvatars, 88)?.let(Extractor::absolute),
      "thumbnail" to Extractor.pickImage(info.thumbnails, 720),
      "description" to plainText(info.description),
      "durationSeconds" to info.duration.takeIf { it > 0 },
      "uploadedAt" to Extractor.millis(info.uploadDate),
      "viewCount" to info.viewCount.takeIf { it >= 0 },
      "likeCount" to info.likeCount.takeIf { it >= 0 },
      "isShort" to (info.isShortFormContent || info.url.contains("/shorts/")),
      "isLive" to isLive,
      "sources" to Playback.sources(context, info),
      "qualities" to Playback.qualities(context, info),
    )
  }

  private fun plainText(description: Description?): String {
    val content = description?.content ?: return ""
    return if (description.type == Description.HTML) {
      Html.fromHtml(content, Html.FROM_HTML_MODE_LEGACY).toString().trim()
    } else {
      content.trim()
    }
  }

  private fun page(items: List<Map<String, Any?>>, next: String?) = mapOf("items" to items, "nextPage" to next)

  private suspend fun <T> io(block: () -> T): T = withContext(Dispatchers.IO) { block() }

  companion object {
    private const val FEED_PARALLELISM = 6
    private const val FEED_ITEMS_PER_CHANNEL = 15
    private const val BLOCKED_RETRY_DELAY_MS = 1500L
  }
}
