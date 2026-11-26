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
  }
}
