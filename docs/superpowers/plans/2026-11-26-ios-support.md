# iPhone Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lite Social builds and runs on an iPhone with the Instagram browser, a TypeScript YouTube engine, YouTube downloads, Instagram notifications and (if WebKit allows) calls, with Android unchanged.

**Architecture:** Each feature keeps one TypeScript interface (`YouTubeNativeModule`, `InstagramAlertsModule`). On Android it is the existing Kotlin module; on iOS it is composed from TypeScript (logic, tested in Jest) plus a thin Swift module (only what needs the device: downloads, the video player's height cap, Instagram cookies). The one file per feature that picks by OS is the feature's `native.ts`/`instagramAlerts.ts`. Screens read capability flags, never `Platform.OS`.

**Tech Stack:** Expo SDK 57, React Native 0.86, expo-video (AVPlayer on iOS), Expo Modules API (Swift), zustand + AsyncStorage, Jest (jest-expo).

**Spec:** `docs/superpowers/specs/2026-11-26-ios-support-design.md`

## Global Constraints

- Read the v57 docs (`https://docs.expo.dev/versions/v57.0.0/`) before using any Expo API. Never from memory.
- Add packages only with `npx expo install <pkg>`. Allowed new packages: `expo-screen-orientation`, `expo-notifications`, `expo-background-task`, and whatever those require (`expo-task-manager`). Nothing else.
- Never edit `ios/` or `android/` by hand; config goes in `app.json` or `plugins/`.
- Android behaviour and the Kotlin modules stay unchanged. Android output types stay valid (new type fields are optional).
- Cookies for Instagram go only to `https://www.instagram.com`, enforced in Swift.
- YouTube client constants (from NewPipe Extractor commit `65cabc2b`): visionOS `clientName: 'VISIONOS'`, `clientVersion: '1.04'`, client id `101`, `clientScreen: 'WATCH'`, `platform: 'MOBILE'`, `deviceMake: 'Apple'`, `deviceModel: 'RealityDevice17,1'`, `osName: 'visionOS'`, `osVersion: '26.6.0.23O770'`, user agent `com.google.visionos.youtube/1.04 (RealityDevice17,1; U; CPU visionOS 26_6_0 like Mac OS X; <GL>)`; WEB `clientName: 'WEB'`, `clientVersion: '2.20260805.01.00'`, client id `1`.
- Error codes and messages match `modules/youtube/android/.../Errors.kt` exactly (`ERR_YOUTUBE_BLOCKED`, `ERR_YOUTUBE_OFFLINE`, `ERR_YOUTUBE_RESTRICTED`, `ERR_YOUTUBE`, same English texts).
- Every task ends with `npm run check` passing (typecheck, lint, Jest).
- Comments explain why, one line, in the codebase's existing plain-English style.

## Review Focus

1. **YouTube answers with a bot check** (`playabilityStatus.status = 'LOGIN_REQUIRED'`, reason contains "not a bot"): the error must carry `code: 'ERR_YOUTUBE_BLOCKED'` so the watch screen opens YouTube's embedded player. Test in Task 5.
2. **A video with no H.264 variants or no captions** (live stream, VP9-only, old upload): `qualities` is empty or partial, `captions` is `[]`, playback still starts on the HLS master. Test in Task 5.
3. **Offline / airplane mode** while opening the feed or a video: `ERR_YOUTUBE_OFFLINE` with "No connection.", and the feed lists every channel under `failed` instead of throwing. Tests in Tasks 3 and 4.
4. **Instagram session expired** during a background check: the result says "Not logged in. Open Instagram in Lite Social and log in." and no notification is posted. Test in Task 9.
5. **App killed mid-download**: on next launch `getDownloads()` reports the download as `failed` ("Interrupted. Start it again."), never stuck at `downloading`. Test in Task 8 (Swift unit or manual step).

---

### Task 1: iOS app shell builds and runs Instagram

**Files:**
- Modify: `app.json`
- Modify (if needed): `plugins/withCMakeObjectPathMax.js`, `plugins/withReleaseSigning.js` (must not touch iOS)
- Modify: `.gitignore` (nothing expected; `/ios` is already ignored)

**Interfaces:**
- Produces: a working `npx expo run:ios` (simulator) build that later tasks extend.

- [ ] **Step 1:** In `app.json` → `expo.ios`, add `"infoPlist"` keys `UIFileSharingEnabled: true`, `LSSupportsOpeningDocumentsInPlace: true`, and `UISupportedInterfaceOrientations: ["UIInterfaceOrientationPortrait", "UIInterfaceOrientationLandscapeLeft", "UIInterfaceOrientationLandscapeRight"]`. Keep top-level `"orientation": "portrait"` (Android).
- [ ] **Step 2:** `npx expo install expo-screen-orientation` and add its plugin with `{ "initialOrientation": "PORTRAIT_UP" }` (confirm option name in v57 docs).
- [ ] **Step 3:** Confirm Android is unchanged: copy `android/app/src/main/AndroidManifest.xml` to the scratchpad, run `npx expo prebuild --platform android --no-install`, diff the two. Expected: identical.
- [ ] **Step 4:** `npx expo run:ios` (simulator). Expected: app launches, Home shows Instagram and YouTube, Instagram's login page loads in the browser, YouTube screen shows the "not available" message (until Task 6).
- [ ] **Step 5:** `npm run check`. Expected: PASS.
- [ ] **Step 6: Commit** `git add app.json package.json package-lock.json plugins && git commit -m "iOS: app config and simulator build"`

### Task 2: Instagram browser on WebKit

**Files:**
- Modify as findings require: `src/injected/pinchZoom.ts`, `src/injected/reelViewer.ts`, `src/injected/storiesTray.ts`, `src/webview/PlatformWebView.tsx`
- Test: `tests/pinchZoom.test.ts` (extend)
- Regenerate: `src/injected/generated/engineSource.ts` via `npm run build:engine`

**Interfaces:**
- Consumes: Task 1 build.

- [ ] **Step 1:** Log in on the simulator and run `docs/TESTING_CHECKLIST.md` steps 1–10 and the reels/stories/pinch steps. Note each failure.
- [ ] **Step 2: Write the failing test** for the known WebKit gap: in `tests/pinchZoom.test.ts`, `test('cancels WebKit page-zoom gesture while pinching an image')` dispatches a `gesturestart` event on a zoomable image after two touches and asserts `event.defaultPrevented === true`.
- [ ] **Step 3:** Run `npx jest tests/pinchZoom.test.ts`. Expected: FAIL.
- [ ] **Step 4:** In `installPinchZoom`, add a `gesturestart`/`gesturechange` listener (passive: false) that calls `preventDefault()` while a pinch is active on a zoomable target.
- [ ] **Step 5:** Fix any other checklist failures from Step 1, each with a test in the matching `tests/*.test.ts` where the logic is in `src/injected/` or `src/core/`.
- [ ] **Step 6:** `npm run build:engine && npm run check`. Expected: PASS. Re-run the failed checklist steps on the simulator: pass.
- [ ] **Step 7: Commit** `"Instagram: WebKit fixes for iPhone"`

### Task 3: YouTube InnerTube client and errors

**Files:**
- Create: `src/features/youtube/innertube/clients.ts`, `src/features/youtube/innertube/request.ts`, `src/features/youtube/innertube/errors.ts`
- Test: `tests/youtubeInnertube.test.ts`

**Interfaces:**
- Produces:
  - `clients.ts`: `export const VISIONOS`, `export const WEB` (objects with the Global Constraints values) and `userAgentFor(client, gl: string): string`.
  - `errors.ts`: `class YouTubeError extends Error { code: 'ERR_YOUTUBE_BLOCKED' | 'ERR_YOUTUBE_OFFLINE' | 'ERR_YOUTUBE_RESTRICTED' | 'ERR_YOUTUBE' }`; `playabilityError(status: { status?: string; reason?: string }): YouTubeError | null`; `networkError(e: unknown): YouTubeError`.
  - `request.ts`: `innertube(client: 'web' | 'visionos', endpoint: 'search' | 'browse' | 'player' | 'navigation/resolve_url' | 'visitor_id', body: object): Promise<any>`; `visitorData(): Promise<string>` (fetched once from `https://www.youtube.com/youtubei/v1/visitor_id`, cached in memory, refetched after a BLOCKED error). visionOS player calls go to `https://youtubei.googleapis.com/youtubei/v1/player?prettyPrint=false&t=<12 random [A-Za-z0-9_-]>` with body `cpn` (16 random chars), `contentCheckOk: true`, `racyCheckOk: true`; others to `https://www.youtube.com/youtubei/v1/<endpoint>?prettyPrint=false`. Headers: `User-Agent`, `X-Goog-Api-Format-Version: 2` (visionOS); `X-YouTube-Client-Name`, `X-YouTube-Client-Version`, `Origin`/`Referer` `https://www.youtube.com` (WEB). `hl`/`gl` from the device locale, default `en`/`US`.

- [ ] **Step 1: Write the failing tests** with a mocked `global.fetch`:
  - `playabilityError({status:'LOGIN_REQUIRED', reason:'Sign in to confirm you’re not a bot'})?.code` is `'ERR_YOUTUBE_BLOCKED'` and its message equals the Errors.kt bot text.
  - `playabilityError({status:'LOGIN_REQUIRED', reason:'Sign in to confirm your age'})?.code` is `'ERR_YOUTUBE_RESTRICTED'`; `{status:'OK'}` gives `null`; `{status:'ERROR', reason:'Video unavailable'}` gives `ERR_YOUTUBE` with message `Video unavailable`.
  - `networkError(new TypeError('Network request failed'))` → `ERR_YOUTUBE_OFFLINE`, message `No connection.`
  - `innertube('visionos','player',{videoId:'x'})` posts to `youtubei.googleapis.com/youtubei/v1/player`, includes `visitorData` from a first `visitor_id` call, and calls `visitor_id` only once across two calls.
  - HTTP 429 → `ERR_YOUTUBE_BLOCKED`.
- [ ] **Step 2:** `npx jest tests/youtubeInnertube.test.ts` → FAIL.
- [ ] **Step 3:** Implement the three files per Interfaces.
- [ ] **Step 4:** Same command → PASS. `npm run check` → PASS.
- [ ] **Step 5: Commit** `"YouTube: InnerTube client for iOS"`

### Task 4: Search, channels and feed

**Files:**
- Create: `src/features/youtube/innertube/search.ts`, `channel.ts`, `feed.ts`, `parse.ts` (shared text/number/thumbnail helpers)
- Create fixtures: `tests/fixtures/youtube/search.json`, `search-more.json`, `channel-videos.json`, `resolve.json`, `uploads.xml` — real responses, trimmed to the parts the parsers read (keep at least 3 videos, 1 channel, 1 Shorts item, the continuation)
- Test: `tests/youtubeInnertubeBrowse.test.ts`

**Interfaces:**
- Consumes: `innertube`, `YouTubeError`, `networkError` (Task 3).
- Produces (types from `src/features/youtube/types.ts`):
  - `parseSearch(json): Page<SearchItem>`; `search(query: string, kind: 'all'|'videos'|'channels'): Promise<Page<SearchItem>>`; `more(token: string): Promise<Page<SearchItem>>`. `kind` maps to search `params`: videos `EgIQAQ%3D%3D`, channels `EgIQAg%3D%3D`, all none (URL-decode before sending). Items from `videoRenderer` and `channelRenderer`; `shortsLockupViewModel`, `reelShelfRenderer` and videos whose URL is `/shorts/` are dropped. `nextPage` is the `continuationCommand.token`.
  - `parseChannelVideos(json, id): ChannelPage`; `channel(idOrUrl: string): Promise<ChannelPage>`. Ids `UC…` (24 chars) are used directly; anything else goes through `navigation/resolve_url` → `endpoint.browseEndpoint.browseId`. Videos tab `params: 'EgZ2aWRlb3PyBgQKAjoA'`. Videos come from `richItemRenderer` → `lockupViewModel` (id `contentId`, title `metadata.lockupMetadataViewModel.title.content`, duration from the thumbnail badge text).
  - `parseUploadsRss(xml: string): Video[]`; `feed(channelIds: string[]): Promise<FeedResult>`. URL `https://www.youtube.com/feeds/videos.xml?playlist_id=UULF<channelId without "UC">`. Regex over `<entry>` blocks (no DOM in Hermes): `yt:videoId`, `title`, `published` (→ `uploadedAt` ms), `author/name`, `yt:channelId`, `media:thumbnail url`, `media:statistics views`. Unescape `&amp; &lt; &gt; &quot; &#39;`. All channels fetched in parallel, at most 6 at a time; a failing channel goes into `failed` with `errorText` of its error; results merged newest first.
- [ ] **Step 1: Write the failing tests**: `parseSearch(search.json)` returns ≥3 videos with `id`, `title`, `durationSeconds` (e.g. `28:04` → `1684`), `channelId`, and no item whose id appears in a Shorts lockup; one channel with `id` `UC…` and `thumbnail` starting `https:`; `nextPage` non-null. `parseChannelVideos` returns ≥3 videos with ids and titles. `parseUploadsRss(uploads.xml)` returns 15 videos with `uploadedAt` a finite number and `&amp;` unescaped. `feed(['UCa','UCb'])` with fetch mocked to fail for `UCb` returns `items` from `UCa` and `failed: [{channelId:'UCb', error: 'No connection.'}]` when the failure is a `TypeError`.
- [ ] **Step 2:** `npx jest tests/youtubeInnertubeBrowse.test.ts` → FAIL.
- [ ] **Step 3:** Implement per Interfaces.
- [ ] **Step 4:** Same command → PASS; `npm run check` → PASS.
- [ ] **Step 5: Commit** `"YouTube: search, channels and feed for iOS"`

### Task 5: Video details, qualities, captions

**Files:**
- Create: `src/features/youtube/innertube/video.ts`, `src/features/youtube/innertube/hls.ts`, `src/features/youtube/vtt.ts`
- Modify: `src/features/youtube/types.ts` — `VideoQuality` gains `contentType?: 'dash' | 'hls'` (missing means `'dash'`); `CaptionTrack` gains `url?: string`
- Create fixtures: `tests/fixtures/youtube/player-visionos.json` (with captions), `player-blocked.json`, `master.m3u8`, `captions.vtt`
- Test: `tests/youtubeInnertubeVideo.test.ts`, `tests/youtubeVtt.test.ts`

**Interfaces:**
- Consumes: Tasks 3–4.
- Produces:
  - `hlsHeights(master: string): number[]` — distinct heights of `EXT-X-STREAM-INF` entries whose `CODECS` start with `avc1`, highest first, capped at 1080.
  - `parsePlayer(json, master: string | null): VideoDetails` — `sources: [{ uri: hlsManifestUrl, contentType: 'hls' }]`; `qualities` = one per `hlsHeights` value, `{ height, label: '1080p60'|'720p'…, uri: hlsManifestUrl, contentType: 'hls' }` (frame rate from `FRAME-RATE`); `captions` from `captions.playerCaptionsTracklistRenderer.captionTracks` → `{ id: 'cc<i>', language: languageCode, label: name.runs[0].text ?? name.simpleText, autoGenerated: kind === 'asr', url: baseUrl + '&fmt=vtt' }`, uploaded first; `descriptionLinks` from `https?://` URLs found in `shortDescription`; `isLive` from `videoDetails.isLive`; `isShort` false (Shorts are filtered by id lists elsewhere); `durationSeconds`, `viewCount` numeric; `thumbnail` the largest.
  - `video(url: string): Promise<VideoDetails>` — id via `parseYouTubeLink` (`src/features/youtube/links.ts`); visionOS `player`; throws `playabilityError(...)` when not OK; fetches the master playlist text for `hlsHeights`; WEB `player` with `$fields=microformat` for `uploadedAt` (`microformat.playerMicroformatRenderer.publishDate`), failures of this second call ignored.
  - `downloadStreams(videoId: string, maxHeight: number): Promise<{ video: { url: string; height: number }; audio: { url: string } }>` — from `adaptiveFormats`: best `video/mp4; codecs="avc1…"` with `height <= maxHeight` (else the lowest), audio itag 140 (else best `audio/mp4`).
  - `vtt.ts`: `interface Cue { start: number; end: number; text: string }`, `parseVtt(text: string): Cue[]`, `cueAt(cues: Cue[], seconds: number): Cue | null` (binary search).
- [ ] **Step 1: Write the failing tests**: `hlsHeights(master.m3u8)` equals `[1080, 720, 480, 360, 240, 144]`; `parsePlayer(player-visionos.json, master)` has `sources[0].contentType === 'hls'`, `qualities[0].label === '1080p60'`, `captions[0].autoGenerated === false`, a caption with `autoGenerated: true` and label `English (auto-generated)`, every caption `url` ending `&fmt=vtt`; `parsePlayer` on a live fixture (set `isLive: true`, no master) gives `qualities: []`. `video()` with `player-blocked.json` rejects with `code: 'ERR_YOUTUBE_BLOCKED'`. `parseVtt(captions.vtt)[1]` equals `{ start: 18.64, end: 21.88, text: "♪ We're no strangers to love ♪" }`; `cueAt(cues, 19)` returns that cue; `cueAt(cues, 10)` returns `null`. `downloadStreams` with `maxHeight 720` picks itag 298.
- [ ] **Step 2:** `npx jest tests/youtubeInnertubeVideo.test.ts tests/youtubeVtt.test.ts` → FAIL.
- [ ] **Step 3:** Implement per Interfaces.
- [ ] **Step 4:** Same → PASS; `npm run check` → PASS.
- [ ] **Step 5: Commit** `"YouTube: video details, HLS qualities and captions for iOS"`

### Task 6: iOS YouTube backend and playback

**Files:**
- Create: `src/features/youtube/innertube/index.ts` (the engine object; OS selection stays in `native.ts`)
- Modify: `src/features/youtube/native.ts`, `src/features/youtube/player.ts`, `src/app/settings.tsx`, `src/features/youtube/components/useDownloadFlow.tsx`, `src/app/youtube/downloads.tsx` (feature flags)
- Create: `modules/youtube/ios/LiteSocialYouTube.podspec`, `modules/youtube/ios/YouTubeModule.swift`
- Modify: `modules/youtube/expo-module.config.json` → `"platforms": ["android", "ios"]`, `"ios": { "modules": ["YouTubeModule"] }`
- Test: `tests/youtubePlayerIos.test.ts`

**Interfaces:**
- Consumes: Tasks 3–5.
- Produces:
  - `native.ts`: `youtube()` returns on Android the Kotlin module (unchanged), on iOS an object implementing `YouTubeNativeModule` from the engine plus the Swift module; `youtubeAvailable` true on both. New export `youtubeFeatures: { audioFormat: 'mp3' | 'm4a'; musicFolder: boolean; swipeAdjust: boolean; nativeZoom: boolean; captions: 'player' | 'overlay'; capVideoHeight?: (player: VideoPlayer, height: number | null) => void }` — Android `{ 'mp3', true, true, true, 'player' }`, iOS `{ 'm4a', false, false, false, 'overlay', capVideoHeight }`. Folder calls (`pickMusicFolder` etc.) throw on iOS; `isMusicoletInstalled` returns false.
  - Swift `YouTubeModule` (module name `LiteSocialYouTube`): `Function("capVideoHeight") { (player: SharedRef<AVPlayer>, height: Int?) }` sets `player.ref.currentItem?.preferredMaximumResolution` to `CGSize(width: height*16/9, height: height)` or `.zero` for nil; `Events("onDownloadUpdate", "onFullscreenExitRequest", "onZoomChange", "onSwipeAdjust")`. Download functions arrive in Task 8. Podspec depends on `ExpoModulesCore`.
  - `player.ts`: `load()` uses `quality.contentType ?? 'dash'`; `captionsAvailable` is `details.captions.length > 0 && !details.isLive && (youtubeFeatures.captions === 'overlay' || source.contentType === 'dash')`; in overlay mode `applyCaption` sets `usePlayer.caption` from `wantedCaption` without touching `player.subtitleTrack`; after every `replaceAsync`, `youtubeFeatures.capVideoHeight?.(p, usePlayer.getState().quality)`.
- [ ] **Step 1: Write the failing test** (`tests/youtubePlayerIos.test.ts`, `jest.mock('react-native', … Platform.OS = 'ios')`, expo-video mocked): `play(details)` with `qualities[0].contentType === 'hls'` calls `replaceAsync` with `contentType: 'hls'`; with captions present, `usePlayer.getState().captionsAvailable` is true; `setCaption('cc0')` sets `caption: 'cc0'` and never assigns `subtitleTrack`.
- [ ] **Step 2:** `npx jest tests/youtubePlayerIos.test.ts` → FAIL.
- [ ] **Step 3:** Implement per Interfaces; hide the MP3 bitrate and Musicolet rows in Settings and the folder step in `useDownloadFlow` when `!youtubeFeatures.musicFolder`; show "M4A" for the audio option when `audioFormat === 'm4a'`.
- [ ] **Step 4:** Same → PASS; `npm run check` → PASS; existing `tests/youtube*.test.ts` still PASS (Android path).
- [ ] **Step 5:** `npx expo run:ios`: subscribe to a channel via Search, the feed lists its videos, a video plays with sound, picking 360p visibly lowers quality, leaving the app keeps audio playing with lock-screen controls.
- [ ] **Step 6: Commit** `"YouTube on iOS: engine backend and playback"`

### Task 7: Captions overlay, full screen, pinch to zoom

**Files:**
- Create: `src/features/youtube/components/CaptionOverlay.tsx`, `src/features/youtube/components/ZoomableVideo.tsx`
- Modify: `src/features/youtube/fullscreen.ts`, `src/features/youtube/zoom.ts`, `src/app/youtube/watch/[videoId].tsx`
- Test: `tests/youtubeZoom.test.ts`

**Interfaces:**
- Consumes: `parseVtt`, `cueAt` (Task 5), `youtubeFeatures` (Task 6), `useZoom`, `usePlayer`.
- Produces:
  - `CaptionOverlay({ video: VideoDetails })` — when `usePlayer.caption` is set and `youtubeFeatures.captions === 'overlay'`, fetches that track's `url` once per track, polls `getPlayer().currentTime` every 250 ms, renders `cueAt` text bottom-centred over the video (white on 60% black, `accessibilityLiveRegion="polite"`). A fetch failure sets `usePlayer.captionError` to "Captions couldn't be loaded." and turns captions off.
  - `ZoomableVideo({ children })` — Android: renders children unchanged (native zoom). iOS: a `PanResponder` wrapper; two touches scale (clamped 1–5) around the midpoint, one touch pans while scale > 1, translation clamped so the video edge never enters the frame; writes `useZoom.scale`; `resetZoom()` animates back to 1 (Animated.spring).
  - Pure helper in `zoom.ts`: `clampPan(scale: number, pan: { x: number; y: number }, size: { width: number; height: number }): { x: number; y: number }`.
  - `fullscreen.ts`: on iOS `enterFullscreen` → `ScreenOrientation.lockAsync(LANDSCAPE)` + `setStatusBarHidden(true)`; `exitFullscreen` → `lockAsync(PORTRAIT_UP)` + `setStatusBarHidden(false)`. Android path unchanged.
- [ ] **Step 1: Write the failing test**: `clampPan(2, {x: 500, y: 0}, {width: 400, height: 225})` → `{x: 200, y: 0}`; `clampPan(1, {x: 50, y: 50}, …)` → `{x: 0, y: 0}`.
- [ ] **Step 2:** `npx jest tests/youtubeZoom.test.ts` → FAIL.
- [ ] **Step 3:** Implement per Interfaces and use both components in the watch screen around the `VideoView`.
- [ ] **Step 4:** Same → PASS; `npm run check` → PASS.
- [ ] **Step 5:** Simulator: captions (English, then English auto-generated) show in sync; full screen turns sideways and back; pinch zooms with the "2.0× · Reset" chip and Reset works.
- [ ] **Step 6: Commit** `"YouTube on iOS: captions, full screen and zoom"`

### Task 8: YouTube downloads on iOS

**Files:**
- Create: `modules/youtube/ios/Downloads.swift`
- Modify: `modules/youtube/ios/YouTubeModule.swift`, `src/features/youtube/native.ts`
- Test: `tests/youtubeDownloadsIos.test.ts`

**Interfaces:**
- Consumes: `downloadStreams` (Task 5), Swift module (Task 6).
- Produces:
  - Swift: `Function("startDownload") { (options: [String: Any]) -> String }` with `id`, `title`, `format: 'mp4' | 'm4a'`, `videoUrl?`, `audioUrl`, `captionsUrl?`; `cancelDownload(id)`, `getDownloads() -> [[String: Any]]`, `clearFinishedDownloads()`, `onDownloadUpdate` events in the Android `DownloadUpdate` shape. Ranged GETs of 10 MB (`Range: bytes=a-b`); MP4 joined with `AVMutableComposition` + `AVAssetExportSession` preset `AVAssetExportPresetPassthrough`, `.mp4`; M4A saved as `.m4a` with title/artist/artwork metadata (export with `metadata`); captions saved as `<name>.srt` next to the MP4 (VTT → SRT). Files in `Documents/Downloads/`, names sanitised (`/:\?%*|"<>` → `_`). State persisted in `UserDefaults` key `litesocial.downloads`; on launch any `queued|downloading|converting|saving` entry becomes `failed` with error `Interrupted. Start it again.` A `UIApplication.beginBackgroundTask` covers the time after leaving the app.
  - `native.ts` iOS `startDownload(options)`: generates the id, emits a `queued` update, resolves `downloadStreams(id, maxHeight)` (and the caption URL for `captionLanguage`), then calls Swift `startDownload`; a resolve failure emits `failed` with `errorText`. Format `'mp3'` from the UI maps to `'m4a'`.
- [ ] **Step 1: Write the failing test** (Swift module mocked): iOS `startDownload` returns an id, the listener first sees `state: 'queued'`, then Swift `startDownload` is called with `audioUrl` and (for mp4) `videoUrl`; with `downloadStreams` rejecting `ERR_YOUTUBE_OFFLINE`, the listener sees `state: 'failed', error: 'No connection.'`.
- [ ] **Step 2:** `npx jest tests/youtubeDownloadsIos.test.ts` → FAIL.
- [ ] **Step 3:** Implement Swift and JS per Interfaces.
- [ ] **Step 4:** Same → PASS; `npm run check` → PASS.
- [ ] **Step 5:** Simulator: download one MP4 with captions and one M4A; both play from the Files app (On My iPhone → Lite Social → Downloads), the MP4 shows the `.srt` beside it; kill the app during a download, reopen: the Downloads screen shows it failed with "Interrupted. Start it again."
- [ ] **Step 6: Commit** `"YouTube on iOS: MP4 and M4A downloads"`

### Task 9: Instagram notifications on iOS

**Files:**
- Create: `src/features/instagramAlerts/checker/api.ts`, `inbox.ts`, `checker.ts`, `state.ts`, `notify.ts`, `task.ts`
- Create: `modules/instagram-alerts/ios/InstagramAlerts.podspec`, `modules/instagram-alerts/ios/InstagramAlertsModule.swift`
- Modify: `modules/instagram-alerts/expo-module.config.json` (add `ios`), `src/features/instagramAlerts/instagramAlerts.ts`, `src/app/settings.tsx` (alerts section texts and hidden battery row), `src/app/_layout.tsx` (notification tap → route), `app.json` (plugins for `expo-notifications`, `expo-background-task`)
- Create fixtures: `tests/fixtures/instagram/inbox-graphql.json`, `inbox-rest.json`, `news-inbox.json` (from `modules/instagram-alerts/android/src/test/.../DirectInboxTest.kt` cases)
- Test: `tests/instagramChecker.test.ts`

**Interfaces:**
- Consumes: none from earlier tasks.
- Produces:
  - Swift module `InstagramAlerts` (iOS): `AsyncFunction("request") { (method: String, path: String, headers: [String: String], body: String?) -> ["status": Int, "body": String] }` — `path` must start with `/`; the URL is always `https://www.instagram.com` + path; cookies for that host read from `WKWebsiteDataStore.default().httpCookieStore` (main thread) and sent as one `Cookie` header; `Set-Cookie` responses written back to the same store; ephemeral `URLSession`. `AsyncFunction("hasSession") -> Bool` (`sessionid` cookie present).
  - `api.ts`: TypeScript port of `InstagramApi.kt` (`getJson`, `postForm`, `graphql`, `tokens`, `Failure` messages identical) over `request`.
  - `inbox.ts`: port of `DirectInbox.kt` (`parseGraphql`, `parseRest`, same `INBOX_DOC_ID = "27262915580045003"`, `MESSAGES_PER_THREAD = 5`, `THREADS = 20`).
  - `checker.ts`: port of `InstagramChecker.kt` (`check(): Promise<CheckResult>`, same limits `MAX_ACTIVITY_ALERTS = 5`, `MAX_MESSAGE_LINES = 5`, `MIN_BACKGROUND_GAP_MS = 5 * 60_000`).
  - `state.ts`: zustand store persisted in AsyncStorage key `lite-social.instagram-alerts`, holding what `AlertPrefs.kt` holds.
  - `notify.ts`: `expo-notifications` local notifications; identifiers `ig-dm:<threadId>`, `ig-activity:<id>`, `ig-dm-badge`, `ig-test`; `data.url` = `litesocial://browse/instagram?open=thread&thread=<id>` / `open=messages` / `open=activity`; read conversations removed with `dismissNotificationAsync`.
  - `task.ts`: `expo-background-task` task `lite-social-instagram-check`, registered with `minimumInterval` = the chosen minutes, runs `check()` in the background and records `lastBackgroundAt`.
  - `instagramAlerts.ts`: iOS `native` object implements `InstagramAlertsModule` from the above; `isIgnoringBatteryOptimizations()` returns true and `requestIgnoreBatteryOptimizations` is a no-op; new export `alertsPlatformNote: string | null` — iOS: `"iOS decides when background checks run: at most every 15 minutes, often less, and not after you swipe Lite Social away."`; Android `null`. `requestNotificationPermission()` on iOS calls `Notifications.requestPermissionsAsync()`.
- [ ] **Step 1: Write the failing tests** with `request` mocked: `parseGraphql(inbox-graphql.json, viewer)` returns the same threads the Kotlin test expects (titles, unread, last messages); `check()` with every request returning `{status: 200, body: '<html>login</html>'}` and no session gives `loggedIn: false`, `messages: 'Not logged in. Open Instagram in Lite Social and log in.'`, and no `scheduleNotificationAsync` call; a fixture with one new thread schedules exactly one notification with identifier `ig-dm:<threadId>`; a second identical check schedules none.
- [ ] **Step 2:** `npx jest tests/instagramChecker.test.ts` → FAIL.
- [ ] **Step 3:** Implement per Interfaces; existing `tests/instagramAlerts.test.ts` must still pass.
- [ ] **Step 4:** Same → PASS; `npm run check` → PASS.
- [ ] **Step 5:** Device or simulator: turn alerts on (permission asked), "Send test notification" shows one, "Check now" reports counts, tapping a message notification opens that DM; Settings shows `alertsPlatformNote` and no battery row.
- [ ] **Step 6: Commit** `"Instagram notifications on iOS"`

### Task 10: Instagram calls on iOS

**Files:**
- Modify: `src/webview/userAgent.ts`, `src/webview/PlatformWebView.tsx`, `src/platforms/types.ts` (doc comments: fields are cross-OS), `patches/react-native-webview+13.16.1.patch` (regenerated with `npx patch-package react-native-webview`)
- Test: `tests/userAgent.test.ts` (extend)

**Interfaces:**
- Produces: `toTabletUserAgent(mobileUserAgent: string, os: MobileOS): string` — Android unchanged; iOS returns `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/<major.minor from "iPhone OS x_y"> Safari/605.1.15`. `PlatformWebView` uses `tabletUserAgentPaths` on both OSes. iOS part of the patch in `RNCWebViewImpl.m`: in `webView:createWebViewWithConfiguration:forNavigationAction:windowFeatures:`, when `windowFeatures.width` is set, create a `WKWebView` with the given configuration, present it full screen over the app with a close button, return it (so `window.opener` works), and dismiss it on `webViewDidClose:`.
- [ ] **Step 1: Write the failing test**: `toTabletUserAgent(<iPhone Safari UA with "iPhone OS 18_6">, 'ios')` equals the Mac Safari UA with `Version/18.6`; Android case unchanged.
- [ ] **Step 2:** `npx jest tests/userAgent.test.ts` → FAIL.
- [ ] **Step 3:** Implement the UA and the patch; `npm install` re-applies the patch cleanly.
- [ ] **Step 4:** `npm run check` → PASS.
- [ ] **Step 5:** On the iPhone (needs camera and microphone): open a DM, the call buttons show, an audio call connects, the window closes with its button. If Instagram doesn't offer calls or WebKit can't run them: revert this task's behaviour change (keep `tabletUserAgentPaths` Android-only), keep the test for the UA function out, and document the reason in README "Known limitations".
- [ ] **Step 6: Commit** `"Instagram calls on iOS"` (or `"Docs: why Instagram calls stay Android-only"`)

### Task 11: Docs and final verification

**Files:**
- Modify: `README.md` ("Install on your iPhone" after the Android section; iOS items in "Known limitations"; YouTube table notes for iOS: M4A, Files app, no swipe adjust), `docs/TESTING_CHECKLIST.md` (an "iPhone" section covering Tasks 2, 6–10)

- [ ] **Step 1:** Write the README section: install Xcode, add the Apple ID in Xcode → Settings → Accounts, enable Developer Mode on the iPhone, connect by cable, `npx expo run:ios --device --configuration Release`, trust the developer in iPhone Settings → General → VPN & Device Management, and the 7-day re-install rule.
- [ ] **Step 2:** `npm run check` → PASS. Android: `npx expo prebuild --platform android --no-install && (cd android && ./gradlew assembleDebug)` → BUILD SUCCESSFUL.
- [ ] **Step 3:** Install on the owner's iPhone with the README steps and run the iPhone checklist.
- [ ] **Step 4: Commit** `"Docs: iPhone install and testing"`
