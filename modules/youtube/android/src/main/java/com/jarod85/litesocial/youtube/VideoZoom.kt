package com.jarod85.litesocial.youtube

import android.annotation.SuppressLint
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.SurfaceView
import android.view.TextureView
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import kotlin.math.abs
import kotlin.math.hypot

/**
 * Pinch to zoom on the watch screen's video, up to [MAX_SCALE]. Spread two
 * fingers to zoom in where they are; drag with one or two fingers to look
 * around while zoomed; pinch back to 1× (or the app's Reset) to see it all.
 *
 * It works on the player view expo-video creates (a media3 PlayerView inside
 * the VideoView): only the video's surface is scaled, so the player's
 * controls and captions keep their size and place. That needs the
 * VideoView's texture surface (surfaceType="textureView"); a SurfaceView
 * can't be scaled with the views around it.
 *
 * Touches the zoom doesn't use (a tap to show the controls, the seek bar)
 * reach the player as before.
 */
class VideoZoom(private val onChange: (Float) -> Unit) {
  private var playerView: ViewGroup? = null
  private var surface: View? = null
  private var scale = 1f
  private var tx = 0f
  private var ty = 0f

  /** A pinch or a drag is under way: its touches are the zoom's, not the player's. */
  private var gesture = false
  private var downX = 0f
  private var downY = 0f
  private var lastX = 0f
  private var lastY = 0f
  private var lastPointers = 0

  private val layoutListener = View.OnLayoutChangeListener { _, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom ->
    if (right - left != oldRight - oldLeft || bottom - top != oldBottom - oldTop) {
      // Full screen on or off: the old offsets don't fit the new size.
      reset()
    }
  }

  private val detachListener = object : View.OnAttachStateChangeListener {
    override fun onViewAttachedToWindow(v: View) = Unit
    override fun onViewDetachedFromWindow(v: View) = detach()
  }

  /** Finds the player inside expo-video's VideoView and takes over its zoom. False if it isn't one. */
  @SuppressLint("ClickableViewAccessibility")
  fun attach(videoView: View): Boolean {
    val player = findPlayerView(videoView) ?: return false
    if (player === playerView) return true
    detach()
    val detector = ScaleGestureDetector(player.context, scaleListener).apply { isQuickScaleEnabled = false }
    val slop = ViewConfiguration.get(player.context).scaledTouchSlop
    player.setOnTouchListener { _, event -> onTouch(event, detector, slop) }
    player.addOnLayoutChangeListener(layoutListener)
    player.addOnAttachStateChangeListener(detachListener)
    // The zoomed surface may reach past the video's frame, up to the player's edges (but not beyond).
    player.clipChildren = false
    (player.parent as? ViewGroup)?.clipChildren = true
    playerView = player
    surface = findSurface(player)
    return true
  }

  fun detach() {
    val player = playerView ?: return
    reset()
    player.setOnTouchListener(null)
    player.removeOnLayoutChangeListener(layoutListener)
    player.removeOnAttachStateChangeListener(detachListener)
    playerView = null
    surface = null
  }

  fun reset() {
    gesture = false
    set(1f, 0f, 0f)
  }

  private fun onTouch(event: MotionEvent, detector: ScaleGestureDetector, slop: Int): Boolean {
    if (surface == null) surface = playerView?.let(::findSurface)
    detector.onTouchEvent(event)
    val pointers = event.pointerCount
    // Average of the fingers on the screen, to pan with.
    var x = 0f
    var y = 0f
    for (i in 0 until pointers) {
      if (event.actionMasked == MotionEvent.ACTION_POINTER_UP && i == event.actionIndex) continue
      x += event.getX(i)
      y += event.getY(i)
    }
    val counted = if (event.actionMasked == MotionEvent.ACTION_POINTER_UP) pointers - 1 else pointers
    if (counted > 0) {
      x /= counted
      y /= counted
    }

    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        gesture = false
        downX = x
        downY = y
        lastX = x
        lastY = y
        lastPointers = 1
        return false // The player still sees the touch begin (a tap shows its controls).
      }
      MotionEvent.ACTION_POINTER_DOWN -> {
        gesture = true
        lastX = x
        lastY = y
        lastPointers = counted
        return true
      }
      MotionEvent.ACTION_MOVE -> {
        if (!gesture && scale > 1f && hypot(x - downX, y - downY) > slop) gesture = true
        if (!gesture) return false
        if (counted == lastPointers && !detector.isInProgress) set(scale, tx + x - lastX, ty + y - lastY)
        lastX = x
        lastY = y
        lastPointers = counted
        return true
      }
      MotionEvent.ACTION_POINTER_UP -> {
        lastX = x
        lastY = y
        lastPointers = counted
        return true
      }
      MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
        val consumed = gesture
        gesture = false
        if (scale < 1.05f && scale != 1f) set(1f, 0f, 0f)
        return consumed // After a pinch or drag, lifting the finger isn't a tap.
      }
    }
    return gesture
  }

  private val scaleListener = object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
    private var focusX = 0f
    private var focusY = 0f

    override fun onScaleBegin(detector: ScaleGestureDetector): Boolean {
      gesture = true
      focusX = detector.focusX
      focusY = detector.focusY
      return true
    }

    override fun onScale(detector: ScaleGestureDetector): Boolean {
      val player = playerView ?: return false
      val next = (scale * detector.scaleFactor).coerceIn(1f, MAX_SCALE)
      // Keep the point between the fingers where it is, and follow the fingers as they move.
      val cx = player.width / 2f
      val cy = player.height / 2f
      val ratio = next / scale
      val fx = detector.focusX - cx
      val fy = detector.focusY - cy
      val nx = fx - ratio * (fx - tx) + (detector.focusX - focusX)
      val ny = fy - ratio * (fy - ty) + (detector.focusY - focusY)
      focusX = detector.focusX
      focusY = detector.focusY
      set(next, nx, ny)
      return true
    }
  }

  /** Applies a zoom, keeping the video covering the screen (no empty space opens beside it). */
  private fun set(nextScale: Float, nextTx: Float, nextTy: Float) {
    val player = playerView
    val target = surface
    val frame = target?.parent as? View
    if (player == null || target == null || frame == null) {
      scale = 1f
      tx = 0f
      ty = 0f
      return
    }
    val s = if (nextScale < 1.001f) 1f else nextScale
    // How far the scaled video reaches past the player's edges on each side.
    val maxX = ((frame.width * s - player.width) / 2f).coerceAtLeast(0f)
    val maxY = ((frame.height * s - player.height) / 2f).coerceAtLeast(0f)
    val x = nextTx.coerceIn(-maxX, maxX)
    val y = nextTy.coerceIn(-maxY, maxY)
    val changed = abs(s - scale) > 0.001f
    scale = s
    tx = x
    ty = y
    target.pivotX = target.width / 2f
    target.pivotY = target.height / 2f
    target.scaleX = s
    target.scaleY = s
    target.translationX = x
    target.translationY = y
    if (changed) onChange(s)
  }

  private fun findPlayerView(view: View): ViewGroup? {
    if (view is ViewGroup && view.javaClass.name == PLAYER_VIEW) return view
    if (view is ViewGroup) {
      for (i in 0 until view.childCount) findPlayerView(view.getChildAt(i))?.let { return it }
    }
    return null
  }

  /** The video's surface: the content frame's TextureView (or SurfaceView, which can't zoom well). */
  private fun findSurface(view: View): View? {
    if (view is TextureView || view is SurfaceView) return view
    if (view is ViewGroup) {
      for (i in 0 until view.childCount) findSurface(view.getChildAt(i))?.let { return it }
    }
    return null
  }

  companion object {
    const val MAX_SCALE = 5f
    private const val PLAYER_VIEW = "androidx.media3.ui.PlayerView"
  }
}
