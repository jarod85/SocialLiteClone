import AVFoundation
import ExpoModulesCore

/**
 The iOS side of the YouTube module. Everything YouTube serves comes from the app's own
 TypeScript engine (src/features/youtube/innertube); this only does what needs the device.
 */
public class YouTubeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LiteSocialYouTube")

    // The same events as Android, so the app listens the same way on both.
    Events("onDownloadUpdate", "onFullscreenExitRequest", "onZoomChange", "onSwipeAdjust")

    // A picked quality: AVPlayer chooses from YouTube's HLS manifest by itself, at most this
    // height (the shorter side, so portrait videos are capped alike); nil lets it choose freely.
    AsyncFunction("capVideoHeight") { (player: SharedRef<AVPlayer>, height: Int?) in
      let side = height.map { Double($0) * 16 / 9 } ?? 0
      player.ref.currentItem?.preferredMaximumResolution = CGSize(width: side, height: side)
    }.runOnQueue(.main)

    // Pinch to zoom on a VideoView (its view tag), as on Android. The view may not be
    // registered yet when React hands over its ref: try again for a moment.
    AsyncFunction("attachZoom") { (viewTag: Int, promise: Promise) in
      self.attachZoom(viewTag, tries: 10, promise: promise)
    }.runOnQueue(.main)

    AsyncFunction("resetZoom") {
      self.zoom.reset()
    }.runOnQueue(.main)
  }

  private lazy var zoom = VideoZoom { [weak self] scale in
    self?.sendEvent("onZoomChange", ["scale": scale])
  }

  private func attachZoom(_ viewTag: Int, tries: Int, promise: Promise) {
    if let view = appContext?.findView(withTag: viewTag, ofType: UIView.self) {
      zoom.attach(to: view)
      return promise.resolve(true)
    }
    guard tries > 0 else { return promise.resolve(false) }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { self.attachZoom(viewTag, tries: tries - 1, promise: promise) }
  }
}
