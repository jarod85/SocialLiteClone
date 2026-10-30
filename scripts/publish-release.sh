#!/usr/bin/env bash
#
# Publishes the built APK as a GitHub Release, so phones running Lite Social get
# it as an in-app update (Start screen and Settings -> App updates). The
# counterpart of scripts/publish-release.ps1 for macOS and Linux.
#
#   1. Reads the version from app.json and finds release/LiteSocial-<version>.apk
#      (build it first with scripts/build-android.sh).
#   2. Checks the APK is signed with your release key (only those install as updates).
#   3. Creates the release "v<version>" on the commit you're on, which must be pushed.
#   4. Uploads the APK to it. If that fails, run again: it reuses the release.
#
# GitHub access: the GITHUB_TOKEN environment variable if set, otherwise the
# GitHub login Git already uses for this repository (on macOS, the keychain).
# The token is only sent to api.github.com and uploads.github.com.
#
# Usage: scripts/publish-release.sh [--notes "What changed"] [--repository owner/name]
#   The first line of the notes shows on the phone's update card.

set -euo pipefail

notes=''
repository='jarod85/SocialLiteClone'
while [[ $# -gt 0 ]]; do
  case "$1" in
    --notes) notes="$2"; shift 2 ;;
    --repository) repository="$2"; shift 2 ;;
    -h|--help) sed -n '2,19p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
done

fail() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
step() { printf '\033[36m%s\033[0m\n' "$*"; }

if [[ -z "${JAVA_HOME:-}" && -x /usr/libexec/java_home ]]; then
  JAVA_HOME="$(/usr/libexec/java_home -v 17 2>/dev/null || true)"
fi
if [[ -z "${ANDROID_HOME:-}" ]]; then
  if [[ "$(uname)" == Darwin ]]; then ANDROID_HOME="$HOME/Library/Android/sdk"; else ANDROID_HOME="$HOME/Android/Sdk"; fi
fi
[[ -n "${JAVA_HOME:-}" && -x "$JAVA_HOME/bin/java" ]] || fail 'JDK 17 not found (apksigner needs it). Set JAVA_HOME.'
export JAVA_HOME

cd "$(dirname "${BASH_SOURCE[0]}")/.."
version="$(node -p "require('./app.json').expo.version")"
tag="v$version"
apk="release/LiteSocial-$version.apk"
[[ -f "$apk" ]] || fail "$apk not found. Build it first: scripts/build-android.sh"

step "1/4 Checking $apk..."
build_tools="$(ls "$ANDROID_HOME/build-tools" 2>/dev/null | sort -t. -k1,1n -k2,2n -k3,3n | tail -1)"
apksigner="$ANDROID_HOME/build-tools/$build_tools/apksigner"
[[ -n "$build_tools" && -x "$apksigner" ]] || fail "apksigner not found under $ANDROID_HOME/build-tools"
certs="$("$apksigner" verify --print-certs "$apk" 2>&1 || true)"
[[ "$certs" == *'CN=Lite Social'* ]] || fail "The APK isn't signed with the release key, so it wouldn't install as an update:"$'\n'"$certs"

commit="$(git rev-parse HEAD)"
git fetch --quiet origin
[[ -n "$(git branch -r --contains "$commit")" ]] || fail "Commit $commit isn't on GitHub yet. Push it first (git push)."

step '2/4 Getting GitHub access...'
token="${GITHUB_TOKEN:-}"
if [[ -z "$token" ]]; then
  token="$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | sed -n 's/^password=//p' | head -1 || true)"
fi
[[ -n "$token" ]] || fail 'No GitHub access. Set GITHUB_TOKEN (a token with Contents: read and write on this repository).'
# The token goes in a header file only this user can read, not on curl's command line (visible to other processes).
headers="$(mktemp)"
response="$(mktemp)"
trap 'rm -f "$headers" "$response"' EXIT
chmod 600 "$headers"
printf 'Authorization: Bearer %s\nAccept: application/vnd.github+json\nX-GitHub-Api-Version: 2022-11-28\nUser-Agent: lite-social-publish\n' "$token" > "$headers"

# Evaluates a JavaScript expression on GitHub's last answer, parsed as `r`. (Not require(): the temp file has no
# .json extension, so require() would read it as JavaScript.)
json() { RESPONSE="$response" node -p "const r = JSON.parse(require('fs').readFileSync(process.env.RESPONSE, 'utf8')); $1"; }

name="$(basename "$apk")"
status="$(curl -sS -o "$response" -w '%{http_code}' -H "@$headers" "https://api.github.com/repos/$repository/releases/tags/$tag")"
if [[ "$status" == 200 ]]; then
  # A run that stopped before the upload leaves the release without its APK: finish that one.
  [[ "$(NAME="$name" json 'r.assets.some((a) => a.name === process.env.NAME)')" == false ]] ||
    fail "Release $tag already exists. Bump version and android.versionCode in app.json, rebuild, then publish."
  step "3/4 Release $tag exists without its APK, adding it there..."
else
  [[ "$status" == 404 ]] || fail "GitHub answered $status: $(cat "$response")"
  step "3/4 Creating release $tag..."
  body="$(TAG="$tag" COMMIT="$commit" VERSION="$version" NOTES="$notes" node -e '
    const { TAG, COMMIT, VERSION, NOTES } = process.env;
    console.log(JSON.stringify({ tag_name: TAG, target_commitish: COMMIT, name: `Lite Social ${VERSION}`,
      body: NOTES || `Lite Social ${VERSION}`, draft: false, prerelease: false, make_latest: "true" }));')"
  status="$(curl -sS -o "$response" -w '%{http_code}' -X POST -H "@$headers" -H 'Content-Type: application/json; charset=utf-8' \
    --data-binary "$body" "https://api.github.com/repos/$repository/releases")"
  [[ "$status" == 201 ]] || fail "Creating the release failed ($status): $(cat "$response")"
fi
release_id="$(json 'r.id')"
release_url="$(json 'r.html_url')"

step '4/4 Uploading the APK (this takes a minute)...'
status="$(curl -sS -o "$response" -w '%{http_code}' -X POST -H "@$headers" -H 'Content-Type: application/vnd.android.package-archive' \
  --max-time 1800 --data-binary "@$apk" "https://uploads.github.com/repos/$repository/releases/$release_id/assets?name=$name")"
[[ "$status" == 201 ]] || fail "Uploading the APK failed ($status): $(cat "$response")"
printf '\033[32mPublished: %s\033[0m\n' "$release_url"
printf '\033[32mAPK: %s\033[0m\n' "$(json 'r.browser_download_url')"
