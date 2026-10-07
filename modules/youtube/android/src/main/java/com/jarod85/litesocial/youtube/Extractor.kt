package com.jarod85.litesocial.youtube

import org.schabi.newpipe.extractor.Image
import org.schabi.newpipe.extractor.InfoItem
import org.schabi.newpipe.extractor.NewPipe
import org.schabi.newpipe.extractor.ServiceList
import org.schabi.newpipe.extractor.StreamingService
import org.schabi.newpipe.extractor.channel.ChannelInfoItem
import org.schabi.newpipe.extractor.downloader.Downloader
import org.schabi.newpipe.extractor.downloader.Request
import org.schabi.newpipe.extractor.downloader.Response
import org.schabi.newpipe.extractor.exceptions.ReCaptchaException
import org.schabi.newpipe.extractor.localization.ContentCountry
import org.schabi.newpipe.extractor.localization.DateWrapper
import org.schabi.newpipe.extractor.localization.Localization
import org.schabi.newpipe.extractor.services.youtube.linkHandler.YoutubeChannelLinkHandlerFactory
import org.schabi.newpipe.extractor.services.youtube.linkHandler.YoutubeStreamLinkHandlerFactory
import org.schabi.newpipe.extractor.stream.StreamInfoItem
import org.schabi.newpipe.extractor.stream.StreamType
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale

/**
 * NewPipe Extractor setup: YouTube without an account, an API key or ads.
 * Requests go straight from the phone to YouTube; nothing else is contacted.
 */
object Extractor {
  /** A current desktop browser, which is what YouTube's own web pages expect. */
  const val BROWSER_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0"

  @Volatile private var initialized = false

  val youtube: StreamingService
    get() {
      init()
      return ServiceList.YouTube
    }

  @Synchronized
  fun init() {
    if (initialized) return
    val country = Locale.getDefault().country.takeIf { it.length == 2 } ?: "US"
    // English texts keep NewPipe's "3 days ago" parsing reliable; the country picks regional results.
    NewPipe.init(HttpDownloader, Localization("en", country), ContentCountry(country))
    initialized = true
  }

  private object HttpDownloader : Downloader() {
    override fun execute(request: Request): Response {
      val connection = URL(request.url()).openConnection() as HttpURLConnection
      try {
        connection.requestMethod = request.httpMethod()
        connection.connectTimeout = 15_000
        connection.readTimeout = 30_000
        connection.setRequestProperty("User-Agent", BROWSER_USER_AGENT)
        for ((name, values) in request.headers()) {
          connection.setRequestProperty(name, null)
          values.forEach { connection.addRequestProperty(name, it) }
        }
        request.dataToSend()?.let { body ->
          connection.doOutput = true
          connection.outputStream.use { it.write(body) }
        }
        val code = connection.responseCode
        if (code == 429) throw ReCaptchaException("YouTube is rate limiting this network", request.url())
        val body = (if (code >= 400) connection.errorStream else connection.inputStream)
          ?.use { it.readBytes().toString(Charsets.UTF_8) } ?: ""
        return Response(code, connection.responseMessage, connection.headerFields.filterKeys { it != null }, body, connection.url.toString())
      } finally {
        connection.disconnect()
      }
    }
  }

  fun videoId(url: String): String? = runCatching { YoutubeStreamLinkHandlerFactory.getInstance().getId(url) }.getOrNull()

  /** "UC…" for /channel/UC… URLs; null for handles and custom URLs that need a lookup first. */
  fun channelId(url: String): String? =
    runCatching { YoutubeChannelLinkHandlerFactory.getInstance().getId(url) }.getOrNull()
      ?.removePrefix("channel/")?.takeIf { it.startsWith("UC") }

  fun channelUrl(id: String) = "https://www.youtube.com/channel/$id"

  fun watchUrl(id: String) = "https://www.youtube.com/watch?v=$id"

  /** The image closest to `width` pixels wide without going far below it. */
  fun pickImage(images: List<Image>, width: Int): String? {
    if (images.isEmpty()) return null
    val sized = images.filter { it.width > 0 }
    if (sized.isEmpty()) return images.last().url
    return (sized.filter { it.width >= width }.minByOrNull { it.width } ?: sized.maxByOrNull { it.width })?.url
  }

  fun millis(date: DateWrapper?): Long? = runCatching { date?.instant?.toEpochMilli() }.getOrNull()

  /** True for anything that is or looks like a Short. Shorts never reach the app's screens. */
  fun isShort(item: StreamInfoItem): Boolean =
    item.isShortFormContent || item.url.contains("/shorts/")

  fun video(item: StreamInfoItem): Map<String, Any?>? {
    val id = videoId(item.url) ?: return null
    return mapOf(
      "type" to "video",
      "id" to id,
      "url" to watchUrl(id),
      "title" to item.name,
      "channelName" to item.uploaderName,
      "channelId" to item.uploaderUrl?.let { channelId(it) },
      "thumbnail" to pickImage(item.thumbnails, 480),
      "durationSeconds" to item.duration.takeIf { it > 0 },
      "uploadedAt" to millis(item.uploadDate),
      "uploadedText" to item.textualUploadDate,
      "viewCount" to item.viewCount.takeIf { it >= 0 },
      "isLive" to (item.streamType == StreamType.LIVE_STREAM || item.streamType == StreamType.AUDIO_LIVE_STREAM),
    )
  }

  fun channel(item: ChannelInfoItem): Map<String, Any?>? {
    val id = channelId(item.url) ?: return null
    return mapOf(
      "type" to "channel",
      "id" to id,
      "url" to channelUrl(id),
      "title" to item.name,
      "thumbnail" to pickImage(item.thumbnails, 176)?.let { absolute(it) },
      "subscriberCount" to item.subscriberCount.takeIf { it >= 0 },
      "description" to item.description,
      "verified" to item.isVerified,
    )
  }

  /** Search results mix channels and videos; Shorts, playlists and anything else are dropped. */
  fun items(items: List<InfoItem>): List<Map<String, Any?>> = items.mapNotNull {
    when (it) {
      is StreamInfoItem -> if (isShort(it)) null else video(it)
      is ChannelInfoItem -> channel(it)
      else -> null
    }
  }

  /** Channel avatars sometimes come protocol-relative ("//yt3.ggpht.com/…"). */
  fun absolute(url: String): String = if (url.startsWith("//")) "https:$url" else url
}
