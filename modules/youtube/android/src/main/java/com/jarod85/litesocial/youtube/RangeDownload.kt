package com.jarod85.litesocial.youtube

import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.CancellationException

/**
 * Downloads a YouTube media file in 8 MB ranges. YouTube slows down or cuts
 * off single large requests for these files; ranged requests, like the
 * player's own, get full speed. Each range is retried a few times.
 */
object RangeDownload {
  private const val CHUNK = 8L * 1024 * 1024
  private const val RETRIES = 3

  /**
   * @param knownLength the size YouTube reported, or 0 to read it from the first response
   * @param onProgress called with bytes done and total
   */
  fun download(
    url: String,
    target: File,
    knownLength: Long,
    isCancelled: () -> Boolean,
    onProgress: (Long, Long) -> Unit,
  ) {
    target.parentFile?.mkdirs()
    RandomAccessFile(target, "rw").use { out ->
      out.setLength(0)
      var total = knownLength
      var done = 0L
      while (total <= 0 || done < total) {
        if (isCancelled()) throw CancellationException()
        val end = if (total > 0) minOf(done + CHUNK, total) - 1 else done + CHUNK - 1
        val (bytes, reportedTotal) = fetchRange(url, done, end, out, isCancelled)
        if (total <= 0) total = reportedTotal
        if (bytes == 0L) {
          if (total <= 0) break // Unknown length and nothing more: finished.
          throw IOException("YouTube sent no data at byte $done of $total")
        }
        done += bytes
        onProgress(done, maxOf(total, done))
        if (total <= 0 && bytes < end - (done - bytes) + 1) break // Short read with unknown length: end of file.
      }
    }
  }

  /** Returns (bytes written, total size from Content-Range or 0). */
  private fun fetchRange(url: String, start: Long, end: Long, out: RandomAccessFile, isCancelled: () -> Boolean): Pair<Long, Long> {
    var lastError: IOException? = null
    repeat(RETRIES) { attempt ->
      if (isCancelled()) throw CancellationException()
      val connection = URL(url).openConnection() as HttpURLConnection
      try {
        connection.connectTimeout = 15_000
        connection.readTimeout = 30_000
        connection.setRequestProperty("User-Agent", Extractor.BROWSER_USER_AGENT)
        connection.setRequestProperty("Range", "bytes=$start-$end")
        val code = connection.responseCode
        if (code == 416) return 0L to 0L
        if (code != 206 && code != 200) throw IOException("HTTP $code")
        val total = connection.getHeaderField("Content-Range")?.substringAfterLast('/')?.toLongOrNull() ?: 0L
        // A 200 means the server ignored the range and sends the whole file from the start.
        val writeFrom = if (code == 200) 0L else start
        out.seek(writeFrom)
        var written = 0L
        connection.inputStream.use { input ->
          val buffer = ByteArray(64 * 1024)
          while (true) {
            if (isCancelled()) throw CancellationException()
            val n = input.read(buffer)
            if (n < 0) break
            out.write(buffer, 0, n)
            written += n
          }
        }
        return (if (code == 200) written - start else written) to total
      } catch (e: IOException) {
        lastError = e
        out.seek(start)
        Thread.sleep(1000L * (attempt + 1))
      } finally {
        connection.disconnect()
      }
    }
    throw lastError ?: IOException("Download failed")
  }
}
