package com.jarod85.litesocial.youtube

import java.io.ByteArrayOutputStream

/**
 * A minimal ID3v2.3 tag (title, artist, album, cover) so music players like
 * Musicolet show the song properly. Text is UTF-16 with BOM, which v2.3
 * readers all understand.
 */
object Id3Tag {
  fun build(title: String, artist: String?, album: String?, coverJpeg: ByteArray?): ByteArray {
    val frames = ByteArrayOutputStream()
    frames.write(textFrame("TIT2", title))
    artist?.takeIf { it.isNotBlank() }?.let { frames.write(textFrame("TPE1", it)) }
    album?.takeIf { it.isNotBlank() }?.let { frames.write(textFrame("TALB", it)) }
    coverJpeg?.let { frames.write(pictureFrame(it)) }
    val body = frames.toByteArray()

    val tag = ByteArrayOutputStream()
    tag.write(byteArrayOf('I'.code.toByte(), 'D'.code.toByte(), '3'.code.toByte(), 3, 0, 0))
    tag.write(syncSafe(body.size))
    tag.write(body)
    return tag.toByteArray()
  }

  private fun textFrame(id: String, text: String): ByteArray {
    val content = ByteArrayOutputStream()
    content.write(1) // UTF-16 with BOM
    content.write(text.toByteArray(Charsets.UTF_16)) // Java's UTF_16 writes a big-endian BOM.
    return frame(id, content.toByteArray())
  }

  private fun pictureFrame(jpeg: ByteArray): ByteArray {
    val content = ByteArrayOutputStream()
    content.write(0) // ISO-8859-1 for the description
    content.write("image/jpeg".toByteArray(Charsets.ISO_8859_1))
    content.write(0)
    content.write(3) // Front cover
    content.write(0) // Empty description
    content.write(jpeg)
    return frame("APIC", content.toByteArray())
  }

  private fun frame(id: String, content: ByteArray): ByteArray {
    val out = ByteArrayOutputStream()
    out.write(id.toByteArray(Charsets.ISO_8859_1))
    out.write(bigEndian(content.size)) // v2.3 frame sizes are plain 32-bit integers.
    out.write(byteArrayOf(0, 0))
    out.write(content)
    return out.toByteArray()
  }

  private fun bigEndian(n: Int) = byteArrayOf((n ushr 24).toByte(), (n ushr 16).toByte(), (n ushr 8).toByte(), n.toByte())

  /** The tag header's size uses 7 bits per byte. */
  private fun syncSafe(n: Int) = byteArrayOf(
    ((n ushr 21) and 0x7F).toByte(),
    ((n ushr 14) and 0x7F).toByte(),
    ((n ushr 7) and 0x7F).toByte(),
    (n and 0x7F).toByte(),
  )
}
