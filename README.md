# Lite Social

A stripped-down way to use social media. Lite Social opens a platform's real mobile
website inside a controlled in-app browser and removes the addictive parts
(short-form video, algorithmic feeds, endless scroll) while keeping the useful
ones (DMs, profiles, following, posting).

> **Status:** Milestone 1 of 5. The WebView wrapper and login persistence are
> done. Blocking arrives in Milestones 2–3. See [Roadmap](#roadmap).

## Running it

### Prerequisites

- **Node.js 22 LTS or newer** (`winget install OpenJS.NodeJS.LTS` on Windows).
- **Expo Go** on your phone from the App Store or Play Store. Everything up to
  Milestone 4 runs in Expo Go, so no Apple or Google developer account is needed.
- Optional: an Android emulator (Android Studio). The iOS Simulator needs a Mac.

### Start

```sh
npm install
npx expo start
```

Scan the QR code with the Camera app (iOS) or with Expo Go (Android).

If your phone can't reach your computer (common on work or guest Wi-Fi, or when
the Windows Firewall blocks Node), use a tunnel instead:

```sh
npx expo start --tunnel
```

### Checks

```sh
npm run typecheck   # TypeScript
npm run lint        # ESLint (expo config)
npm test            # Jest unit tests
npm run check       # all three
```

## How it works (so far)

- `src/platforms/`: one config object per platform (`instagram.ts`), listed in
  `registry.ts`. Base URL, name and user-agent overrides live here and are
  bundled with the app.
- `src/webview/PlatformWebView.tsx`: the controlled browser. It loads the
  platform's mobile site and keeps the session in the WebView's own persistent
  cookie store. It has a slim toolbar (close, back, reload, home), pull-to-refresh
  on iOS, and Android back-button support. If the OS kills the WebView's web
  process, it recovers by remounting the WebView.
- `src/webview/userAgent.ts`: presents the WebView as the stock mobile browser
  for the device. It takes the device's real WebView UA and strips the Android
  `wv` / `Version/4.0` markers, or adds Safari's `Version/x.y … Safari/604.1`
  tokens on iOS. Sites then serve the normal mobile site instead of an
  "open in app" wall, and the engine version stays truthful.
- `src/app/`: Expo Router screens (picker at `/`, browser at `/browse/[platformId]`).

### Privacy

The app never reads, stores or transmits credentials, cookies, messages or page
content. You log in on the platform's real page inside the WebView, and the
session lives in the WebView's own cookie store, which our code never touches.

## Roadmap

1. ~~WebView wrapper + login persistence~~
2. Navigation blocking (`onShouldStartLoadWithRequest`, URL matcher with unit tests)
3. Injected CSS + JS (MutationObserver, SPA route interception)
4. Settings screen + toggles, daily time limit
5. Remote-updatable rules, "Report a leak", privacy screen, full docs and testing checklist

## Known limitations (so far)

- Pull-to-refresh is iOS-only (a `react-native-webview` limitation). On
  Android, use the toolbar's reload button.
- Until Milestone 2, links that try to open the native Instagram app
  (`instagram://`, `intent://`) aren't intercepted yet, so they may switch
  you to the real app.
