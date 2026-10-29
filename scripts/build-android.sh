#!/usr/bin/env bash
#
# Builds an installable Lite Social APK on macOS (or Linux), without Android
# Studio. The counterpart of scripts/build-android.ps1 for Windows; both build
# the same APK.
#
#   1. Mirrors the project's source into a build folder with no spaces (React
#      Native's native build can't cope with spaces). It also keeps the
#      generated android/ folder and the build's node_modules out of the project.
#   2. Installs dependencies there when package-lock.json changed.
#   3. Generates the native android/ project from app.json (Expo prebuild).
#   4. Runs Gradle's release build.
#   5. Copies the APK to release/LiteSocial-<version>.apk in this project.
#
# The APK is signed with your private release key, described by
# ~/.litesocial/signing.properties (see plugins/withReleaseSigning.js). It must
# be the same key as on any other computer you build on (copy the folder over):
# Android only installs an update signed with the key of the installed app.
#
# Usage: scripts/build-android.sh [options]
#   --architectures LIST  CPU architectures (default arm64-v8a, every current phone).
#                         Use "arm64-v8a,x86_64" to include emulators.
#   --build-dir DIR       Build folder (default ~/lsb). No spaces.
#   --signing FILE        Release key's properties file (default ~/.litesocial/signing.properties).
#   --debug-signing       Sign with Expo's public debug key instead (testing only: it
#                         won't install over a release-signed app).
#
# JDK 17: JAVA_HOME, or the one /usr/libexec/java_home finds on macOS.
# Android SDK: ANDROID_HOME, or ~/Library/Android/sdk (macOS) / ~/Android/Sdk (Linux).

set -euo pipefail

architectures='arm64-v8a'
build_dir="$HOME/lsb"
signing="$HOME/.litesocial/signing.properties"
debug_signing=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --architectures) architectures="$2"; shift 2 ;;
    --build-dir) build_dir="$2"; shift 2 ;;
    --signing) signing="$2"; shift 2 ;;
    --debug-signing) debug_signing=1; shift ;;
    -h|--help) sed -n '2,32p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
done

fail() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
step() { printf '\033[36m%s\033[0m\n' "$*"; }

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -z "${JAVA_HOME:-}" && -x /usr/libexec/java_home ]]; then
  JAVA_HOME="$(/usr/libexec/java_home -v 17 2>/dev/null || true)"
fi
if [[ -z "${ANDROID_HOME:-}" ]]; then
  if [[ "$(uname)" == Darwin ]]; then ANDROID_HOME="$HOME/Library/Android/sdk"; else ANDROID_HOME="$HOME/Android/Sdk"; fi
fi
[[ -n "${JAVA_HOME:-}" && -x "$JAVA_HOME/bin/java" ]] || fail "JDK 17 not found. Install it (see README, 'Building the APK') or set JAVA_HOME."
[[ -d "$ANDROID_HOME/platform-tools" ]] || fail "Android SDK not found at $ANDROID_HOME. Set ANDROID_HOME."
command -v node >/dev/null || fail "Node.js not found on PATH."
[[ "$build_dir" =~ [[:space:]] ]] && fail "The build folder must not contain spaces: $build_dir"

if [[ $debug_signing == 1 ]]; then
  export LITESOCIAL_SIGNING=''
elif [[ -f "$signing" ]]; then
  LITESOCIAL_SIGNING="$(cd "$(dirname "$signing")" && pwd)/$(basename "$signing")"
  export LITESOCIAL_SIGNING
else
  fail "Release key not found at $signing. Copy ~/.litesocial from the computer that has it, or create one (see README, 'Signing key'), or pass --debug-signing."
fi
export JAVA_HOME ANDROID_HOME
export PATH="$JAVA_HOME/bin:$PATH"

step "1/5 Copying the project to $build_dir..."
mkdir -p "$build_dir"
# --delete removes stale files; excluded folders are neither copied nor deleted. android/ and ios/
# are excluded only at the root: they're generated there, but local modules (modules/*/android) are source.
rsync -a --delete \
  --exclude node_modules --exclude /android --exclude /ios --exclude /release \
  --exclude .expo --exclude .git --exclude dist \
  "$project_root/" "$build_dir/"

cd "$build_dir"
lock_hash="$(shasum -a 256 package-lock.json | cut -d' ' -f1)"
stamp='node_modules/.lite-social-lock-hash'
if [[ ! -f "$stamp" || "$(cat "$stamp")" != "$lock_hash" ]]; then
  step '2/5 Installing dependencies...'
  npm ci --no-audit --no-fund
  echo "$lock_hash" > "$stamp"
else
  step '2/5 Dependencies unchanged.'
fi

step '3/5 Generating the native Android project...'
CI=1 npx expo prebuild --platform android --clean --no-install
echo "sdk.dir=$ANDROID_HOME" > android/local.properties

step "4/5 Building the release APK ($architectures)..."
(cd android && ./gradlew assembleRelease "-PreactNativeArchitectures=$architectures" --no-daemon)

step '5/5 Copying the APK...'
version="$(node -p "require('./app.json').expo.version")"
mkdir -p "$project_root/release"
apk="$project_root/release/LiteSocial-$version.apk"
cp android/app/build/outputs/apk/release/app-release.apk "$apk"
if [[ $debug_signing == 0 ]]; then
  # Fail loudly rather than hand out an APK that won't install over the previous one.
  build_tools="$(ls "$ANDROID_HOME/build-tools" | sort -t. -k1,1n -k2,2n -k3,3n | tail -1)"
  certs="$("$ANDROID_HOME/build-tools/$build_tools/apksigner" verify --print-certs "$apk" 2>&1 || true)"
  [[ "$certs" == *'CN=Lite Social'* ]] || fail "The APK isn't signed with the release key:"$'\n'"$certs"
fi
printf '\033[32mDone: %s\033[0m\n' "$apk"
