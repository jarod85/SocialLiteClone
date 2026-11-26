import AVFoundation
import UIKit

/**
 YouTube downloads on iOS. The app finds the streams (its TypeScript engine) and passes their
 addresses here; this downloads them and saves the result in the app's Documents/Downloads
 folder, which the Files app shows as On My iPhone › Lite Social › Downloads.

 - Video: the H.264 video stream and the AAC audio stream, joined into one .mp4 (no re-encoding),
   with the chosen captions saved next to it as an .srt of the same name.
 - Audio (the app's "mp3" choice): the AAC stream as an .m4a with title, artist and cover art.
   iOS has no MP3 encoder.

 Streams are fetched in 10 MB ranges, as on Android (RangeDownload.kt): YouTube slows down
 unranged requests. iOS gives an app only a short time after it leaves the screen, so a
 download that is cut off is shown as failed ("Interrupted") the next time the app runs.
 */
final class Downloads {
  struct Entry: Codable {
    var id: String
    var title: String
    var format: String
    var state: String
    var progress: Double
    var savedTo: String?
    var fileUri: String?
    var error: String?

    var finished: Bool { ["done", "failed", "cancelled"].contains(state) }

    var dictionary: [String: Any?] {
      ["id": id, "title": title, "format": format, "state": state, "progress": progress, "savedTo": savedTo, "fileUri": fileUri, "error": error]
    }
  }

  struct Request {
    let id: String
    let title: String
    let format: String
    let videoUrl: URL?
    let audioUrl: URL
    let captionsUrl: URL?
    /** YouTube's length of the streams. AVFoundation reads YouTube's stream files as twice as long
     (it adds their fragments to a duration that already counts them), so exports are cut to this. */
    let durationMs: Int?
    let artist: String?
    let artworkUrl: URL?

    var length: CMTime? { durationMs.map { CMTime(value: CMTimeValue($0), timescale: 1000) } }
  }

  private static let storeKey = "litesocial.downloads"
  private static let chunk: Int64 = 10 * 1024 * 1024
  static let savedTo = "Files › On My iPhone › Lite Social › Downloads"

  private var entries: [String: Entry] = [:]
  private var order: [String] = []
  private var tasks: [String: Task<Void, Never>] = [:]
  private var backgroundTasks: [String: UIBackgroundTaskIdentifier] = [:]
  /** Downloads stopped because iOS's time after leaving the app ran out. */
  private var outOfTime: Set<String> = []
  private var lastSent: [String: (state: String, at: Date)] = [:]
  private let onUpdate: ([String: Any?]) -> Void

  init(onUpdate: @escaping ([String: Any?]) -> Void) {
    self.onUpdate = onUpdate
    if let data = UserDefaults.standard.data(forKey: Self.storeKey),
      let saved = try? JSONDecoder().decode([Entry].self, from: data)
    {
      for var entry in saved {
        // Still running when the app last stopped: iOS ended it.
        if !entry.finished {
          entry.state = "failed"
          entry.error = "Interrupted. Start it again."
        }
        entries[entry.id] = entry
        order.append(entry.id)
      }
      persist()
    }
  }

  // MARK: The module's calls (main queue)

  func snapshot() -> [[String: Any?]] {
    order.compactMap { entries[$0]?.dictionary }
  }

  func clearFinished() {
    order = order.filter { !(entries[$0]?.finished ?? true) }
    entries = entries.filter { order.contains($0.key) }
    persist()
  }

  func cancel(_ id: String) {
    tasks[id]?.cancel()
  }

  func start(_ request: Request) {
    publish(Entry(id: request.id, title: request.title, format: request.format, state: "downloading", progress: 0))
    // Out of time after leaving the app: stop the download (shown as interrupted) rather than
    // have iOS end the whole app.
    backgroundTasks[request.id] = UIApplication.shared.beginBackgroundTask(withName: "Lite Social download") { [weak self] in
      self?.outOfTime.insert(request.id)
      self?.tasks[request.id]?.cancel()
      self?.endBackgroundTask(request.id)
    }
    tasks[request.id] = Task { [weak self] in
      await self?.run(request)
      await MainActor.run {
        self?.tasks[request.id] = nil
        self?.outOfTime.remove(request.id)
        self?.endBackgroundTask(request.id)
      }
    }
  }

  private func endBackgroundTask(_ id: String) {
    guard let task = backgroundTasks.removeValue(forKey: id) else { return }
    UIApplication.shared.endBackgroundTask(task)
  }

  // MARK: Work

  private func run(_ r: Request) async {
    let work = FileManager.default.temporaryDirectory.appendingPathComponent("download-\(r.id)", isDirectory: true)
    do {
      try FileManager.default.createDirectory(at: work, withIntermediateDirectories: true)
      defer { try? FileManager.default.removeItem(at: work) }
      let audio = work.appendingPathComponent("audio.m4a")
      let saved: URL
      if let videoUrl = r.videoUrl {
        let video = work.appendingPathComponent("video.mp4")
        try await fetch(videoUrl, to: video, progress: { self.progress(r, 0.85 * $0) })
        try await fetch(r.audioUrl, to: audio, progress: { self.progress(r, 0.85 + 0.05 * $0) })
        await update(r) { $0.state = "converting"; $0.progress = 0.9 }
        saved = try Self.destination(for: r.title, ext: "mp4")
        try await Self.join(video: video, audio: audio, to: saved, length: r.length, title: r.title, artist: r.artist)
        // Captions are a bonus: the video is saved even if they can't be fetched.
        if let captionsUrl = r.captionsUrl, let data = try? await URLSession.shared.data(from: captionsUrl).0,
          let vtt = String(data: data, encoding: .utf8)
        {
          try? Self.srt(fromVtt: vtt).write(to: saved.deletingPathExtension().appendingPathExtension("srt"), atomically: true, encoding: .utf8)
        }
      } else {
        try await fetch(r.audioUrl, to: audio, progress: { self.progress(r, 0.9 * $0) })
        await update(r) { $0.state = "saving"; $0.progress = 0.9 }
        saved = try Self.destination(for: r.title, ext: "m4a")
        var artwork: Data?
        if let artworkUrl = r.artworkUrl { artwork = try? await URLSession.shared.data(from: artworkUrl).0 }
        let asset = AVURLAsset(url: audio)
        let length = try await Self.trimmed(asset.load(.duration), to: r.length)
        try await Self.export(asset, preset: AVAssetExportPresetAppleM4A, type: .m4a, to: saved, range: CMTimeRange(start: .zero, duration: length), metadata: Self.tags(title: r.title, artist: r.artist, artwork: artwork))
      }
      await update(r) {
        $0.state = "done"
        $0.progress = 1
        $0.savedTo = Self.savedTo
        $0.fileUri = saved.absoluteString
      }
    } catch where Task.isCancelled {
      // Cancelled requests and exports end with their own errors, not CancellationError.
      let interrupted = await MainActor.run { self.outOfTime.contains(r.id) }
      await update(r) {
        $0.state = interrupted ? "failed" : "cancelled"
        $0.error = interrupted ? "Interrupted. Start it again." : nil
      }
    } catch {
      await update(r) {
        $0.state = "failed"
        $0.error = Self.describe(error)
      }
    }
  }

  /** Downloads `url` to `file` in ranges, reporting 0–1. */
  private func fetch(_ url: URL, to file: URL, progress: @escaping (Double) -> Void) async throws {
    FileManager.default.createFile(atPath: file.path, contents: nil)
    let handle = try FileHandle(forWritingTo: file)
    defer { try? handle.close() }
    var offset: Int64 = 0
    var total: Int64 = -1
    while total < 0 || offset < total {
      try Task.checkCancellation()
      var request = URLRequest(url: url)
      request.setValue("bytes=\(offset)-\(offset + Self.chunk - 1)", forHTTPHeaderField: "Range")
      let (data, response) = try await URLSession.shared.data(for: request)
      guard let http = response as? HTTPURLResponse, http.statusCode == 206 || http.statusCode == 200 else {
        throw DownloadError.http((response as? HTTPURLResponse)?.statusCode ?? 0)
      }
      if data.isEmpty { break }
      try handle.write(contentsOf: data)
      offset += Int64(data.count)
      if total < 0 {
        // "bytes 0-10485759/12345678"; a plain 200 is the whole file.
        let range = http.value(forHTTPHeaderField: "Content-Range") ?? ""
        total = http.statusCode == 200 ? offset : Int64(range.split(separator: "/").last ?? "") ?? offset
      }
      progress(total > 0 ? Double(offset) / Double(total) : 0)
    }
  }

  /** Puts the video and the audio in one MP4, as they are (no re-encoding). */
  /** The shorter of what AVFoundation says and what YouTube says. */
  private static func trimmed(_ duration: CMTime, to length: CMTime?) -> CMTime {
    guard let length, length.seconds > 0 else { return duration }
    return CMTimeMinimum(duration, length)
  }

  private static func join(video: URL, audio: URL, to output: URL, length: CMTime?, title: String, artist: String?) async throws {
    let composition = AVMutableComposition()
    let videoAsset = AVURLAsset(url: video)
    let audioAsset = AVURLAsset(url: audio)
    guard let videoTrack = try await videoAsset.loadTracks(withMediaType: .video).first,
      let audioTrack = try await audioAsset.loadTracks(withMediaType: .audio).first
    else { throw DownloadError.unreadable }
    let duration = try await trimmed(videoAsset.load(.duration), to: length)
    let range = CMTimeRange(start: .zero, duration: duration)
    try composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)?
      .insertTimeRange(range, of: videoTrack, at: .zero)
    let audioDuration = try await trimmed(audioAsset.load(.duration), to: length)
    try composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)?
      .insertTimeRange(CMTimeRange(start: .zero, duration: min(duration, audioDuration)), of: audioTrack, at: .zero)
    try await export(composition, preset: AVAssetExportPresetPassthrough, type: .mp4, to: output, range: range, metadata: tags(title: title, artist: artist, artwork: nil))
  }

  private static func export(_ asset: AVAsset, preset: String, type: AVFileType, to output: URL, range: CMTimeRange, metadata: [AVMetadataItem]) async throws {
    guard let session = AVAssetExportSession(asset: asset, presetName: preset) else { throw DownloadError.unreadable }
    session.timeRange = range
    session.outputURL = output
    session.outputFileType = type
    session.metadata = metadata
    await withTaskCancellationHandler {
      await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
        session.exportAsynchronously { done.resume() }
      }
    } onCancel: {
      session.cancelExport()
    }
    if session.status != .completed {
      try? FileManager.default.removeItem(at: output)  // Not a cut-off file in the Files app.
      throw session.error ?? DownloadError.unreadable
    }
  }

  private static func tags(title: String, artist: String?, artwork: Data?) -> [AVMetadataItem] {
    func item(_ id: AVMetadataIdentifier, _ value: NSCopying & NSObjectProtocol) -> AVMetadataItem {
      let item = AVMutableMetadataItem()
      item.identifier = id
      item.value = value
      return item
    }
    var items = [item(.commonIdentifierTitle, title as NSString)]
    if let artist { items.append(item(.commonIdentifierArtist, artist as NSString)) }
    if let artwork { items.append(item(.commonIdentifierArtwork, artwork as NSData)) }
    return items
  }

  /** A new file in Documents/Downloads named after the title, never overwriting one. */
  private static func destination(for title: String, ext: String) throws -> URL {
    let folder = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
      .appendingPathComponent("Downloads", isDirectory: true)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let name = fileName(title)
    var url = folder.appendingPathComponent("\(name).\(ext)")
    var n = 2
    while FileManager.default.fileExists(atPath: url.path) {
      url = folder.appendingPathComponent("\(name) (\(n)).\(ext)")
      n += 1
    }
    return url
  }

  /** The title as a file name: characters Files can't take become "_". */
  static func fileName(_ title: String) -> String {
    let cleaned = title.map { "/:\\?%*|\"<>".contains($0) ? "_" : $0 }
    let name = String(cleaned).trimmingCharacters(in: .whitespacesAndNewlines)
    return name.isEmpty ? "Video" : String(name.prefix(120))
  }

  /** WebVTT (YouTube's captions) as SubRip, which video players next to the file pick up. */
  static func srt(fromVtt vtt: String) -> String {
    var cues: [String] = []
    for block in vtt.replacingOccurrences(of: "\r", with: "").components(separatedBy: "\n\n") {
      let lines = block.components(separatedBy: "\n")
      guard let at = lines.firstIndex(where: { $0.contains("-->") }) else { continue }
      let times = lines[at].components(separatedBy: "-->").map { part -> String in
        let time = part.trimmingCharacters(in: .whitespaces).components(separatedBy: " ")[0]
        let full = time.filter { $0 == ":" }.count == 1 ? "00:\(time)" : time
        return full.replacingOccurrences(of: ".", with: ",")
      }
      let text = lines[(at + 1)...].joined(separator: "\n")
        .replacingOccurrences(of: "<[^>]*>", with: "", options: .regularExpression)
        .trimmingCharacters(in: .whitespacesAndNewlines)
      guard times.count == 2, !text.isEmpty else { continue }
      cues.append("\(cues.count + 1)\n\(times[0]) --> \(times[1])\n\(text)")
    }
    return cues.joined(separator: "\n\n") + "\n"
  }

  private static func describe(_ error: Error) -> String {
    if let e = error as? DownloadError { return e.message }
    if (error as? URLError)?.code == .notConnectedToInternet { return "No connection." }
    return error.localizedDescription
  }

  // MARK: State

  private func progress(_ r: Request, _ value: Double) {
    Task { @MainActor in self.update(r) { $0.progress = value } }
  }

  @MainActor private func update(_ r: Request, _ change: (inout Entry) -> Void) {
    guard var entry = entries[r.id] else { return }
    change(&entry)
    publish(entry)
  }

  /** Stores the update and tells the app: state changes always, progress at most 4 times a second. */
  private func publish(_ entry: Entry) {
    if entries[entry.id] == nil { order.append(entry.id) }  // Oldest first, as on Android; the screen shows newest first.
    entries[entry.id] = entry
    let now = Date()
    if let last = lastSent[entry.id], last.state == entry.state, now.timeIntervalSince(last.at) < 0.25 { return }
    lastSent[entry.id] = (entry.state, now)
    if entry.state != "downloading" || entry.progress == 0 { persist() }
    onUpdate(entry.dictionary)
  }

  private func persist() {
    let list = order.compactMap { entries[$0] }
    if let data = try? JSONEncoder().encode(list) { UserDefaults.standard.set(data, forKey: Self.storeKey) }
  }
}

enum DownloadError: Error {
  case http(Int)
  case unreadable

  var message: String {
    switch self {
    case .http(403): return "YouTube refused the download (HTTP 403). Try again."
    case .http(let code): return "YouTube answered HTTP \(code)."
    case .unreadable: return "The downloaded streams couldn't be joined."
    }
  }
}
