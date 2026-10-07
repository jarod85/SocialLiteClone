package com.jarod85.litesocial.youtube

import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/**
 * Runs download jobs one after another as a foreground service, with a
 * progress notification, so a download keeps going when you leave the app or
 * turn the screen off. Stops itself when the queue is empty.
 */
class DownloadService : Service() {
  private val executor = Executors.newSingleThreadExecutor()
  private val pending = AtomicInteger(0)
  private val listener: (Downloads.Update) -> Unit = { update -> onUpdate(update) }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    ensureChannels(this)
    Downloads.listeners += listener
    startForeground(
      ONGOING_ID,
      ongoing("Preparing download…", 0f, indeterminate = true),
      ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
    )
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val request = intent?.let(::requestFrom)
    if (request == null) {
      if (pending.get() == 0) stopSelf()
      return START_NOT_STICKY
    }
    pending.incrementAndGet()
    Downloads.publish(Downloads.Update(request.id, request.title, request.format, "queued", 0f))
    executor.execute {
      try {
        Downloads.run(applicationContext, request)
      } finally {
        if (pending.decrementAndGet() == 0) {
          stopForeground(STOP_FOREGROUND_REMOVE)
          stopSelf()
        }
      }
    }
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    Downloads.listeners -= listener
    executor.shutdownNow()
    super.onDestroy()
  }

  @SuppressLint("MissingPermission") // Without notification permission these simply don't show.
  private fun onUpdate(update: Downloads.Update) {
    val manager = NotificationManagerCompat.from(this)
    when (update.state) {
      "downloading", "converting", "saving" -> {
        val verb = when (update.state) {
          "downloading" -> "Downloading"
          "converting" -> if (update.format == "mp3") "Converting to MP3" else "Joining video and sound"
          else -> "Saving"
        }
        manager.notify(ONGOING_ID, ongoing("$verb: ${update.title}", update.progress, indeterminate = false))
      }
      "done", "failed" -> manager.notify(update.id.hashCode(), finished(update))
    }
  }

  private fun ongoing(text: String, progress: Float, indeterminate: Boolean) =
    NotificationCompat.Builder(this, PROGRESS_CHANNEL)
      .setSmallIcon(R.drawable.lite_social_download)
      .setContentTitle("Lite Social")
      .setContentText(text)
      .setOnlyAlertOnce(true)
      .setOngoing(true)
      .setProgress(100, (progress * 100).toInt(), indeterminate)
      .setContentIntent(openApp())
      .build()

  private fun finished(update: Downloads.Update) =
    NotificationCompat.Builder(this, DONE_CHANNEL)
      .setSmallIcon(R.drawable.lite_social_download)
      .setContentTitle(if (update.state == "done") "Saved ${update.format.uppercase()}" else "Download failed")
      .setContentText(if (update.state == "done") update.savedTo ?: update.title else "${update.title}: ${update.error}")
      .setStyle(
        NotificationCompat.BigTextStyle().bigText(
          if (update.state == "done") "${update.title}\n${update.savedTo ?: ""}" else "${update.title}\n${update.error}",
        ),
      )
      .setAutoCancel(true)
      .setContentIntent(if (update.state == "done") openResult(update) else openApp())
      .build()

  /** MP3: open Musicolet (falls back to the app). MP4: open the video. */
  private fun openResult(update: Downloads.Update): PendingIntent? {
    val intent = if (update.format == "mp3") {
      packageManager.getLaunchIntentForPackage(MUSICOLET)
    } else {
      update.fileUri?.let {
        Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse(it), "video/mp4").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
    } ?: return openApp()
    return PendingIntent.getActivity(this, update.id.hashCode(), intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_IMMUTABLE)
  }

  private fun openApp(): PendingIntent? =
    packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE)
    }

  companion object {
    private const val PROGRESS_CHANNEL = "youtube_download_progress"
    private const val DONE_CHANNEL = "youtube_downloads"
    private const val ONGOING_ID = 7301
    const val MUSICOLET = "in.krosbits.musicolet"

    fun start(context: Context, request: Downloads.Request) {
      val intent = Intent(context, DownloadService::class.java)
        .putExtra("id", request.id)
        .putExtra("url", request.url)
        .putExtra("title", request.title)
        .putExtra("format", request.format)
        .putExtra("maxHeight", request.maxHeight)
        .putExtra("mp3Kbps", request.mp3Kbps)
        .putExtra("folderTree", request.folderTree)
        .putExtra("folderPath", request.folderPath.toTypedArray())
      context.startForegroundService(intent)
    }

    private fun requestFrom(intent: Intent): Downloads.Request? {
      val id = intent.getStringExtra("id") ?: return null
      val url = intent.getStringExtra("url") ?: return null
      return Downloads.Request(
        id = id,
        url = url,
        title = intent.getStringExtra("title") ?: "YouTube video",
        format = if (intent.getStringExtra("format") == "mp3") "mp3" else "mp4",
        maxHeight = intent.getIntExtra("maxHeight", 1080),
        mp3Kbps = intent.getIntExtra("mp3Kbps", 192),
        folderTree = intent.getStringExtra("folderTree"),
        folderPath = intent.getStringArrayExtra("folderPath")?.toList() ?: emptyList(),
      )
    }

    fun ensureChannels(context: Context) {
      val manager = context.getSystemService(NotificationManager::class.java)
      if (manager.getNotificationChannel(PROGRESS_CHANNEL) == null) {
        manager.createNotificationChannel(
          NotificationChannel(PROGRESS_CHANNEL, "Download progress", NotificationManager.IMPORTANCE_LOW).apply {
            description = "Shows while a YouTube video or song is downloading."
          },
        )
      }
      if (manager.getNotificationChannel(DONE_CHANNEL) == null) {
        manager.createNotificationChannel(
          NotificationChannel(DONE_CHANNEL, "Finished downloads", NotificationManager.IMPORTANCE_DEFAULT).apply {
            description = "Tells you when a download is saved, or why it failed."
          },
        )
      }
    }
  }
}
