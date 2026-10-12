package com.jarod85.litesocial.youtube

import com.jarod85.litesocial.youtube.Captions.Cue
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.ByteBuffer

class Mp4TextTest {
  // ------------------------------------------------- a tiny MP4, as MediaMuxer lays it out

  private fun box(type: String, vararg parts: ByteArray): ByteArray {
    val body = parts.fold(ByteArray(0)) { acc, p -> acc + p }
    return ByteBuffer.allocate(8).putInt(8 + body.size).put(type.toByteArray()).array() + body
  }

  private fun int(v: Int) = ByteBuffer.allocate(4).putInt(v).array()

  private fun mvhd(timescale: Int, duration: Int, nextTrackId: Int) =
    box("mvhd", int(0), int(0), int(0), int(timescale), int(duration), ByteArray(4 + 2 + 10 + 36 + 24), int(nextTrackId))

  private fun videoTrak(width: Int, height: Int) = box(
    "trak",
    box("tkhd", int(3), ByteArray(4 * 5 + 8 + 8 + 36), int(width shl 16), int(height shl 16)),
    box("mdia", box("hdlr", int(0), int(0), "vide".toByteArray(), ByteArray(12), byteArrayOf(0))),
  )

  private val media = ByteArray(1000) { (it % 251).toByte() }

  private fun sample(): File {
    val file = File.createTempFile("mp4text", ".mp4")
    file.deleteOnExit()
    file.writeBytes(
      box("ftyp", "isom".toByteArray(), int(0)) + box("mdat", media) + box("moov", mvhd(1000, 10_000, 2), videoTrak(1280, 720)),
    )
    return file
  }

  // ------------------------------------------------- reading the result

  private data class Found(val type: String, val start: Int, val end: Int) // start: after the header

  private fun children(data: ByteArray, from: Int, to: Int): List<Found> {
    val out = mutableListOf<Found>()
    var at = from
    while (at + 8 <= to) {
      val size = ByteBuffer.wrap(data, at, 4).int
      out += Found(String(data, at + 4, 4), at + 8, at + size)
      at += size
    }
    return out
  }

  private fun ByteArray.int(at: Int) = ByteBuffer.wrap(this, at, 4).int

  private fun path(data: ByteArray, parent: Found, vararg types: String): Found =
    types.fold(parent) { box, type -> children(data, box.start, box.end).first { it.type == type } }

  @Test
  fun `appends a tx3g track and leaves the video's bytes where they were`() {
    val file = sample()
    val before = file.readBytes()
    Mp4Text.addTrack(file, listOf(Cue(1000, 2500, "Hello"), Cue(4000, 5000, "Bye")), "eng", "English")
    val data = file.readBytes()

    val top = children(data, 0, data.size)
    assertEquals(listOf("ftyp", "mdat", "free", "mdat", "moov"), top.map { it.type })
    // Everything up to the old index is unchanged, so the video's offsets still hold.
    val oldMoov = top[2]
    assertArrayEquals(before.copyOfRange(0, oldMoov.start - 4), data.copyOfRange(0, oldMoov.start - 4))

    val moov = top[4]
    val mvhd = children(data, moov.start, moov.end).first { it.type == "mvhd" }
    assertEquals(3, data.int(mvhd.end - 4)) // next_track_ID: the text track took 2

    val traks = children(data, moov.start, moov.end).filter { it.type == "trak" }
    assertEquals(2, traks.size)
    val text = traks[1]
    val tkhd = path(data, text, "tkhd")
    assertEquals(3, data.int(tkhd.start) and 0xFFFFFF) // enabled, in movie
    assertEquals(2, data.int(tkhd.start + 12)) // track id
    assertEquals(10_000, data.int(tkhd.start + 20)) // duration in the movie's timescale
    assertEquals(1280, data.int(tkhd.end - 8) ushr 16)
    assertEquals(720, data.int(tkhd.end - 4) ushr 16)

    val mdhd = path(data, text, "mdia", "mdhd")
    assertEquals(1000, data.int(mdhd.start + 12))
    assertEquals(10_000, data.int(mdhd.start + 16))
    assertEquals(Mp4Text.packLanguage("eng"), ByteBuffer.wrap(data, mdhd.start + 20, 2).short.toInt())
    val hdlr = path(data, text, "mdia", "hdlr")
    assertEquals("sbtl", String(data, hdlr.start + 8, 4))
    assertEquals("English", String(data, hdlr.start + 24, hdlr.end - hdlr.start - 25))

    val stbl = path(data, text, "mdia", "minf", "stbl")
    val stsd = path(data, stbl, "stsd")
    assertEquals("tx3g", String(data, stsd.start + 12, 4))

    // Samples: gap, "Hello", gap, "Bye", gap to the end (10 s).
    val stts = path(data, stbl, "stts")
    val runs = data.int(stts.start + 4)
    val durations = (0 until runs).flatMap { i -> List(data.int(stts.start + 8 + i * 8)) { data.int(stts.start + 12 + i * 8) } }
    assertEquals(listOf(1000, 1500, 1500, 1000, 5000), durations)
    val stsz = path(data, stbl, "stsz")
    val sizes = (0 until data.int(stsz.start + 8)).map { data.int(stsz.start + 12 + it * 4) }
    assertEquals(listOf(2, 7, 2, 5, 2), sizes)
    val stsc = path(data, stbl, "stsc")
    assertEquals(listOf(1, 1, 5, 1), (0 until 4).map { data.int(stsc.start + 4 + it * 4) })

    // The chunk offset points at the samples in the new mdat.
    val stco = path(data, stbl, "stco")
    val offset = data.int(stco.start + 8)
    assertEquals(top[3].start, offset)
    val first = offset + sizes[0]
    assertEquals(5, ByteBuffer.wrap(data, first, 2).short.toInt())
    assertEquals("Hello", String(data, first + 2, 5))
    assertEquals(0, ByteBuffer.wrap(data, offset, 2).short.toInt())
  }

  @Test
  fun `leaves the file untouched when it isn't an MP4 it understands`() {
    val file = File.createTempFile("mp4text", ".mp4")
    file.deleteOnExit()
    val junk = box("ftyp", "isom".toByteArray()) + box("mdat", media)
    file.writeBytes(junk)
    val failed = runCatching { Mp4Text.addTrack(file, listOf(Cue(0, 1000, "x")), "eng", "English") }.isFailure
    assertTrue(failed)
    assertArrayEquals(junk, file.readBytes())
  }

  @Test
  fun `covers the whole video with samples, clipping captions past its end`() {
    val samples = Mp4Text.samples(listOf(Cue(0, 1000, "a"), Cue(900, 3000, "b"), Cue(5000, 6000, "late")), 2000)
    assertEquals(listOf(1000L, 1000L), samples.map { it.durationMs })
  }
}
