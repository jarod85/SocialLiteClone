package com.jarod85.litesocial.updater

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import androidx.core.content.FileProvider
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** Its own class so it never clashes with another library's FileProvider entry in the manifest. */
class UpdateFileProvider : FileProvider()

/**
 * Installs new versions of Lite Social published as GitHub Releases
 * (JS side: src/features/updates). Downloads the APK, checks it really is a
 * newer Lite Social signed with the same key as the installed app, then hands
 * it to Android's installer, where you confirm.
 */
class AppUpdaterModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private class UpdateException(code: String, message: String) : CodedException(code, message, null)

  override fun definition() = ModuleDefinition {
    Name("LiteSocialUpdater")
    Events(PROGRESS_EVENT)

    Function("getInstalledVersion") {
      val info = installedInfo()
      mapOf("versionName" to (info.versionName ?: "0"), "versionCode" to info.longVersionCode.toDouble())
    }

    /** "Install unknown apps" for Lite Social: needed once before it can install its own updates. */
    Function("canInstallPackages") { context.packageManager.canRequestPackageInstalls() }

    Function("openInstallPermissionSettings") {
      val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      try {
        context.startActivity(intent)
      } catch (_: ActivityNotFoundException) {
        context.startActivity(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
    }

    AsyncFunction("downloadAndInstall") Coroutine { url: String ->
      withContext(Dispatchers.IO) {
        val apk = download(url)
        verify(apk)
        withContext(Dispatchers.Main) { install(apk) }
      }
    }
  }

  private fun installedInfo(): PackageInfo =
    context.packageManager.getPackageInfo(
      context.packageName,
      PackageManager.PackageInfoFlags.of(PackageManager.GET_SIGNING_CERTIFICATES.toLong()),
    )

  /** Only GitHub, only HTTPS: that's where releases are published. */
  private fun checkHost(url: URL) {
    val host = url.host.lowercase()
    val allowed = host == "github.com" || host.endsWith(".githubusercontent.com")
    if (url.protocol != "https" || !allowed) throw UpdateException("ERR_UPDATE_SOURCE", "Updates only come from GitHub ($host isn't).")
  }

  private fun download(address: String): File {
    var url = URL(address)
    val target = File(File(context.cacheDir, "updates").apply { mkdirs() }, "update.apk")
    target.delete()
    // Follow GitHub's redirect to its download host by hand, checking every hop.
    repeat(5) {
      checkHost(url)
      val connection = url.openConnection() as HttpURLConnection
      try {
        connection.instanceFollowRedirects = false
        connection.connectTimeout = 15_000
        connection.readTimeout = 30_000
        val code = connection.responseCode
        if (code in 300..399) {
          url = URL(url, connection.getHeaderField("Location") ?: throw IOException("Redirect without a location"))
          return@repeat
        }
        if (code != 200) throw IOException("HTTP $code")
        val total = connection.contentLengthLong
        var done = 0L
        var lastSent = 0L
        connection.inputStream.use { input ->
          target.outputStream().use { output ->
            val buffer = ByteArray(256 * 1024)
            while (true) {
              val n = input.read(buffer)
              if (n < 0) break
              output.write(buffer, 0, n)
              done += n
              val now = System.currentTimeMillis()
              if (total > 0 && now - lastSent > 250) {
                lastSent = now
                sendEvent(PROGRESS_EVENT, mapOf("progress" to done.toDouble() / total))
              }
            }
          }
        }
        if (total > 0 && done != total) throw IOException("The download stopped early")
        sendEvent(PROGRESS_EVENT, mapOf("progress" to 1.0))
        return target
      } finally {
        connection.disconnect()
      }
    }
    throw IOException("Too many redirects")
  }

  /** Same app, newer version, same signing key. Android checks the key too; this gives a clear message first. */
  private fun verify(apk: File) {
    val pm = context.packageManager
    val update = pm.getPackageArchiveInfo(
      apk.absolutePath,
      PackageManager.PackageInfoFlags.of(PackageManager.GET_SIGNING_CERTIFICATES.toLong()),
    ) ?: throw UpdateException("ERR_UPDATE_INVALID", "The downloaded file isn't a valid app.")
    if (update.packageName != context.packageName) {
      throw UpdateException("ERR_UPDATE_INVALID", "The download is a different app (${update.packageName}).")
    }
    val installed = installedInfo()
    if (update.longVersionCode <= installed.longVersionCode) {
      throw UpdateException("ERR_UPDATE_NOT_NEWER", "You already have this version or a newer one.")
    }
    val updateSigners = update.signingInfo?.apkContentsSigners?.map { it.toCharsString() }?.toSet().orEmpty()
    val installedSigners = installed.signingInfo?.apkContentsSigners?.map { it.toCharsString() }?.toSet().orEmpty()
    if (updateSigners.isEmpty() || updateSigners != installedSigners) {
      throw UpdateException(
        "ERR_UPDATE_SIGNATURE",
        "This update is signed with a different key than the installed app, so Android won't install it over it.",
      )
    }
  }

  private fun install(apk: File) {
    if (!context.packageManager.canRequestPackageInstalls()) {
      throw UpdateException("ERR_UPDATE_PERMISSION", "Lite Social isn't allowed to install apps yet.")
    }
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.updates", apk)
    val intent = Intent(Intent.ACTION_VIEW)
      .setDataAndType(uri, "application/vnd.android.package-archive")
      .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
    context.startActivity(intent)
  }

  companion object {
    private const val PROGRESS_EVENT = "onUpdateProgress"
  }
}
