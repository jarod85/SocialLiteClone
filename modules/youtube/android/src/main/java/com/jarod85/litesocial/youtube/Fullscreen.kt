package com.jarod85.litesocial.youtube

import android.app.Activity
import android.content.Context
import android.content.pm.ActivityInfo
import android.provider.Settings
import android.view.OrientationEventListener
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

/**
 * The watch screen's full screen: the app turns sideways and hides the status
 * and navigation bars (a swipe from the edge shows them for a moment), while
 * the screen itself stays the app's, with its quality and captions buttons.
 * Turning the phone upright again leaves full screen, as YouTube does, when
 * auto-rotate is on.
 */
class Fullscreen(private val onExitRequest: () -> Unit) {
  private var savedOrientation: Int? = null
  private var watcher: OrientationEventListener? = null

  fun set(activity: Activity, enabled: Boolean) {
    val controller = WindowCompat.getInsetsController(activity.window, activity.window.decorView)
    if (enabled) {
      if (savedOrientation == null) savedOrientation = activity.requestedOrientation
      activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
      controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      controller.hide(WindowInsetsCompat.Type.systemBars())
      watch(activity)
    } else {
      watcher?.disable()
      watcher = null
      controller.show(WindowInsetsCompat.Type.systemBars())
      savedOrientation?.let { activity.requestedOrientation = it }
      savedOrientation = null
    }
  }

  /** Asks to leave full screen once the phone, having been sideways, is held upright. */
  private fun watch(context: Context) {
    if (watcher != null) return
    var wasSideways = false
    watcher = object : OrientationEventListener(context) {
      override fun onOrientationChanged(degrees: Int) {
        if (degrees == OrientationEventListener.ORIENTATION_UNKNOWN) return
        if (degrees in 60..120 || degrees in 240..300) {
          wasSideways = true
        } else if (wasSideways && (degrees <= 20 || degrees >= 340) && autoRotate(context)) {
          wasSideways = false
          onExitRequest()
        }
      }
    }.also { if (it.canDetectOrientation()) it.enable() }
  }

  private fun autoRotate(context: Context): Boolean =
    Settings.System.getInt(context.contentResolver, Settings.System.ACCELEROMETER_ROTATION, 0) == 1
}
