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

    // Downloads (Downloads.swift): the app passes the streams it found; progress comes as onDownloadUpdate.
    Function("startDownload") { (options: [String: Any]) in
      guard let id = options["id"] as? String, let audio = (options["audioUrl"] as? String).flatMap(URL.init(string:)) else {
        throw DownloadOptionsException()
      }
      let url = { (key: String) in (options[key] as? String).flatMap(URL.init(string:)) }
      let request = Downloads.Request(
        id: id,
        title: options["title"] as? String ?? "Video",
        format: options["format"] as? String ?? "mp4",
        videoUrl: url("videoUrl"),
        audioUrl: audio,
        captionsUrl: url("captionsUrl"),
        durationMs: (options["durationMs"] as? NSNumber)?.intValue,
        artist: options["artist"] as? String,
        artworkUrl: url("artworkUrl"))
      DispatchQueue.main.async { self.downloads.start(request) }
    }

    Function("cancelDownload") { (id: String) in
      DispatchQueue.main.async { self.downloads.cancel(id) }
    }

    Function("getDownloads") {
      DispatchQueue.main.sync { self.downloads.snapshot() }
    }

    Function("clearFinishedDownloads") {
      DispatchQueue.main.async { self.downloads.clearFinished() }
    }
  }

  private lazy var downloads = Downloads { [weak self] update in
    self?.sendEvent("onDownloadUpdate", update.compactMapValues { $0 })
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

final class DownloadOptionsException: Exception, @unchecked Sendable {
  override var reason: String { "A download needs an id and an audio address." }
}
