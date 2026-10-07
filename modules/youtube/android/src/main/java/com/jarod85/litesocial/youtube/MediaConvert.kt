package com.jarod85.litesocial.youtube

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import de.sciss.jump3r.mp3.BitStream
import de.sciss.jump3r.mp3.GainAnalysis
import de.sciss.jump3r.mp3.GetAudio
import de.sciss.jump3r.mp3.ID3Tag
import de.sciss.jump3r.mp3.Lame
import de.sciss.jump3r.mp3.LameGlobalFlags
import de.sciss.jump3r.mp3.MPEGMode
import de.sciss.jump3r.mp3.Parse
import de.sciss.jump3r.mp3.Presets
import de.sciss.jump3r.mp3.Quantize
import de.sciss.jump3r.mp3.QuantizePVT
import de.sciss.jump3r.mp3.Reservoir
import de.sciss.jump3r.mp3.Takehiro
import de.sciss.jump3r.mp3.VBRTag
import de.sciss.jump3r.mp3.Version
import de.sciss.jump3r.mpg.Common
import de.sciss.jump3r.mpg.Interface
import de.sciss.jump3r.mpg.MPGLib
import java.io.File
import java.io.IOException
import java.io.OutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.CancellationException

/**
 * Local media work for downloads, using only what Android itself ships
 * (MediaExtractor, MediaCodec, MediaMuxer) plus a pure-Java LAME port for MP3.
 */
object MediaConvert {
  /** Joins a video-only and an audio-only file into one MP4, interleaved by time. */
  fun muxMp4(videoFile: File, audioFile: File, output: File, isCancelled: () -> Boolean) {
    val video = MediaExtractor().apply { setDataSource(videoFile.absolutePath) }
    val audio = MediaExtractor().apply { setDataSource(audioFile.absolutePath) }
    val muxer = MediaMuxer(output.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    try {
      val videoTrack = selectTrack(video, "video/")
      val audioTrack = selectTrack(audio, "audio/")
      val outVideo = muxer.addTrack(video.getTrackFormat(videoTrack))
      val outAudio = muxer.addTrack(audio.getTrackFormat(audioTrack))
      muxer.start()

      val buffer = ByteBuffer.allocateDirect(4 * 1024 * 1024)
      val info = MediaCodec.BufferInfo()
      var videoDone = false
      var audioDone = false
      while (!videoDone || !audioDone) {
        if (isCancelled()) throw CancellationException()
        // Write whichever track is behind, so the file plays smoothly from any point.
        val useVideo = !videoDone && (audioDone || video.sampleTime <= audio.sampleTime)
        val extractor = if (useVideo) video else audio
        val size = extractor.readSampleData(buffer, 0)
        if (size < 0) {
          if (useVideo) videoDone = true else audioDone = true
          continue
        }
        val keyFrame = extractor.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC != 0
        info.set(0, size, extractor.sampleTime, if (keyFrame) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0)
        muxer.writeSampleData(if (useVideo) outVideo else outAudio, buffer, info)
        extractor.advance()
      }
      muxer.stop()
    } finally {
      runCatching { muxer.release() }
      video.release()
      audio.release()
    }
  }

  /**
   * Decodes an audio file (AAC or Opus) to PCM and encodes it to MP3 at
   * `kbps`, writing the frames to `out`. `onProgress` gets 0..1.
   */
  fun encodeMp3(input: File, out: OutputStream, kbps: Int, isCancelled: () -> Boolean, onProgress: (Float) -> Unit) {
    val extractor = MediaExtractor().apply { setDataSource(input.absolutePath) }
    val track = selectTrack(extractor, "audio/")
    val format = extractor.getTrackFormat(track)
    val durationUs = if (format.containsKey(MediaFormat.KEY_DURATION)) format.getLong(MediaFormat.KEY_DURATION) else 0L
    val decoder = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!)
    decoder.configure(format, null, null, 0)
    decoder.start()

    var encoder: Mp3Encoder? = null
    var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
    var sampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
    val info = MediaCodec.BufferInfo()
    var inputDone = false
    var outputDone = false
    try {
      while (!outputDone) {
        if (isCancelled()) throw CancellationException()
        if (!inputDone) {
          val index = decoder.dequeueInputBuffer(10_000)
          if (index >= 0) {
            val buffer = decoder.getInputBuffer(index)!!
            val size = extractor.readSampleData(buffer, 0)
            if (size < 0) {
              decoder.queueInputBuffer(index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
              inputDone = true
            } else {
              decoder.queueInputBuffer(index, 0, size, extractor.sampleTime, 0)
              extractor.advance()
            }
          }
        }
        val index = decoder.dequeueOutputBuffer(info, 10_000)
        when {
          index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
            // HE-AAC reports its real (doubled) sample rate only here.
            val output = decoder.outputFormat
            channels = output.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            sampleRate = output.getInteger(MediaFormat.KEY_SAMPLE_RATE)
          }
          index >= 0 -> {
            if (info.size > 0) {
              val pcm = decoder.getOutputBuffer(index)!!
              pcm.position(info.offset)
              pcm.limit(info.offset + info.size)
              val enc = encoder ?: Mp3Encoder(sampleRate, channels, kbps).also { encoder = it }
              enc.encode(pcm.slice().order(ByteOrder.nativeOrder()).asShortBuffer(), out)
              if (durationUs > 0) onProgress((info.presentationTimeUs.toFloat() / durationUs).coerceIn(0f, 1f))
            }
            decoder.releaseOutputBuffer(index, false)
            if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
          }
        }
      }
      (encoder ?: throw IOException("The audio track was empty")).finish(out)
    } finally {
      runCatching { decoder.stop() }
      decoder.release()
      extractor.release()
    }
  }

  private fun selectTrack(extractor: MediaExtractor, mimePrefix: String): Int {
    for (i in 0 until extractor.trackCount) {
      if (extractor.getTrackFormat(i).getString(MediaFormat.KEY_MIME)?.startsWith(mimePrefix) == true) {
        extractor.selectTrack(i)
        return i
      }
    }
    throw IOException("No ${mimePrefix.trimEnd('/')} track in the downloaded file")
  }

  /** LAME (via the jump3r Java port), wired up the way its own encoder class does it. */
  private class Mp3Encoder(sampleRate: Int, private val channels: Int, kbps: Int) {
    private val lame = Lame()
    private val flags: LameGlobalFlags
    private var left = IntArray(FRAME_BLOCK)
    private var right = IntArray(FRAME_BLOCK)
    private var mp3 = ByteArray(mp3BufferSize(FRAME_BLOCK))

    init {
      val gainAnalysis = GainAnalysis()
      val bitStream = BitStream()
      val presets = Presets()
      val quantizePvt = QuantizePVT()
      val quantize = Quantize()
      val vbrTag = VBRTag()
      val version = Version()
      val id3 = ID3Tag()
      val reservoir = Reservoir()
      val takehiro = Takehiro()
      val parse = Parse()
      val mpg = MPGLib()
      val mpgInterface = Interface()
      val common = Common()
      lame.setModules(gainAnalysis, bitStream, presets, quantizePvt, quantize, vbrTag, version, id3, mpg)
      bitStream.setModules(gainAnalysis, mpg, version, vbrTag)
      id3.setModules(bitStream, version)
      presets.setModules(lame)
      quantize.setModules(bitStream, reservoir, quantizePvt, takehiro)
      quantizePvt.setModules(takehiro, reservoir, lame.enc.psy)
      reservoir.setModules(bitStream)
      takehiro.setModules(quantizePvt)
      vbrTag.setModules(lame, bitStream, version)
      GetAudio().setModules(parse, mpg)
      parse.setModules(version, id3, presets)
      mpg.setModules(mpgInterface, common)
      mpgInterface.setModules(vbrTag, common)

      flags = lame.lame_init()
      flags.num_channels = if (channels >= 2) 2 else 1
      flags.in_samplerate = sampleRate
      flags.brate = kbps
      flags.mode = if (channels >= 2) MPEGMode.JOINT_STEREO else MPEGMode.MONO
      flags.quality = 5 // LAME's default speed/quality balance.
      id3.id3tag_init(flags)
      flags.write_id3tag_automatic = false // The app writes its own tag with title, channel and cover.
      flags.findReplayGain = false
      if (lame.lame_init_params(flags) < 0) throw IOException("MP3 encoder setup failed")
    }

    /** Interleaved 16-bit PCM in, MP3 frames out. */
    fun encode(pcm: java.nio.ShortBuffer, out: OutputStream) {
      val frames = pcm.remaining() / maxOf(channels, 1)
      if (frames == 0) return
      if (frames > left.size) {
        left = IntArray(frames)
        right = IntArray(frames)
        mp3 = ByteArray(mp3BufferSize(frames))
      }
      for (i in 0 until frames) {
        val base = i * channels
        // LAME's int input is full-scale 32-bit: 16-bit samples go in the top half.
        left[i] = pcm.get(base).toInt() shl 16
        right[i] = if (channels >= 2) pcm.get(base + 1).toInt() shl 16 else left[i]
      }
      val n = lame.lame_encode_buffer_int(flags, left, right, frames, mp3, 0, mp3.size)
      if (n < 0) throw IOException("MP3 encoding failed ($n)")
      out.write(mp3, 0, n)
    }

    fun finish(out: OutputStream) {
      val n = lame.lame_encode_flush(flags, mp3, 0, mp3.size)
      if (n > 0) out.write(mp3, 0, n)
      lame.lame_close(flags)
    }

    companion object {
      private const val FRAME_BLOCK = 8192

      /** LAME's documented worst case: 1.25 × samples + 7200 bytes. */
      private fun mp3BufferSize(frames: Int) = (1.25 * frames).toInt() + 7200
    }
  }
}
