package com.jarod85.litesocial.youtube

import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.nio.ByteBuffer

/**
 * Adds captions to a finished MP4 as a subtitle track: 3GPP timed text
 * ("tx3g", what ffmpeg calls mov_text), which Android's players, VLC, MX
 * Player and others list as a subtitle track. Android's MediaMuxer can't
 * write text tracks, so this edits the file's index (the "moov" box) itself.
 *
 * Nothing that's already in the file moves: the caption samples and a new
 * index (the old one plus the new track) are appended at the end, then the old
 * index is turned into padding ("free"). If anything fails before that last
 * 4-byte write, the file is cut back to how it was, so the video stays intact.
 *
 * Pure Kotlin, unit-tested on the JVM.
 */
object Mp4Text {
  private const val TIMESCALE = 1000L // The text track counts in milliseconds.
  private const val MAX_TEXT_BYTES = 65_535

  private data class Box(val type: String, val offset: Long, val size: Long, val headerSize: Int)

  fun addTrack(file: File, cues: List<Captions.Cue>, language: String, name: String) {
    RandomAccessFile(file, "rw").use { raf ->
      val originalLength = raf.length()
      val boxes = topLevelBoxes(raf)
      val moovBox = boxes.singleOrNull { it.type == "moov" } ?: throw IOException("The video has no index (moov)")
      if (moovBox.size > 64L * 1024 * 1024) throw IOException("The video's index is too large")
      val moov = ByteArray(moovBox.size.toInt())
      raf.seek(moovBox.offset)
      raf.readFully(moov)

      val children = childBoxes(moov, moovBox.headerSize, moov.size)
      val mvhd = children.firstOrNull { it.type == "mvhd" } ?: throw IOException("The video has no movie header")
      val movie = parseMvhd(moov, mvhd)
      val trackId = readInt(moov, movie.nextTrackIdAt).toLong().coerceAtLeast(1)
      val (width, height) = videoSize(moov, children)

      val totalMs = movie.duration * TIMESCALE / movie.timescale.coerceAtLeast(1)
      if (totalMs <= 0) throw IOException("The video has no duration")
      val samples = samples(cues, totalMs)
      val data = ByteArrayOutputStream().apply { samples.forEach { write(it.bytes) } }.toByteArray()

      // Appended: [mdat with the caption samples][new moov]
      val mdatOffset = originalLength
      val chunkOffset = mdatOffset + 8
      val trak = trak(trackId, movie, totalMs, width, height, language, name, samples, chunkOffset)
      val newMoov = ByteArrayOutputStream()
      val body = ByteArrayOutputStream()
      for (child in children) {
        val bytes = moov.copyOfRange(child.offset.toInt(), (child.offset + child.size).toInt())
        if (child.type == "mvhd") writeInt(bytes, movie.nextTrackIdAt - child.offset.toInt(), (trackId + 1).toInt())
        body.write(bytes)
      }
      body.write(trak)
      newMoov.write(header(8 + body.size().toLong(), "moov"))
      body.writeTo(newMoov)

      try {
        raf.seek(originalLength)
        raf.write(header(8L + data.size, "mdat"))
        raf.write(data)
        raf.write(newMoov.toByteArray())
        raf.fd.sync()
        // Last: the old index becomes padding. Until here, players still read the old one.
        raf.seek(moovBox.offset + 4)
        raf.write("free".toByteArray(Charsets.US_ASCII))
      } catch (e: Exception) {
        runCatching { raf.setLength(originalLength) }
        throw e
      }
    }
  }

  // ------------------------------------------------------------------ samples

  class Sample(val durationMs: Long, val bytes: ByteArray)

  /**
   * The whole timeline as samples: each caption, and empty samples in the
   * gaps (an empty sample clears the screen), up to the end of the video.
   */
  fun samples(cues: List<Captions.Cue>, totalMs: Long): List<Sample> {
    val out = mutableListOf<Sample>()
    var t = 0L
    for (cue in cues.sortedBy { it.startMs }) {
      val start = cue.startMs.coerceAtLeast(t)
      val end = cue.endMs.coerceAtMost(totalMs)
      if (start >= totalMs) break
      if (end <= start) continue
      if (start > t) out += Sample(start - t, text(""))
      out += Sample(end - start, text(cue.text))
      t = end
    }
    if (totalMs > t) out += Sample(totalMs - t, text(""))
    return out
  }

  /** A tx3g sample: 16-bit length, then UTF-8 text. */
  private fun text(value: String): ByteArray {
    var utf8 = value.toByteArray(Charsets.UTF_8)
    if (utf8.size > MAX_TEXT_BYTES) utf8 = utf8.copyOf(MAX_TEXT_BYTES)
    return ByteBuffer.allocate(2 + utf8.size).putShort(utf8.size.toShort()).put(utf8).array()
  }

  // ------------------------------------------------------------------- boxes

  private fun trak(
    trackId: Long,
    movie: Movie,
    totalMs: Long,
    width: Int,
    height: Int,
    language: String,
    name: String,
    samples: List<Sample>,
    chunkOffset: Long,
  ): ByteArray {
    val movieDuration = totalMs * movie.timescale / TIMESCALE
    val tkhd = fullBox(
      "tkhd", 0, 0x000003, // enabled, in movie: players that honour it show the captions straight away
      int(0), int(0), int(trackId), int(0), int(movieDuration),
      zeros(8), short(0), short(0), short(0), short(0),
      matrix(), int(width shl 16), int(height shl 16),
    )
    val mdhd = fullBox("mdhd", 0, 0, int(0), int(0), int(TIMESCALE), int(totalMs), short(packLanguage(language)), short(0))
    val hdlr = fullBox("hdlr", 0, 0, int(0), ascii("sbtl"), zeros(12), name.toByteArray(Charsets.UTF_8), byteArrayOf(0))
    val dinf = box("dinf", fullBox("dref", 0, 0, int(1), fullBox("url ", 0, 1)))
    val stbl = box("stbl", stsd(), stts(samples), stsc(samples.size), stsz(samples), chunkOffsets(chunkOffset))
    val minf = box("minf", fullBox("nmhd", 0, 0), dinf, stbl)
    return box("trak", tkhd, box("mdia", mdhd, hdlr, minf))
  }

  /** One tx3g sample entry: centred at the bottom, white text, no background (ffmpeg's defaults). */
  private fun stsd(): ByteArray {
    val fontName = "Sans-Serif".toByteArray(Charsets.US_ASCII)
    val ftab = box("ftab", short(1), short(1), byteArrayOf(fontName.size.toByte()), fontName)
    val tx3g = box(
      "tx3g",
      zeros(6), short(1), // reserved, data reference index
      int(0), // display flags
      byteArrayOf(1, -1), // horizontal: centre; vertical: bottom
      int(0), // background colour (transparent)
      short(0), short(0), short(0), short(0), // default text box: whole frame
      short(0), short(0), short(1), byteArrayOf(0, 18), int(-1), // style: font 1, plain, 18, white
      ftab,
    )
    return fullBox("stsd", 0, 0, int(1), tx3g)
  }

  private fun stts(samples: List<Sample>): ByteArray {
    val runs = mutableListOf<Pair<Long, Int>>() // duration, count
    for (s in samples) {
      val last = runs.lastOrNull()
      if (last != null && last.first == s.durationMs) runs[runs.size - 1] = last.first to last.second + 1 else runs += s.durationMs to 1
    }
    return fullBox("stts", 0, 0, int(runs.size.toLong()), *runs.flatMap { listOf(int(it.second.toLong()), int(it.first)) }.toTypedArray())
  }

  /** Every sample in one chunk. */
  private fun stsc(count: Int): ByteArray = fullBox("stsc", 0, 0, int(1), int(1), int(count.toLong()), int(1))

  private fun stsz(samples: List<Sample>): ByteArray =
    fullBox("stsz", 0, 0, int(0), int(samples.size.toLong()), *samples.map { int(it.bytes.size.toLong()) }.toTypedArray())

  private fun chunkOffsets(offset: Long): ByteArray =
    if (offset > 0xFFFF_FFFFL) fullBox("co64", 0, 0, int(1), long(offset)) else fullBox("stco", 0, 0, int(1), int(offset))

  // ------------------------------------------------------------------ reading

  private fun topLevelBoxes(raf: RandomAccessFile): List<Box> {
    val boxes = mutableListOf<Box>()
    val length = raf.length()
    var offset = 0L
    val head = ByteArray(16)
    while (offset + 8 <= length) {
      raf.seek(offset)
      raf.readFully(head, 0, 8)
      var size = readInt(head, 0).toLong() and 0xFFFF_FFFFL
      val type = String(head, 4, 4, Charsets.US_ASCII)
      var headerSize = 8
      if (size == 1L) {
        raf.readFully(head, 8, 8)
        size = ByteBuffer.wrap(head, 8, 8).long
        headerSize = 16
      } else if (size == 0L) {
        throw IOException("The video's '$type' box runs to the end of the file") // MediaMuxer never writes these.
      }
      if (size < headerSize || offset + size > length) throw IOException("The video file is damaged")
      boxes += Box(type, offset, size, headerSize)
      offset += size
    }
    return boxes
  }

  private fun childBoxes(data: ByteArray, from: Int, to: Int): List<Box> {
    val boxes = mutableListOf<Box>()
    var offset = from
    while (offset + 8 <= to) {
      val size = readInt(data, offset).toLong() and 0xFFFF_FFFFL
      val type = String(data, offset + 4, 4, Charsets.US_ASCII)
      if (size < 8 || offset + size > to) throw IOException("The video's index is damaged")
      boxes += Box(type, offset.toLong(), size, 8)
      offset += size.toInt()
    }
    return boxes
  }

  private class Movie(val timescale: Long, val duration: Long, val nextTrackIdAt: Int)

  private fun parseMvhd(data: ByteArray, box: Box): Movie {
    val start = box.offset.toInt() + 8
    val version = data[start].toInt()
    val v1 = version == 1
    val timescaleAt = start + 4 + if (v1) 16 else 8
    val timescale = readInt(data, timescaleAt).toLong() and 0xFFFF_FFFFL
    val duration = if (v1) ByteBuffer.wrap(data, timescaleAt + 4, 8).long else readInt(data, timescaleAt + 4).toLong() and 0xFFFF_FFFFL
    // next_track_ID is the header's last field.
    return Movie(timescale, duration, (box.offset + box.size - 4).toInt())
  }

  /** The first video track's display size, which the text track borrows (0×0 if there's none). */
  private fun videoSize(data: ByteArray, moovChildren: List<Box>): Pair<Int, Int> {
    for (trak in moovChildren.filter { it.type == "trak" }) {
      val parts = childBoxes(data, trak.offset.toInt() + 8, (trak.offset + trak.size).toInt())
      val tkhd = parts.firstOrNull { it.type == "tkhd" } ?: continue
      val mdia = parts.firstOrNull { it.type == "mdia" } ?: continue
      val hdlr = childBoxes(data, mdia.offset.toInt() + 8, (mdia.offset + mdia.size).toInt()).firstOrNull { it.type == "hdlr" } ?: continue
      if (String(data, hdlr.offset.toInt() + 16, 4, Charsets.US_ASCII) != "vide") continue
      val end = (tkhd.offset + tkhd.size).toInt()
      return (readInt(data, end - 8) ushr 16) to (readInt(data, end - 4) ushr 16)
    }
    return 0 to 0
  }

  // ------------------------------------------------------------------ writing

  private fun box(type: String, vararg parts: ByteArray): ByteArray {
    val size = 8L + parts.sumOf { it.size.toLong() }
    return ByteArrayOutputStream().apply {
      write(header(size, type))
      parts.forEach { write(it) }
    }.toByteArray()
  }

  private fun fullBox(type: String, version: Int, flags: Int, vararg parts: ByteArray): ByteArray =
    box(type, int(((version and 0xFF) shl 24 or (flags and 0xFFFFFF)).toLong()), *parts)

  private fun header(size: Long, type: String): ByteArray {
    if (size > 0xFFFF_FFFFL) throw IOException("Box too large")
    return int(size) + ascii(type)
  }

  private fun int(value: Long): ByteArray = ByteBuffer.allocate(4).putInt(value.toInt()).array()
  private fun int(value: Int): ByteArray = int(value.toLong())
  private fun long(value: Long): ByteArray = ByteBuffer.allocate(8).putLong(value).array()
  private fun short(value: Int): ByteArray = ByteBuffer.allocate(2).putShort(value.toShort()).array()
  private fun zeros(n: Int) = ByteArray(n)
  private fun ascii(text: String) = text.toByteArray(Charsets.US_ASCII)

  private fun matrix(): ByteArray =
    longArrayOf(0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000).map { int(it) }.reduce(ByteArray::plus)

  /** ISO 639-2/T code packed into 15 bits, as MP4 stores a track's language. */
  fun packLanguage(code: String): Int {
    val letters = code.lowercase().takeIf { it.length == 3 && it.all { c -> c in 'a'..'z' } } ?: "und"
    return letters.fold(0) { acc, c -> (acc shl 5) or (c - 'a' + 1) }
  }

  private fun readInt(data: ByteArray, at: Int): Int = ByteBuffer.wrap(data, at, 4).int

  private fun writeInt(data: ByteArray, at: Int, value: Int) {
    ByteBuffer.wrap(data, at, 4).putInt(value)
  }
}
