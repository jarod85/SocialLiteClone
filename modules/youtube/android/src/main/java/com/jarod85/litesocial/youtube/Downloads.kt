package com.jarod85.litesocial.youtube

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import org.schabi.newpipe.extractor.MediaFormat
import org.schabi.newpipe.extractor.stream.StreamInfo
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.CancellationException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Download jobs: MP4 videos into Movies/Lite Social, MP3s into the chosen
 * Musicolet folder. DownloadService runs them one at a time in the
 * foreground, so they finish even with the app closed or the screen off.
 */
object Downloads {
  data class Request(
    val id: String,
    val url: String,
    val title: String,
    val format: String, // "mp4" or "mp3"
    val maxHeight: Int,
    val mp3Kbps: Int,
    val folderTree: String?,
    val folderPath: List<String>,
  )

  data class Update(
    val id: String,
    val title: String,
    val format: String,
    /** queued, downloading, converting, saving, done, failed, cancelled */
    val state: String,
    val progress: Float,
    val savedTo: String? = null,
    val fileUri: String? = null,
    val error: String? = null,
  ) {
    fun toMap(): Map<String, Any?> = mapOf(
      "id" to id,
      "title" to title,
      "format" to format,
      "state" to state,
      "progress" to progress.toDouble(),
      "savedTo" to savedTo,
      "fileUri" to fileUri,
      "error" to error,
    )

    val finished get() = state == "done" || state == "failed" || state == "cancelled"
  }

  val listeners = CopyOnWriteArrayList<(Update) -> Unit>()
  private val latest = ConcurrentHashMap<String, Update>()
  private val cancelled = ConcurrentHashMap.newKeySet<String>()

  fun snapshot(): List<Update> = latest.values.sortedBy { it.id }

  fun cancel(id: String) {
    cancelled += id
    latest[id]?.takeIf { it.state == "queued" }?.let { publish(it.copy(state = "cancelled")) }
  }

  fun isCancelled(id: String) = id in cancelled

  fun clearFinished() {
    latest.values.filter { it.finished }.forEach { latest.remove(it.id) }
  }

  private val lastSent = ConcurrentHashMap<String, Pair<Update, Long>>()

  /** Stores the update and tells listeners: state changes always, progress at most 4 times a second. */
  fun publish(update: Update) {
    latest[update.id] = update
    val now = System.currentTimeMillis()
    val previous = lastSent[update.id]
    if (previous != null && previous.first.state == update.state && now - previous.second < 250) return
    lastSent[update.id] = update to now
    listeners.forEach { runCatching { it(update) } }
  }

  /** Runs one job to the end. Called on DownloadService's worker thread. */
  fun run(context: Context, request: Request) {
    if (isCancelled(request.id)) return publish(Update(request.id, request.title, request.format, "cancelled", 0f))
    val work = File(context.cacheDir, "downloads/${request.id}").apply { mkdirs() }
    var update = Update(request.id, request.title, request.format, "downloading", 0f)
    publish(update)
    try {
      val info = StreamInfo.getInfo(Extractor.youtube, request.url)
      update = if (request.format == "mp3") mp3(context, request, info, work, update) else mp4(context, request, info, work, update)
      publish(update)
    } catch (e: CancellationException) {
      publish(update.copy(state = "cancelled"))
    } catch (e: Throwable) {
      publish(update.copy(state = "failed", error = Errors.describe(e)))
    } finally {
      work.deleteRecursively()
      cancelled -= request.id
    }
  }

  private fun mp4(context: Context, request: Request, info: StreamInfo, work: File, start: Update): Update {
    val cancelledCheck = { isCancelled(request.id) }
    val video = Playback.adaptiveVideo(info).filter { Playback.height(it) <= request.maxHeight }.maxByOrNull { Playback.height(it) * 1000 + it.fps }
    val audio = Playback.adaptiveAudio(info).maxByOrNull { it.averageBitrate }
    val output = File(work, "out.mp4")

    if (video != null && audio != null) {
      val videoFile = File(work, "video.mp4")
      val audioFile = File(work, "audio.m4a")
      val videoSize = video.itagItem?.contentLength ?: 0L
      val audioSize = audio.itagItem?.contentLength ?: 0L
      val total = (videoSize + audioSize).coerceAtLeast(1)
      RangeDownload.download(video.content, videoFile, videoSize, cancelledCheck) { done, _ ->
        publish(start.copy(progress = 0.9f * done / total))
      }
      RangeDownload.download(audio.content, audioFile, audioSize, cancelledCheck) { done, _ ->
        publish(start.copy(progress = 0.9f * (videoSize + done) / total))
      }
      publish(start.copy(state = "converting", progress = 0.9f))
      MediaConvert.muxMp4(videoFile, audioFile, output, cancelledCheck)
    } else {
      // Older or unusual videos: the single file with both, usually 360p.
      val muxed = info.videoStreams.filter { it.isUrl && it.format == MediaFormat.MPEG_4 }.maxByOrNull { Playback.height(it) }
        ?: throw IOException("No MP4 version of this video is available")
      RangeDownload.download(muxed.content, output, muxed.itagItem?.contentLength ?: 0L, cancelledCheck) { done, total ->
        publish(start.copy(progress = 0.95f * done / total.coerceAtLeast(1)))
      }
    }

    publish(start.copy(state = "saving", progress = 0.97f))
    val name = MusicFolder.cleanName(request.title)
    val uri = saveVideo(context, output, name)
    return start.copy(state = "done", progress = 1f, savedTo = "Movies/Lite Social/$name.mp4", fileUri = uri.toString())
  }

  private fun mp3(context: Context, request: Request, info: StreamInfo, work: File, start: Update): Update {
    val tree = request.folderTree ?: throw IOException("Choose a music folder first")
    if (!MusicFolder.hasAccess(context, tree)) throw IOException("Lite Social lost access to the music folder. Choose it again in Settings.")
    val cancelledCheck = { isCancelled(request.id) }

    // AAC first: every phone decodes it in hardware. Opus (WebM) only if there's no AAC.
    val candidates = Playback.originalTrack(info.audioStreams.filter { it.isUrl })
    val audio = candidates.filter { it.format == MediaFormat.M4A }.maxByOrNull { it.averageBitrate }
      ?: candidates.filter { it.format == MediaFormat.WEBMA_OPUS || it.format == MediaFormat.WEBMA }.maxByOrNull { it.averageBitrate }
      ?: throw IOException("No audio track is available for this video")
    val audioFile = File(work, "audio")
    RangeDownload.download(audio.content, audioFile, audio.itagItem?.contentLength ?: 0L, cancelledCheck) { done, total ->
      publish(start.copy(progress = 0.6f * done / total.coerceAtLeast(1)))
    }

    publish(start.copy(state = "converting", progress = 0.6f))
    val mp3File = File(work, "out.mp3")
    mp3File.outputStream().buffered().use { out ->
      MediaConvert.encodeMp3(audioFile, out, request.mp3Kbps, cancelledCheck) { fraction ->
        publish(start.copy(state = "converting", progress = 0.6f + 0.35f * fraction))
      }
    }

    publish(start.copy(state = "saving", progress = 0.96f))
    val tag = Id3Tag.build(info.name, info.uploaderName, null, cover(info.id))
    val name = MusicFolder.cleanName(info.name)
    val file = MusicFolder.createMp3(context, tree, request.folderPath, name)
    try {
      MusicFolder.open(context, file).use { out ->
        out.write(tag)
        mp3File.inputStream().use { it.copyTo(out, 256 * 1024) }
      }
    } catch (e: Exception) {
      MusicFolder.delete(context, file)
      throw e
    }
    return start.copy(state = "done", progress = 1f, savedTo = "${MusicFolder.describe(tree, request.folderPath)}/$name.mp3", fileUri = file.toString())
  }

  /** Adds the MP4 to the phone's Movies/Lite Social folder, where gallery apps find it. */
  private fun saveVideo(context: Context, file: File, name: String): Uri {
    val resolver = context.contentResolver
    val values = ContentValues().apply {
      put(MediaStore.Video.Media.DISPLAY_NAME, "$name.mp4")
      put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
      put(MediaStore.Video.Media.RELATIVE_PATH, "${Environment.DIRECTORY_MOVIES}/Lite Social")
      put(MediaStore.Video.Media.IS_PENDING, 1)
    }
    val uri = resolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values) ?: throw IOException("Couldn't add the video to Movies")
    try {
      resolver.openOutputStream(uri)?.use { out -> file.inputStream().use { it.copyTo(out, 256 * 1024) } }
        ?: throw IOException("Couldn't write the video")
      resolver.update(uri, ContentValues().apply { put(MediaStore.Video.Media.IS_PENDING, 0) }, null, null)
    } catch (e: Exception) {
      resolver.delete(uri, null, null)
      throw e
    }
    return uri
  }

  /** The video's thumbnail, cropped square for album art. Optional: null on any problem. */
  private fun cover(videoId: String): ByteArray? {
    for (name in listOf("maxresdefault", "hqdefault")) {
      try {
        val connection = URL("https://i.ytimg.com/vi/$videoId/$name.jpg").openConnection() as HttpURLConnection
        connection.connectTimeout = 10_000
        connection.readTimeout = 10_000
        if (connection.responseCode != 200) continue
        val bitmap = connection.inputStream.use { BitmapFactory.decodeStream(it) } ?: continue
        connection.disconnect()
        // hqdefault is 4:3 with black bars around a 16:9 picture: crop to the picture's height.
        val pictureHeight = minOf(bitmap.height, bitmap.width * 9 / 16)
        val side = pictureHeight
        val square = Bitmap.createBitmap(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side)
        val scaled = if (side > 600) Bitmap.createScaledBitmap(square, 600, 600, true) else square
        return ByteArrayOutputStream().also { scaled.compress(Bitmap.CompressFormat.JPEG, 90, it) }.toByteArray()
      } catch (_: Exception) {
        // Try the next size.
      }
    }
    return null
  }
}
