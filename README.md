# Lite Social

A stripped-down way to use social media. Lite Social opens a platform's real
mobile website inside a controlled in-app browser and removes the addictive
parts (Reels, the algorithmic feed, Explore, suggestions, endless scroll), while
keeping the useful ones: DMs, profiles, notifications, search, and posting.

Instagram runs in that filtered browser. YouTube is different: Google blocks signing in inside embedded
browsers, so Lite Social has its own small YouTube client instead (no account, no ads, no Shorts, only your
subscriptions, background play and downloads). The browser design makes adding Facebook (Reels), TikTok and
others mostly a configuration change.

## Install on your Android phone

1. Get `release/LiteSocial-1.3.0.apk` (build it with `scripts/build-android.ps1`, see [Building the APK](#building-the-apk)).
2. Install it, either way works:
   - **USB:** enable USB debugging on the phone, connect it, and run `adb install -r release\LiteSocial-1.3.0.apk`.
     If you use scrcpy, you can also drag the APK onto the scrcpy window.
   - **File:** copy the APK to the phone and open it in My Files. Allow "Install unknown apps" for My Files when asked.
3. Samsung: if installation is refused, turn off **Settings → Security and privacy → Auto Blocker** while you
   install, then turn it back on. Google Play Protect may ask you to scan the app; that's normal for apps not
   from the Play Store.
4. Open Lite Social, tap Instagram and log in on Instagram's own login page.

## What it does

| Setting (Instagram) | Default | What it does |
| --- | --- | --- |
| Block Reels | On | Removes the Reels tab, collapses Reels/videos in the feed and on profiles, blocks opening any Reel |
| Watch shared reels | On | With Block Reels on, a single reel sent to you in a DM, on a profile or in a post still opens and plays. The Reels tab, its swipe-for-more viewer and reels in the home feed stay blocked |
| Hide Explore | On | Search keeps working; the grid of recommended posts under it is hidden |
| Hide suggestions | On | Hides "Suggested for you" posts and the suggested-accounts carousel |
| Following feed | On | Opens Instagram's chronological feed of accounts you follow |
| Stop the feed | On, 30 posts | Ends the home feed with a "you're all caught up" card (10/20/30/50) |
| Hide Stories | Off | Blocks opening stories; hides the tray where it can be found |
| Daily time limit | Off | 15–120 min/day; then a break screen, with one "5 more minutes" per day |

### Instagram notifications (Android)

Lite Social can't receive Instagram's push notifications: the site runs in a WebView, and Android's WebView has no
web push. So Lite Social checks Instagram itself, in the background, with the login from its in-app browser. It
calls the same web API instagram.com calls (`/api/v1/direct_v2/inbox/` for messages, `/api/v1/news/inbox/` for
activity), and needs no Instagram app.

1. Open Instagram in Lite Social and log in.
2. **Settings → Instagram notifications**: turn it on and allow notifications. "Check now" runs a check right away
   and shows what it found (or what went wrong, e.g. "Not logged in").
3. Tap **Allow background checks** (battery optimization off), or Android may hold the checks back for hours.

From then on, every new message gets a notification with the sender, a preview and their picture; tapping it opens
that conversation in Lite Social. Likes, comments, follows and mentions get their own notifications that open your
activity page. Once a conversation is read (anywhere), its notification disappears at the next check.

Limits: Android runs background work at most every **15 minutes** (choose 15/30/60), so alerts aren't instant, and
Doze can delay them further while the phone lies still. Muted chats and message requests don't alert. If the inbox
can't be read, the unread-messages count is the fallback ("3 unread messages"). The code is a small native module in
`modules/instagram-alerts/` (a WorkManager job; the logic is in `InstagramChecker.kt`).

### YouTube

YouTube is a native screen, not the website: Google blocks signing in inside embedded browsers, so there is no
YouTube account in Lite Social. It's built on [NewPipe Extractor](https://github.com/TeamNewPipe/NewPipeExtractor)
(the library behind the NewPipe app), which reads YouTube directly from the phone.

| Feature | How |
| --- | --- |
| Only your subscriptions | The home screen is the newest uploads of channels you subscribe to *in Lite Social*. No home page, trending, related videos or autoplay. Search exists so you can find channels (and a specific video). |
| Subscriptions | Stored on the phone. Add them with Search → Subscribe, or import Google Takeout's `subscriptions.csv` (takeout.google.com → "YouTube and YouTube Music" → subscriptions) or a NewPipe export. |
| No Shorts | The feed uses each channel's *Videos* tab, which never contains Shorts. Shorts are also dropped from search, and a Shorts link shows "Shorts are hidden". |
| No ads | The player plays the video's own streams (DASH, up to 1080p H.264). Ads are never requested. |
| Background and screen-off play | One shared player keeps playing when you leave the video, the app or turn the screen off, with lock-screen and notification controls. A mini player shows while you browse. |
| Download MP4 | Best H.264 video up to your chosen quality plus AAC audio, joined on the phone (MediaMuxer), saved to **Movies/Lite Social**. |
| Download MP3 | AAC audio decoded and encoded to MP3 on the phone (pure-Java LAME), tagged with title, channel and cover art, and saved into your **Musicolet music folder**. You pick that folder once (Android's folder picker, it starts in Music) and choose or create the subfolder for every song. |
| YouTube links | Tapping a YouTube link in another app offers "Open with Lite Social". |

Downloads run in a foreground service (progress notification), so they finish with the app closed. Musicolet scans
its folders itself: if a new song doesn't show up, pull down in Musicolet's folder view or use its rescan option.

Also: "Open in app" banners are hidden, links that try to switch to the Instagram
app are ignored, links to other sites open in your normal browser, videos don't
autoplay, and the flag button in the toolbar records a **leak report** when
something slips through.

## How blocking works

Each layer alone is brittle, so there are three:

```
           ┌───────────────────────── app (React Native) ─────────────────────────┐
           │ Layer 1: onShouldStartLoadWithRequest → core/navigationPolicy        │
           │   full page loads: block /reels/, /reel/…, deny instagram://, …      │
           └──────────────────────────────────┬───────────────────────────────────┘
                                              │ injects (before + after load)
           ┌──────────────────────────────────▼─────── page (WebView) ────────────┐
           │ Layer 2: stylesheet from core/cssBuilder                             │
           │   a[href^="/reels/"], article:has(video) … {display:none}            │
           │ Layer 3: src/injected/engine.ts                                      │
           │   MutationObserver (debounced, no polling): "Suggested for you",     │
           │   feed limit · history.pushState/replaceState/popstate +             │
           │   Navigation API: in-page route changes to Reels                     │
           └──────────────────────────────────────────────────────────────────────┘
```

- **Layer 1** sees real page loads. It can't see single-page-app navigation (tapping the Reels tab only calls
  `history.pushState`).
- **Layer 2** hides things by CSS before the page paints. Selectors match **where links point**
  (`a[href*="/reel/"]`) and **structure** (`article:has(video)`), never Instagram's generated class names,
  which change constantly.
- **Layer 3** catches what CSS can't express (text such as "Suggested for you", counting feed posts) and
  intercepts in-page navigation. It also pauses any video that starts playing inside something it hid.

The route matcher (`src/core/routeMatcher.ts`) is shared: the same code runs in the app and, bundled by
esbuild, in the page, so both layers always agree.

Everything **fails open**: a broken selector drops only that one CSS rule, every engine step is wrapped in
try/catch, login, 2FA and DMs are on a `neverBlock` list no rule can override, and a redirect-loop guard gives
up rather than reloading forever.

## Privacy

- No fake login: you sign in on the real site inside the WebView.
- The app never reads, stores or transmits credentials, messages or page content. The session lives in the
  WebView's own cookie store (Instagram notifications below are the one exception).
- The injected script reads the page only to decide what to hide. All it sends back to the app is "blocked
  rule X on path Y" (path only, no query) and, for leak reports, how many elements each rule matched.
- Besides the platforms, the only network request the app makes itself is downloading the public rules file. No
  analytics.
- Stored on the phone: settings, today's total minutes, leak reports, YouTube subscriptions and feed cache.
- Instagram notifications (off by default) are the one place the app reads the in-app browser's cookies: the
  background check sends your Instagram login cookies to instagram.com (and only there) to ask for new messages and
  activity, as the site itself would. Sender names, previews and activity texts go straight into notifications.
  Nothing is stored or sent anywhere else.
- YouTube needs no account. Searches, channels, feeds and videos are requested from YouTube directly by the phone;
  the subscription list, cached feed and downloads stay on the phone.

## Project structure

```
src/
  app/                 Expo Router screens: picker, browse/[platformId], youtube/*, settings, leaks, privacy
  platforms/           Code-side platform configs (instagram.ts), registry, toggle defaults
  core/                Pure logic shared by app and page: URLs, route matcher, navigation policy, CSS builder, types
  injected/            In-page engine (engine.ts) and its generated bundle (generated/engineSource.ts)
  rules/               Rules validation (schema.ts) and loading/updating (rulesStore.ts)
  webview/             PlatformWebView (all three layers), toolbar, overlays, UA handling, page bridge
  features/timeLimit/  Daily limit tracking and the break screen
  features/instagramAlerts/ JS side of Instagram notifications (status, settings)
  features/youtube/    YouTube client: native bridge, stores, player, downloads, components
  state/               Persisted stores: settings, usage, leak reports
  ui/                  Theme and shared components
modules/instagram-alerts/ Native Android module: background Instagram check (WorkManager) and its notifications
modules/youtube/       Native Android module: NewPipe Extractor, DASH playback manifests, downloads, MP3 encoding
rules/rules.json       Blocking rules: bundled with the app AND fetched remotely
scripts/               build-engine.js (bundles the injected script), build-android.ps1 (builds the APK)
tests/                 Jest tests (route matching, navigation policy, CSS, rules validation, engine in jsdom)
docs/TESTING_CHECKLIST.md
```

## Development

Requirements: Node.js 22+. For quick iteration you can use Expo Go:

```sh
npm install
npx expo start          # scan the QR code with Expo Go (use --tunnel on restrictive Wi-Fi)
```

Checks:

```sh
npm run check           # typecheck + lint + tests
npm run build:engine    # after changing src/injected/ or src/core/ (a test fails if you forget)
```

## Building the APK

On Windows, without Android Studio:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-android.ps1
```

The build pulls NewPipe Extractor from JitPack and sets `minSdkVersion` 33 (Android 13+) for it. Needs Node.js on PATH, JDK 17 (`JAVA_HOME`, or a `jdk-17*` folder in `%LOCALAPPDATA%\Programs`) and the Android SDK
(`ANDROID_HOME`, or `%LOCALAPPDATA%\Android\Sdk`) with platform 36, build-tools 36.0.0, NDK 27.1.12297006 and
CMake 3.22.1. React Native's native build breaks on paths with spaces and on Windows' 260-character path limit,
so the script mirrors the source into a short folder (`%USERPROFILE%\lsb`) and builds there, and
`plugins/withCMakeObjectPathMax.js` makes CMake shorten its deepest object-file paths. The first build takes
20–40 minutes; later ones are much faster. It builds for arm64 phones only (pass `-Architectures "arm64-v8a,x86_64"` for emulators) and
writes `release\LiteSocial-<version>.apk`. The APK is signed with Expo's template debug key: fine for your own
phones, and new builds install over old ones. Bump `version`/`android.versionCode` in `app.json` for each
release you hand out.

Alternatively, `npx eas-cli build -p android --profile preview` builds in Expo's cloud (needs a free Expo account).

## Updating the blocking rules (no app update needed)

When Instagram changes its markup and something leaks through:

1. Find what broke. In the app, tap the **flag** on the leaking page, then open Settings → Leak reports. A rule
   showing **0** matches is the broken one. To look at the live page, turn on Settings → Advanced → "Allow page
   inspection", connect the phone over USB and open `chrome://inspect` in desktop Chrome.
2. Edit `rules/rules.json`. Prefer link targets (`a[href*="/reel/"]`), ARIA roles and `:has()` structure over
   class names. Each rule's `note` explains its choice.
3. Increase `revision` (the app only takes rules with a higher revision than it has) and update `updated`.
4. Run `npm test` (it validates the file), then commit and push to `main`.

Apps fetch the file on every launch (and via Settings → "Check for rule updates") from
`https://raw.githubusercontent.com/jarod85/SocialLiteClone/main/rules/rules.json`, which only works if the
repository is public. Point `EXPO_PUBLIC_RULES_URL` at any other HTTPS host when building to change it. A
download that fails or doesn't validate changes nothing; the bundled copy is always the fallback.

**Rules are data only.** They contain path patterns, CSS selectors and short texts, never JavaScript or CSS
declarations. The app writes every declaration itself and rejects selectors containing `{ } ; @ \ <`, comments
or `url(`, so a compromised rules URL can at worst hide the wrong things. It can't run code in your logged-in
session or leak page data. Rules can't change which sites load or the `neverBlock` list either; those live in
code.

Rule types (see `src/core/types.ts`):

| Key | Layer | Example |
| --- | --- | --- |
| `routes` | 1 and 3 | `{"id":"reels-pages","toggle":"blockReels","action":"block","paths":["/reels/**","/reel/**"]}` |
| `hide` | 2 | `{"id":"reel-links","toggle":"blockReels","selectors":["a[href*=\"/reel/\"]"]}`; `mode:"collapse"` leaves a labelled bar; `paths` scopes it |
| `textHide` | 3 | `{"match":["Suggested for you"],"containers":["article"]}`: hides the closest container |
| `feedLimit` | 3 | `{"itemSelector":"article","paths":["/"]}` |

Path globs: `*` is one segment, `**` any number. Case and trailing slashes are ignored.

Any rule can have `toggle` (on only when that setting is on) and `unless` (off when that setting is on), e.g.
`"toggle":"blockReels","unless":"allowSharedReels"`. Apps older than engine v2 ignore `unless`, which only makes
them stricter.

## Adding a platform

For a site that only needs the existing rule types (true for YouTube, Facebook, TikTok):

1. Create `src/platforms/<id>.ts` with a `PlatformConfig`: `baseUrl` (the mobile site), `siteHosts`,
   `allowedHosts` (site and login hosts), `neverBlock` (login, 2FA and messaging paths) and its `toggles`.
2. Add it to `src/platforms/registry.ts`.
3. Add a `"<id>"` section to `rules/rules.json` with its routes, selectors and texts, and bump `revision`.
4. `npm test` checks that every toggle a rule references exists. Add a few cases to
   `tests/navigationPolicy.test.ts` for the new URLs.

Example YouTube rules sketch: `routes: [{"id":"shorts","toggle":"blockShorts","action":"block","paths":["/shorts/**"]}]`,
`hide: [{"selectors":["a[href^=\"/shorts\"]","ytm-reel-shelf-renderer"]}]`.

You only need engine code when a site needs a new kind of rule. In that case, bump `ENGINE_VERSION` in
`src/core/types.ts` and set `minEngineVersion` in rules that use it.

## Known limitations

Said plainly, so nothing is oversold:

- **Selectors need tuning on a real device.** The initial Instagram selectors were written from Instagram's URL
  structure and known markup patterns without inspecting a live, logged-in session. Expect one round of fixes
  via leak reports and `rules.json`. The URL-based blocking (`/reels/`, `/reel/…`) is the most reliable part.
- **Text matching is English-only.** "Suggested for you" is found by its text. Add translations to `match`
  if your Instagram is in another language.
- **Reels shared in DMs** (with "Watch shared reels" off): opening them is blocked and links to them are hidden,
  but a preview card in a different format could still show. Its video can't autoplay.
- **Watch shared reels** allows `/reel/<id>` pages. A reel page can link to other single reels, and those open
  too (one tap each); swiping into the endless viewer (`/reels/…`) stays blocked. A shared link in the plural
  `/reels/<id>` form is treated as the viewer and blocked.
- **Reels opened through `/p/` links** look like normal posts by URL; the in-page video check catches them,
  routing doesn't.
- **Hide Stories** reliably blocks *opening* stories. Hiding the tray is best-effort (it has no stable link).
- **Feed limit:** Instagram may keep loading posts in the background after the limit card (they stay hidden).
- **Following feed** relies on Instagram's `?variant=following`. If Instagram drops it, you get the normal feed.
- **Android timing:** on Android the script is injected when the page starts loading, which can race
  Instagram's own scripts. CSS is applied a moment later on a cold start, and the Navigation API hook
  covers navigation the history patch might miss.
- **Pull-to-refresh is iOS-only** (a `react-native-webview` limitation); Android has the toolbar reload button.
- **Instagram notifications are checked, not pushed.** Every 15 minutes at best, later when Android's battery
  management holds background work back. They use Instagram's undocumented web API; if Instagram changes it,
  Settings → "Check now" shows the error and the app needs an update. Activity alerts depend on
  `/api/v1/news/inbox/`, the least certain part.
- **YouTube depends on NewPipe Extractor keeping up with YouTube.** When YouTube changes something, playback or
  downloads can stop until the library (and this app) is updated: bump the version in
  `modules/youtube/android/build.gradle` and rebuild. YouTube may also ask a network to "confirm you're not a bot".
  There's no account: no watch history, likes, comments or members-only videos. Age-restricted videos don't play.
- **MP3 conversion takes a moment.** It runs on the phone's CPU (a 4-minute song takes roughly 10–30 seconds).
- **It's not a device-level blocker.** The Instagram and YouTube apps and websites still work outside Lite Social. Blocking
  those needs Screen Time (iOS) or Accessibility/VPN (Android) APIs, a separate project.
- **Platform risk:** Instagram can detect embedded browsers and could degrade the site or block login, and
  app stores may reject apps that modify third-party sites (Apple 5.2.2/4.2). This build is for personal use.

## Licenses

NewPipe Extractor is GPL-3.0 and jump3r (the LAME MP3 encoder in Java) is LGPL. That's fine for building this app
for yourself; handing the APK to others means following those licenses.
