# iPhone support: design

Date: 2026-11-26. Branch: `ios-support`.

## Intent

Lite Social runs only on Android today. The owner wants the same app on their iPhone: both the filtered
Instagram browser and the YouTube client. The code must stay robust and easy to maintain, because more sites
(TikTok first) may be added later. Android must keep working exactly as it does now.

## Goals

1. The app builds, installs and runs on a real iPhone (iOS 17+), built locally with Xcode.
2. Instagram on iPhone: every filter and injected feature that works on Android (blocking, Following feed, stories
   tray, full-screen reels, pinch to zoom, daily limit, leak reports, remote rules).
3. YouTube on iPhone: subscriptions feed, search, channels, playback with background and lock-screen controls,
   history, playlists, quality, captions, full screen, pinch to zoom, embedded-player fallback, downloads.
4. Instagram notifications on iPhone, within what iOS allows.
5. Instagram calls on iPhone, if WebKit and Instagram allow it (see Risks).
6. A structure where each feature has one TypeScript interface and per-OS implementations behind it, so adding a
   web platform (TikTok) is a config file plus rules, and screens never branch on the OS themselves.

## Non-goals

- App Store or TestFlight distribution. It is a personal build installed from the Mac.
- In-app updates on iPhone. The APK updater stays Android-only; the iPhone gets new versions from Xcode.
- "Open with Lite Social" for YouTube links on iPhone. iOS only lets the owner of youtube.com claim its links, and
  a share extension is a separate project.
- MP3 files on iPhone. iOS has no MP3 encoder; audio downloads are M4A (AAC), which every iPhone player reads.
- Musicolet folders on iPhone. Downloads go to the app's folder in the Files app.
- Brightness and volume swipes in YouTube full screen on iPhone (Android-only in this release).
- Moving Android off NewPipe Extractor. Android keeps its Kotlin module unchanged.

## Anti-goals (a failure even if it works)

- Any Android regression, in behaviour or in the Android build.
- `Platform.OS` checks spread through screens and components.
- Instagram cookies leaving the phone, or being sent to any host other than `www.instagram.com`.
- A third-party YouTube library that needs patched shims to run on Hermes.

## Constraints

- Expo SDK 57, React Native 0.86, Hermes. Read the v57 docs before any Expo API (AGENTS.md).
- Continuous Native Generation: `ios/` is generated. Native config goes in `app.json` and config plugins only.
- New Expo packages are added with `npx expo install`. Prefer Expo modules over third-party libraries.
- Local Expo modules in `modules/` gain an `ios/` folder (Swift, podspec) next to the Kotlin one.
- Free Apple ID signing: an install opens for 7 days, then needs a reinstall from the Mac. (A paid Apple Developer
  account lifts this to a year; the owner can switch later without code changes.)
- `npm run check` (typecheck, lint, Jest) passes before anything is called done.

## Approaches considered (YouTube engine on iPhone)

| | Approach | Trade-off |
|---|---|---|
| A | Swift port of the Kotlin module on third-party Swift YouTube libraries | Two engines in two languages; Swift package dependencies fit badly in Expo's CocoaPods build. Dropped. |
| **B** | **Lite Social's own YouTube engine in TypeScript** over YouTube's InnerTube API | **Picked by the owner.** About 600 lines we own and test against saved responses. Same features as Android except MP3/Musicolet. When YouTube changes, the fix is in our code. |
| C | YouTube's embedded player plus RSS feeds | Smallest, but ads, no background play, no downloads, no own controls. Dropped. |

B follows what NewPipe Extractor itself does today (the pinned commit): player data from the **visionOS** InnerTube
client (`youtubei.googleapis.com/youtubei/v1/player`, client name `VISIONOS`, id 101), plus a WEB-client request for
metadata (`microformat`). Using the same client means Android and iPhone face the same YouTube behaviour. The
client constants live in one file so they can be bumped when NewPipe bumps theirs.

## Design

### 1. Structure: one interface per feature, one implementation per OS

The codebase already does this for the native modules: each feature has a typed TypeScript interface and a
`supported`/`available` flag (`youtubeAvailable`, `updatesSupported`, `getStatus().supported`), and screens hide
what isn't supported. iPhone support keeps that pattern and extends it:

- **YouTube:** `src/features/youtube/native.ts` keeps its `YouTubeNativeModule` interface (renamed in docs only as
  "the YouTube backend"). On Android it returns the Kotlin module, as now. On iOS it returns an object built from
  the TypeScript engine (data) plus the iOS Swift module (downloads). This file is the only place that picks by OS.
- **Capabilities, not OS checks:** the backend also exports what it can do, e.g.
  `youtubeFeatures = { audioFormat: 'mp3' | 'm4a', musicFolder: boolean, swipeAdjust: boolean, nativeZoom: boolean }`.
  Screens read these flags instead of `Platform.OS`. The existing `Platform.OS` checks in `src/webview/` stay where
  they are (they're inside the browser layer, not screens).
- **Web platforms (Instagram, later TikTok):** `PlatformConfig` stays the single description of a site. The fields
  documented as "Android only" (`tabletUserAgentPaths`, `phoneLayoutPaths`) become cross-OS: the user-agent layer
  (`webview/userAgent.ts`) gets a per-OS "big screen" agent (Android: Chrome without `Mobile`; iOS: desktop Safari,
  which is what Safari on an iPad sends). A TikTok config uses the same fields on both OSes.

### 2. App config and build

- `app.json`:
  - `ios.infoPlist`: `UIFileSharingEnabled` and `LSSupportsOpeningDocumentsInPlace` (downloads show in Files);
    background modes for audio (already added by the `expo-video` plugin) and background fetch/processing (from
    the background-task plugin); the BGTask identifier list.
  - Landscape allowed on iOS for YouTube full screen, while every screen still starts portrait (orientation locked
    and unlocked in code with `expo-screen-orientation`). Builder confirms the v57 way to do this.
  - `ios.deploymentTarget` via `expo-build-properties` if a dependency needs more than the SDK default.
- New Expo packages (via `npx expo install`): `expo-screen-orientation`, `expo-notifications`,
  `expo-background-task`. No other new dependencies.
- `modules/youtube` and `modules/instagram-alerts` get `ios/` (Swift module + podspec) and list `"ios"` in
  `expo-module.config.json`. `modules/app-updater` stays Android-only.
- The two plugins in `plugins/` are Android-only; they must be no-ops for iOS (builder verifies).
- `README.md`: an "Install on your iPhone" section (Xcode, Apple ID signing, trusting the developer on the phone,
  the 7-day limit), and iOS notes in "Known limitations". `docs/TESTING_CHECKLIST.md`: iPhone steps.

### 3. YouTube engine (TypeScript, used on iOS)

Location: `src/features/youtube/engine/`. Pure functions over `fetch`, no React, no native code, fully Jest-tested
with fixtures (saved real responses, trimmed) in `tests/fixtures/youtube/`.

| Backend call | Engine source |
|---|---|
| `search`, `more` | InnerTube `search` (WEB client); continuation token for `more`. Shorts are dropped, like Android. |
| `channel` | `navigation/resolve_url` for handles and URLs, then `browse` on the channel's Videos tab. |
| `feed` | RSS of the channel's videos-only uploads playlist (`feeds/videos.xml?playlist_id=UULF…`): no Shorts, exact dates. Per-channel failures go in `failed`, like Android. |
| `video` | visionOS `player` (streams, captions, details) plus WEB metadata (date, description links), like NewPipe. |
| `parseVideoId` | Pure TypeScript (reuse `links.ts` if it already parses ids). |

Output shapes are the existing `src/features/youtube/types.ts` types, so screens, stores and history don't change.
Errors are thrown with readable messages (`errorText` keeps working), including a recognisable bot-check error so
the watch screen's existing "Play in YouTube's player" fallback triggers.

Client constants (names, versions, user agents, API hosts) live in one `clients.ts`, commented with where they come
from, so a YouTube change means one file to update.

### 4. YouTube playback on iOS

- **Sources:** iOS plays HLS natively (AVPlayer), not DASH. `sources` = YouTube's HLS manifest first (adaptive up
  to 1080p, live streams included), then the best progressive (video+audio) stream. The player's existing
  fall-back-to-next-source logic covers failures.
- **Quality:** Auto is the HLS manifest. Picking a resolution uses expo-video's video-track selection on iOS if v57
  supports it; otherwise each quality is a variant URL from the manifest. Builder checks the v57 docs and picks;
  if neither works, iOS shows Auto only (the capability flag hides the picker).
- **Captions:** the HLS stream has no captions, so on iOS the watch screen draws captions itself: the engine fetches
  the chosen track as WebVTT, a small parser turns it into cues, and an overlay shows the cue for the player's
  current time. Same picker, same remembered language as Android.
- **Full screen:** `expo-screen-orientation` locks landscape and the status bar hides; exiting locks portrait again.
  Same `enterFullscreen`/`exitFullscreen` API in `fullscreen.ts`.
- **Pinch to zoom:** on iOS the video view sits in a wrapper that a two-finger gesture scales and pans (React
  Native's own gesture responder and transforms, clamped 1–5×, drag to look around), feeding the same `useZoom`
  store so the "2.0× · Reset" chip works unchanged. Android keeps its native zoom.
- **Background play and lock screen:** expo-video's own `staysActiveInBackground` and now-playing support, already
  set in `player.ts`.

### 5. YouTube downloads on iOS

- Swift, in `modules/youtube/ios/`, implementing the same `startDownload`/`cancelDownload`/`getDownloads`/
  `clearFinishedDownloads` calls and `onDownloadUpdate` events as Android.
- **MP4:** best H.264 video stream up to the chosen height plus AAC audio, both from the visionOS response
  (direct URLs), fetched in ranged chunks like `RangeDownload.kt` (YouTube throttles unranged requests). Joined
  with AVFoundation (composition + passthrough export) into one `.mp4`. Chosen captions are saved next to it as
  `.srt` (a muxed subtitle track is optional; builder may skip it).
- **Audio:** the AAC stream saved as `.m4a` with title, artist and cover art metadata.
- Saved under the app's Documents folder (`Downloads/`), which the Files app shows as "On My iPhone → Lite Social".
- Downloads run while the app is open and for the short time iOS allows after leaving it; an interrupted download
  shows "failed" with a reason and can be started again. (iOS has no equivalent of Android's foreground service.)
- The download sheet shows M4A instead of MP3 and no folder picker on iOS, via `youtubeFeatures`.

### 6. Instagram on iOS

- **Browser:** the WebView setup already has iOS props (pull to refresh, back swipe, content-process restarts).
  Builder verifies on the phone: user agent (Safari-style), login (including Facebook), keyboard, and every injected
  feature, and fixes what WebKit does differently (pinch to zoom must stop WebKit's own page zoom gestures, e.g.
  `gesturestart`).
- **Calls:** DM and call pages load with the desktop Safari agent on iOS (the generalised "big screen" agent). The
  call window is a sized `window.open` popup; react-native-webview on iOS has no real popup support, so the
  existing patch (`patches/react-native-webview+13.16.1.patch`) gains an iOS part: create the popup's `WKWebView`
  from the configuration WebKit passes (that keeps `window.opener` working), show it full screen, close it on
  `window.close()` or a close button. Camera and microphone use the existing Info.plist texts.
- **Notifications:**
  - The checking logic (inbox query, fallbacks, unread count, activity, what's new since last check, message
    summaries) is ported from the Kotlin `InstagramChecker`/`DirectInbox`/`InstagramApi` to TypeScript in
    `src/features/instagramAlerts/checker/`, tested with fixtures from the Kotlin tests.
  - It runs from `expo-background-task` (iOS decides when; usually not more than every 15 minutes, sometimes hours,
    and never after the user force-quits the app) and from "Check now".
  - Notifications are local ones from `expo-notifications`, grouped per conversation, tapping opens the same
    `litesocial://` link the Android notifications open.
  - Cookies: WKWebView's cookies aren't visible to `fetch`. The iOS `instagram-alerts` Swift module reads the
    `www.instagram.com` cookies from the WebView's cookie store and makes the requests itself (or hands the
    cookie header to the TypeScript code for one request); refreshed cookies are written back. Cookies only ever
    go to `www.instagram.com`.
  - `instagramAlerts.ts` keeps its interface; `getStatus()` reports iOS truthfully (`unrestricted` doesn't apply;
    the interval options read "at most every 15 min, iOS decides"). Android-only rows (battery) are hidden by flags.

### 7. Updates

Unchanged: `updatesSupported` is false on iOS, so the banner and Settings section stay hidden.

## Order of work

Each step ends with the app working on the iPhone and Android untouched.

1. Build and run on the iPhone: config, plugins checked, Instagram browser verified and WebKit fixes.
2. YouTube engine and playback (feed, search, channel, watch, quality, captions, full screen, zoom).
3. YouTube downloads (Swift).
4. Instagram notifications.
5. Instagram calls (the riskiest; may end as "not possible" with the reason documented).
6. README, testing checklist, `npm run check`, Android build compiles.

## Risks

- **YouTube changes or blocks the visionOS client.** Same risk as Android today. Mitigation: constants in one file,
  embedded-player fallback, readable errors.
- **iOS background checks are rare.** iOS decides; the Settings text says so plainly.
- **Calls may not work in WKWebView** (Instagram may refuse WebKit, or the popup may need more than the patch).
  Then calls stay Android-only and the README says why.
- **WebKit differences** in injected scripts (touch, pinch, video autoplay rules) are found only on the device.

## Left to the builder

File names inside the new folders; how the quality picker works on iOS (per v57 docs); whether captions are also
muxed into the MP4; exact Settings wording; exact iOS deployment target; which side (Swift or TypeScript) makes the
Instagram requests on iOS, keeping the cookie rule.
