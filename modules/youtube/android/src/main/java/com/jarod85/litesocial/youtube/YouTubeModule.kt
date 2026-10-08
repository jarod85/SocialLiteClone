package com.jarod85.litesocial.youtube

import android.app.Activity
import android.content.Context
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.UUID

/** JS side: src/features/youtube/native.ts. */
class YouTubeModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val browse by lazy { Browse(context) }
  private var pendingPick: Promise? = null
  private val downloadListener: (Downloads.Update) -> Unit = { sendEvent(DOWNLOAD_EVENT, it.toMap()) }

  private class YouTubeException(code: String, message: String, cause: Throwable?) : CodedException(code, message, cause) {
    constructor(message: String, cause: Throwable?) : this(Errors.OTHER, message, cause)
  }

  /** Every error reaches JS as a short, readable message, with a code from [Errors]. */
  private suspend fun <T> guarded(block: suspend () -> T): T =
    try {
      block()
    } catch (e: Throwable) {
      throw YouTubeException(Errors.code(e), Errors.describe(e), e)
    }

  override fun definition() = ModuleDefinition {
    Name("LiteSocialYouTube")
    Events(DOWNLOAD_EVENT)

    OnCreate { Downloads.listeners += downloadListener }
    OnDestroy { Downloads.listeners -= downloadListener }

    AsyncFunction("search") Coroutine { query: String, kind: String -> guarded { browse.search(query, kind) } }
    AsyncFunction("more") Coroutine { token: String -> guarded { browse.more(token) } }
    AsyncFunction("channel") Coroutine { idOrUrl: String -> guarded { browse.channel(idOrUrl) } }
    AsyncFunction("feed") Coroutine { channelIds: List<String> -> guarded { browse.feed(channelIds) } }
    AsyncFunction("video") Coroutine { url: String -> guarded { browse.video(url) } }

    /** Video id from any YouTube link (watch, youtu.be, embed, live), or null. Shorts links return null. */
    Function("parseVideoId") { url: String ->
      if (url.contains("/shorts/")) null else Extractor.videoId(url)
    }

    // ---- Downloads ----

    Function("startDownload") { options: Map<String, Any?> ->
      val id = UUID.randomUUID().toString()
      DownloadService.start(
        context,
        Downloads.Request(
          id = id,
          url = options["url"] as? String ?: throw YouTubeException("Missing video", null),
          title = options["title"] as? String ?: "YouTube video",
          format = if (options["format"] == "mp3") "mp3" else "mp4",
          maxHeight = (options["maxHeight"] as? Number)?.toInt() ?: 1080,
          mp3Kbps = (options["mp3Kbps"] as? Number)?.toInt() ?: 192,
          folderTree = options["folderTree"] as? String,
          folderPath = (options["folderPath"] as? List<*>)?.filterIsInstance<String>() ?: emptyList(),
        ),
      )
      id
    }

    Function("cancelDownload") { id: String -> Downloads.cancel(id) }

    Function("getDownloads") { Downloads.snapshot().map { it.toMap() } }

    Function("clearFinishedDownloads") { Downloads.clearFinished() }

    // ---- Music folder (Musicolet) ----

    AsyncFunction("pickMusicFolder") { promise: Promise ->
      val activity = appContext.currentActivity ?: return@AsyncFunction promise.reject(YouTubeException("No screen to show the folder picker on", null))
      pendingPick?.resolve(null)
      pendingPick = promise
      activity.startActivityForResult(MusicFolder.pickIntent(), PICK_FOLDER)
    }.runOnQueue(Queues.MAIN)

    OnActivityResult { _, payload ->
      if (payload.requestCode != PICK_FOLDER) return@OnActivityResult
      val promise = pendingPick ?: return@OnActivityResult
      pendingPick = null
      val tree = payload.data?.data
      if (payload.resultCode != Activity.RESULT_OK || tree == null) {
        promise.resolve(null)
        return@OnActivityResult
      }
      try {
        val (uri, name) = MusicFolder.persist(context, tree)
        promise.resolve(mapOf("uri" to uri, "name" to name))
      } catch (e: Exception) {
        promise.reject(YouTubeException("Couldn't keep access to that folder: ${e.message}", e))
      }
    }

    Function("hasMusicFolderAccess") { tree: String -> MusicFolder.hasAccess(context, tree) }

    AsyncFunction("listFolders") Coroutine { tree: String, path: List<String> ->
      guarded { withContext(Dispatchers.IO) { MusicFolder.list(context, tree, path) } }
    }

    AsyncFunction("createFolder") Coroutine { tree: String, path: List<String>, name: String ->
      guarded { withContext(Dispatchers.IO) { MusicFolder.createFolder(context, tree, path, name) } }
    }

    Function("describeFolder") { tree: String, path: List<String> -> MusicFolder.describe(tree, path) }

    Function("isMusicoletInstalled") {
      context.packageManager.getLaunchIntentForPackage(DownloadService.MUSICOLET) != null
    }
  }

  companion object {
    private const val DOWNLOAD_EVENT = "onDownloadUpdate"
    private const val PICK_FOLDER = 7302
  }
}
