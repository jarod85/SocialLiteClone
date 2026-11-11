package com.jarod85.litesocial.youtube

import android.app.Activity
import android.media.AudioManager
import android.provider.Settings
import android.view.WindowManager
import kotlin.math.roundToInt

/**
 * Full screen's swipes, as in most video players: up and down on the left
 * half of the video sets the brightness, on the right half the media volume.
 * The brightness is this app's window's only, and goes back to the phone's
 * when full screen ends. [VideoZoom] hands over the one-finger up-and-down
 * drags it doesn't use; each change is reported as (kind, level 0–1).
 */
class SwipeAdjust(
  private val activity: () -> Activity?,
  private val onChange: (kind: String, level: Float) -> Unit,
) {
  private var kind = BRIGHTNESS
  private var startLevel = 0f
  private var range = 1f
  private var lastSent = -1

  /** A drag starts at x in a view of this size: its side picks brightness or volume. */
  fun begin(x: Float, width: Int, height: Int) {
    kind = if (x < width / 2f) BRIGHTNESS else VOLUME
    range = height.coerceAtLeast(1).toFloat()
    startLevel = if (kind == BRIGHTNESS) brightness() else volume()
    lastSent = -1
  }

  /** The finger is `up` pixels above where the drag started (negative: below). Its full height is the full range. */
  fun move(up: Float) {
    val level = (startLevel + up / range).coerceIn(0f, 1f)
    val applied = (if (kind == BRIGHTNESS) setBrightness(level) else setVolume(level)) ?: return
    val percent = (applied * 100).roundToInt()
    if (percent != lastSent) {
      lastSent = percent
      onChange(kind, applied)
    }
  }

  /** Gives the window the phone's own brightness again. */
  fun resetBrightness(activity: Activity) {
    val window = activity.window
    if (window.attributes.screenBrightness == WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE) return
    window.attributes = window.attributes.apply { screenBrightness = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE }
  }

  private fun brightness(): Float {
    val activity = activity() ?: return 0.5f
    val own = activity.window.attributes.screenBrightness
    if (own >= 0f) return own
    // shortcut: the phone's 0–255 setting isn't exactly where its brightness slider sits on newer Android; close enough to start a swipe from.
    return Settings.System.getInt(activity.contentResolver, Settings.System.SCREEN_BRIGHTNESS, 128) / 255f
  }

  private fun setBrightness(level: Float): Float? {
    val window = activity()?.window ?: return null
    // 0 turns some screens fully dark.
    window.attributes = window.attributes.apply { screenBrightness = level.coerceAtLeast(MIN_BRIGHTNESS) }
    return level
  }

  private fun audio(): AudioManager? = activity()?.getSystemService(AudioManager::class.java)

  private fun volume(): Float {
    val audio = audio() ?: return 0f
    return audio.getStreamVolume(AudioManager.STREAM_MUSIC).toFloat() / audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)
  }

  /** The volume has steps (often 15): returns the step it landed on, as 0–1. */
  private fun setVolume(level: Float): Float? {
    val audio = audio() ?: return null
    val max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)
    val index = (level * max).roundToInt()
    if (index != audio.getStreamVolume(AudioManager.STREAM_MUSIC)) {
      // No system volume panel (flags 0): the video shows the level. Some phones refuse changes (Do Not Disturb, fixed volume).
      runCatching { audio.setStreamVolume(AudioManager.STREAM_MUSIC, index, 0) }
    }
    return audio.getStreamVolume(AudioManager.STREAM_MUSIC).toFloat() / max
  }

  companion object {
    const val BRIGHTNESS = "brightness"
    const val VOLUME = "volume"
    private const val MIN_BRIGHTNESS = 0.01f
  }
}
