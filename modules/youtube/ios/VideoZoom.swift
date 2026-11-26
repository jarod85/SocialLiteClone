import AVFoundation
import UIKit

/**
 Pinch to zoom on the watch screen's video, up to `maxScale`, as on Android (VideoZoom.kt):
 spread two fingers to zoom in where they are, drag with one or two fingers to look around
 while zoomed, pinch back to 1× (or the app's Reset) to see it all.

 Only the video layer (the AVPlayerLayer inside expo-video's player view) is scaled, so the
 player's controls and the app's captions keep their size and place. The player's own pinch
 (fit or fill) is switched off inside the view, since it would take the same two fingers.
 */
final class VideoZoom: NSObject, UIGestureRecognizerDelegate {
  static let maxScale: CGFloat = 5

  private weak var view: UIView?
  private var scale: CGFloat = 1
  private var offset = CGPoint.zero
  private var start = (scale: CGFloat(1), offset: CGPoint.zero, mid: CGPoint.zero)
  private let onChange: (Double) -> Void
  private lazy var pinch = UIPinchGestureRecognizer(target: self, action: #selector(onPinch(_:)))
  private lazy var pan = UIPanGestureRecognizer(target: self, action: #selector(onPan(_:)))

  init(onChange: @escaping (Double) -> Void) {
    self.onChange = onChange
  }

  func attach(to view: UIView) {
    guard self.view !== view else { return }
    self.view?.removeGestureRecognizer(pinch)
    self.view?.removeGestureRecognizer(pan)
    self.view = view
    scale = 1
    offset = .zero
    pinch.delegate = self
    pan.delegate = self
    view.addGestureRecognizer(pinch)
    view.addGestureRecognizer(pan)
    disablePlayerPinch(in: view)
  }

  func reset() {
    scale = 1
    offset = .zero
    apply(animated: true)
    onChange(1)
  }

  // MARK: Gestures

  @objc private func onPinch(_ g: UIPinchGestureRecognizer) {
    guard let view else { return }
    // The fingers' midpoint, from the view's centre (where the layer scales from).
    let mid = CGPoint(x: g.location(in: view).x - view.bounds.midX, y: g.location(in: view).y - view.bounds.midY)
    switch g.state {
    case .began:
      start = (scale, offset, mid)
    case .changed:
      let s = min(Self.maxScale, max(1, start.scale * g.scale))
      // The spot that was under the fingers stays under them.
      offset = CGPoint(
        x: mid.x - s * (start.mid.x - start.offset.x) / start.scale,
        y: mid.y - s * (start.mid.y - start.offset.y) / start.scale)
      scale = s
      apply(animated: false)
      onChange(Double(s))
    case .ended, .cancelled, .failed:
      if scale < 1.05 { reset() }
    default:
      break
    }
  }

  @objc private func onPan(_ g: UIPanGestureRecognizer) {
    guard let view else { return }
    switch g.state {
    case .began:
      start = (scale, offset, .zero)
    case .changed:
      let t = g.translation(in: view)
      offset = CGPoint(x: start.offset.x + t.x, y: start.offset.y + t.y)
      apply(animated: false)
    default:
      break
    }
  }

  func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool {
    if g === pinch, let view { disablePlayerPinch(in: view) }  // The player may have added it since.
    // At 1× a drag belongs to the player (its seek bar); zoomed in, it looks around.
    return g === pan ? scale > 1.01 : true
  }

  func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
    (g === pinch && other === pan) || (g === pan && other === pinch)
  }

  // MARK: Drawing

  /** Scales and moves the video layer, kept covering the view. */
  private func apply(animated: Bool) {
    guard let view else { return }
    let maxX = (scale - 1) * view.bounds.width / 2
    let maxY = (scale - 1) * view.bounds.height / 2
    offset = CGPoint(x: min(maxX, max(-maxX, offset.x)), y: min(maxY, max(-maxY, offset.y)))
    let transform = CGAffineTransform(translationX: offset.x, y: offset.y).scaledBy(x: scale, y: scale)
    CATransaction.begin()
    CATransaction.setDisableActions(!animated)
    if animated { CATransaction.setAnimationDuration(0.25) }
    for layer in Self.playerLayers(in: view.layer) { layer.setAffineTransform(transform) }
    CATransaction.commit()
  }

  private static func playerLayers(in layer: CALayer) -> [AVPlayerLayer] {
    if let player = layer as? AVPlayerLayer { return [player] }
    return (layer.sublayers ?? []).flatMap(playerLayers)
  }

  private func disablePlayerPinch(in view: UIView) {
    view.gestureRecognizers?.forEach { if $0 is UIPinchGestureRecognizer && $0 !== pinch { $0.isEnabled = false } }
    view.subviews.forEach(disablePlayerPinch)
  }
}
