package com.jarod85.litesocial.youtube

import com.jarod85.litesocial.youtube.Captions.Cue
import org.junit.Assert.assertEquals
import org.junit.Test

class CaptionsTest {
  @Test
  fun `reads YouTube's srv1 transcript, unescaping twice`() {
    val xml = """<?xml version="1.0" encoding="utf-8" ?><transcript>
      <text start="0.5" dur="2">It&amp;#39;s &amp;quot;fine&amp;quot;</text>
      <text start="2.1" dur="3.5">second
line</text>
      <text start="9" dur="1"></text>
    </transcript>"""
    assertEquals(
      listOf(Cue(500, 2100, "It's \"fine\""), Cue(2100, 5600, "second\nline")),
      Captions.parseTranscript(xml),
    )
  }

  @Test
  fun `reads YouTube's TTML`() {
    val xml = """<?xml version="1.0" encoding="utf-8" ?><tt xml:lang="en" xmlns="http://www.w3.org/ns/ttml"><head><styling>
      <style xml:id="s1"/></styling></head><body><div>
      <p begin="00:00:01.200" end="00:00:04.000" style="s1">All right, so here we are<br />in front of the
        elephants</p>
      <p begin="00:00:04.000" dur="2.5s">Tom &amp; <span tts:fontStyle="italic">Jerry</span></p>
      <p begin="1:00:00.05" end="1:00:01">late</p>
    </div></body></tt>"""
    assertEquals(
      listOf(
        Cue(1200, 4000, "All right, so here we are\nin front of the elephants"),
        Cue(4000, 6500, "Tom & Jerry"),
        Cue(3_600_050, 3_601_000, "late"),
      ),
      Captions.parseTtml(xml),
    )
  }

  @Test
  fun `reads uploaded WebVTT captions without their markup`() {
    val vtt = "WEBVTT\nKind: captions\nLanguage: en\n\n" +
      "1\n00:00:01.000 --> 00:00:03.500 align:start position:0%\n<i>Hello</i> &amp; welcome\n\n" +
      "01:02:03.250 --> 01:02:04.000\nLater\nTwo lines\n"
    assertEquals(
      listOf(Cue(1000, 3500, "Hello & welcome"), Cue(3_723_250, 3_724_000, "Later\nTwo lines")),
      Captions.parseVtt(vtt),
    )
  }

  @Test
  fun `shows each line of rolling automatic captions once`() {
    val vtt = "WEBVTT\n\n" +
      "00:00:00.030 --> 00:00:02.270 align:start position:0%\n \nin<00:00:00.539><c> this</c><00:00:00.780><c> video</c>\n\n" +
      "00:00:02.270 --> 00:00:02.280 align:start position:0%\nin this video\n \n\n" +
      "00:00:02.280 --> 00:00:04.990 align:start position:0%\nin this video\nwe<00:00:02.600><c> talk</c>\n\n"
    assertEquals(
      listOf(Cue(30, 2270, "in this video"), Cue(2280, 4990, "we talk")),
      Captions.parseVtt(vtt, rolling = true),
    )
  }

  @Test
  fun `cuts overlapping cues and merges repeats`() {
    val cues = listOf(Cue(0, 5000, "a"), Cue(3000, 4000, "b"), Cue(4000, 4500, "b"), Cue(9000, 8000, "bad"))
    assertEquals(listOf(Cue(0, 3000, "a"), Cue(3000, 4500, "b")), Captions.flatten(cues))
  }

  @Test
  fun `writes SubRip`() {
    assertEquals(
      "1\r\n00:00:01,000 --> 01:00:02,345\r\nHi\r\nthere\r\n\r\n",
      Captions.toSrt(listOf(Cue(1000, 3_602_345, "Hi\nthere"))),
    )
  }

  @Test
  fun `names languages the way MP4 does`() {
    assertEquals("eng", Captions.iso3Language("en"))
    assertEquals("zho", Captions.iso3Language("zh-CN"))
    assertEquals("por", Captions.iso3Language("pt-BR"))
    assertEquals(0x15C7, Mp4Text.packLanguage("eng"))
  }
}
