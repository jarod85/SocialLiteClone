<#
.SYNOPSIS
  Publishes the built APK as a GitHub Release, so phones running Lite Social
  get it as an in-app update (Start screen and Settings -> App updates).

.DESCRIPTION
  1. Reads the version from app.json and finds release\LiteSocial-<version>.apk
     (build it first with scripts\build-android.ps1).
  2. Checks the APK is signed with your release key (only those install as updates).
  3. Creates the release "v<version>" on the commit you're on, which must be pushed.
  4. Uploads the APK to it.

  GitHub access: the GITHUB_TOKEN environment variable if set, otherwise the
  GitHub login Git already uses for this repository (Git Credential Manager).
  The token is only sent to api.github.com and uploads.github.com.

.PARAMETER Notes
  Release notes. The first line shows on the phone's update card.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\publish-release.ps1 -Notes "YouTube: faster feed"
#>
param(
  [string]$Notes = '',
  [string]$Repository = 'jarod85/SocialLiteClone',
  [string]$AndroidHome = $(if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { "$env:LOCALAPPDATA\Android\Sdk" }),
  [string]$JavaHome = $(if ($env:JAVA_HOME) { $env:JAVA_HOME } else { (Get-ChildItem "$env:LOCALAPPDATA\Programs" -Directory -Filter 'jdk-17*' -ErrorAction SilentlyContinue | Select-Object -First 1).FullName })
)

$ErrorActionPreference = 'Stop'
if (-not $JavaHome -or -not (Test-Path "$JavaHome\bin\java.exe")) { throw 'JDK 17 not found (apksigner needs it). Set JAVA_HOME or pass -JavaHome.' }
$env:JAVA_HOME = $JavaHome
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
  $version = (Get-Content app.json -Raw | ConvertFrom-Json).expo.version
  $tag = "v$version"
  $apk = "release\LiteSocial-$version.apk"
  if (-not (Test-Path $apk)) { throw "$apk not found. Build it first: scripts\build-android.ps1" }

  Write-Host "1/4 Checking $apk..." -ForegroundColor Cyan
  $apksigner = Get-ChildItem "$AndroidHome\build-tools" -Directory | Sort-Object Name -Descending |
    ForEach-Object { "$($_.FullName)\apksigner.bat" } | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $apksigner) { throw "apksigner not found under $AndroidHome\build-tools" }
  $certs = & $apksigner verify --print-certs $apk 2>&1 | Out-String
  if ($certs -notmatch 'CN=Lite Social') { throw "The APK isn't signed with the release key, so it wouldn't install as an update:`n$certs" }

  $commit = (git rev-parse HEAD).Trim()
  git fetch --quiet origin
  $pushed = git branch -r --contains $commit
  if (-not $pushed) { throw "Commit $commit isn't on GitHub yet. Push it first (git push)." }

  Write-Host '2/4 Getting GitHub access...' -ForegroundColor Cyan
  $token = $env:GITHUB_TOKEN
  if (-not $token) {
    $answer = "protocol=https`nhost=github.com`n`n" | git credential fill 2>$null
    $token = ($answer | Where-Object { $_ -like 'password=*' } | Select-Object -First 1) -replace '^password=', ''
  }
  if (-not $token) { throw 'No GitHub access. Set GITHUB_TOKEN (a token with Contents: read and write on this repository).' }
  $headers = @{
    Authorization = "Bearer $token"
    Accept = 'application/vnd.github+json'
    'X-GitHub-Api-Version' = '2022-11-28'
    'User-Agent' = 'lite-social-publish'
  }

  try {
    Invoke-RestMethod -Headers $headers -Uri "https://api.github.com/repos/$Repository/releases/tags/$tag" | Out-Null
    throw "Release $tag already exists. Bump version and android.versionCode in app.json, rebuild, then publish."
  } catch [System.Net.WebException] {
    if ($_.Exception.Response.StatusCode.value__ -ne 404) { throw }
  }

  Write-Host "3/4 Creating release $tag..." -ForegroundColor Cyan
  $body = @{
    tag_name = $tag
    target_commitish = $commit
    name = "Lite Social $version"
    body = $(if ($Notes) { $Notes } else { "Lite Social $version" })
    draft = $false
    prerelease = $false
    make_latest = 'true'
  } | ConvertTo-Json
  $release = Invoke-RestMethod -Method Post -Headers $headers -ContentType 'application/json; charset=utf-8' `
    -Uri "https://api.github.com/repos/$Repository/releases" -Body ([Text.Encoding]::UTF8.GetBytes($body))

  Write-Host '4/4 Uploading the APK (this takes a minute)...' -ForegroundColor Cyan
  $name = Split-Path $apk -Leaf
  $asset = Invoke-RestMethod -Method Post -Headers $headers -ContentType 'application/vnd.android.package-archive' `
    -Uri "https://uploads.github.com/repos/$Repository/releases/$($release.id)/assets?name=$name" -InFile $apk -TimeoutSec 1800
  Write-Host "Published: $($release.html_url)" -ForegroundColor Green
  Write-Host "APK: $($asset.browser_download_url)" -ForegroundColor Green
} finally {
  Pop-Location
}
