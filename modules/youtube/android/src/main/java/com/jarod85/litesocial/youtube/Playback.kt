package com.jarod85.litesocial.youtube

import android.content.Context
import org.schabi.newpipe.extractor.MediaFormat
import org.schabi.newpipe.extractor.stream.AudioStream
import org.schabi.newpipe.extractor.stream.AudioTrackType
import org.schabi.newpipe.extractor.stream.DeliveryMethod
import org.schabi.newpipe.extractor.stream.Stream
import org.schabi.newpipe.extractor.stream.StreamInfo
import org.schabi.newpipe.extractor.stream.StreamType
import org.schabi.newpipe.extractor.stream.VideoStream
import java.io.File
import java.util.Locale

/**
 * Turns a video's streams into something expo-video (ExoPlayer) can play.
 *
 * YouTube serves separate video and audio files for anything above 360p. A
 * small DASH manifest listing them lets ExoPlayer play both together and
 * switch quality as bandwidth changes, the way NewPipe does it. The manifest
 * is a local file; the media itself streams from YouTube with range requests.
 * There are no ads: only the video's own streams are ever requested.
 */
object Playback {
  /** Phones gain nothing from more; it also keeps everything on H.264, which every device decodes in hardware. */
  private const val MAX_HEIGHT = 1080

  /**
   * Playable sources, best first. The app falls back to the next one if a
   * source fails to load: DASH (up to 1080p), then YouTube's HLS manifest,
   * then the single 360p file that has video and audio together.
   */
  fun sources(context: Context, info: StreamInfo): List<Map<String, Any?>> {
    val sources = mutableListOf<Map<String, Any?>>()
    val isLive = info.streamType == StreamType.LIVE_STREAM || info.streamType == StreamType.AUDIO_LIVE_STREAM
    if (!isLive) {
      val video = adaptiveVideo(info)
      val audio = adaptiveAudio(info)
      if (video.isNotEmpty() && audio.isNotEmpty()) {
        val file = File(File(context.cacheDir, "youtube").apply { mkdirs() }, "${info.id}.mpd")
        file.writeText(manifest(durationMs(info, video + audio), video, audio))
        sources += mapOf("uri" to "file://${file.absolutePath}", "contentType" to "dash")
      }
    }
    if (info.hlsUrl.isNotEmpty()) sources += mapOf("uri" to info.hlsUrl, "contentType" to "hls")
    if (isLive && info.dashMpdUrl.isNotEmpty()) sources += mapOf("uri" to info.dashMpdUrl, "contentType" to "dash")
    info.videoStreams
      .filter { it.isUrl && it.deliveryMethod == DeliveryMethod.PROGRESSIVE_HTTP }
      .maxByOrNull { height(it) }
      ?.let { sources += mapOf("uri" to it.content, "contentType" to "progressive") }
    return sources
  }

  /** H.264 MP4 video-only streams up to MAX_HEIGHT that have the byte ranges a DASH manifest needs. */
  fun adaptiveVideo(info: StreamInfo): List<VideoStream> =
    info.videoOnlyStreams
      .filter { usable(it) && it.format == MediaFormat.MPEG_4 && it.codec.orEmpty().startsWith("avc1") && height(it) in 1..MAX_HEIGHT }
      .distinctBy { it.itag }
      .sortedBy { it.bitrate }

  /** AAC audio in the video's original language (dubbed tracks are skipped). */
  fun adaptiveAudio(info: StreamInfo): List<AudioStream> {
    val aac = info.audioStreams.filter { usable(it) && it.format == MediaFormat.M4A }
    return originalTrack(aac).distinctBy { it.itag }.sortedBy { it.averageBitrate }
  }

  /** Of several audio tracks (original plus dubs), the original one; otherwise everything. */
  fun <T : AudioStream> originalTrack(streams: List<T>): List<T> {
    val byTrack = streams.groupBy { it.audioTrackId }
    if (byTrack.size <= 1) return streams
    return streams.filter { it.audioTrackType == AudioTrackType.ORIGINAL }.ifEmpty {
      byTrack.values.first()
    }
  }

  private fun usable(stream: Stream): Boolean {
    val (initEnd, indexStart, indexEnd) = when (stream) {
      is VideoStream -> Triple(stream.initEnd, stream.indexStart, stream.indexEnd)
      is AudioStream -> Triple(stream.initEnd, stream.indexStart, stream.indexEnd)
      else -> return false
    }
    return stream.isUrl && stream.deliveryMethod == DeliveryMethod.PROGRESSIVE_HTTP &&
      stream.itagItem != null && initEnd > 0 && indexStart > initEnd && indexEnd > indexStart
  }

  fun height(stream: VideoStream): Int =
    stream.height.takeIf { it > 0 } ?: Regex("(\\d+)p").find(stream.resolution.orEmpty())?.groupValues?.get(1)?.toIntOrNull() ?: 0

  private fun durationMs(info: StreamInfo, streams: List<Stream>): Long {
    val fromItags = streams.mapNotNull { it.itagItem?.approxDurationMs }.filter { it > 0 }.maxOrNull()
    return fromItags ?: (info.duration * 1000)
  }

  fun manifest(durationMs: Long, video: List<VideoStream>, audio: List<AudioStream>): String {
    val duration = String.format(Locale.US, "PT%.3fS", durationMs / 1000.0)
    val sb = StringBuilder()
    sb.append("""<?xml version="1.0" encoding="UTF-8"?>""").append('\n')
    sb.append("""<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011" type="static" minBufferTime="PT1.500S" mediaPresentationDuration="$duration">""")
    sb.append("""<Period id="0" duration="$duration">""")

    sb.append("""<AdaptationSet id="0" contentType="video" mimeType="video/mp4" subsegmentAlignment="true" subsegmentStartsWithSAP="1">""")
    for (v in video) {
      val item = v.itagItem!!
      val width = item.width.takeIf { it > 0 } ?: (height(v) * 16 / 9)
      val fps = v.fps.takeIf { it > 0 }?.let { """ frameRate="$it"""" } ?: ""
      sb.append("""<Representation id="${v.itag}" codecs="${xml(v.codec)}" bandwidth="${maxOf(v.bitrate, 1)}" width="$width" height="${height(v)}"$fps>""")
      segment(sb, v.content, v.initStart, v.initEnd, v.indexStart, v.indexEnd)
      sb.append("</Representation>")
    }
    sb.append("</AdaptationSet>")

    sb.append("""<AdaptationSet id="1" contentType="audio" mimeType="audio/mp4" subsegmentAlignment="true" subsegmentStartsWithSAP="1">""")
    for (a in audio) {
      val item = a.itagItem!!
      val rate = item.sampleRate.takeIf { it > 0 }?.let { """ audioSamplingRate="$it"""" } ?: ""
      val bandwidth = a.bitrate.takeIf { it > 0 } ?: (a.averageBitrate * 1000)
      sb.append("""<Representation id="${a.itag}" codecs="${xml(a.codec)}" bandwidth="${maxOf(bandwidth, 1)}"$rate>""")
      sb.append("""<AudioChannelConfiguration schemeIdUri="urn:mpeg:dash:23003:3:audio_channel_configuration:2011" value="${item.audioChannels.takeIf { it > 0 } ?: 2}"/>""")
      segment(sb, a.content, a.initStart, a.initEnd, a.indexStart, a.indexEnd)
      sb.append("</Representation>")
    }
    sb.append("</AdaptationSet>")

    sb.append("</Period></MPD>")
    return sb.toString()
  }

  private fun segment(sb: StringBuilder, url: String, initStart: Int, initEnd: Int, indexStart: Int, indexEnd: Int) {
    sb.append("<BaseURL>").append(xml(url)).append("</BaseURL>")
    sb.append("""<SegmentBase indexRange="$indexStart-$indexEnd"><Initialization range="$initStart-$initEnd"/></SegmentBase>""")
  }

  private fun xml(text: String?): String = (text ?: "")
    .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;")
}
