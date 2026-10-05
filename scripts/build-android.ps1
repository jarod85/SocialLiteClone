<#
.SYNOPSIS
  Builds an installable Lite Social APK on Windows, without Android Studio.

.DESCRIPTION
  1. Generates the native android/ project from app.json (Expo prebuild).
  2. Runs Gradle's release build.
  3. Copies the APK to release\LiteSocial-<version>.apk.

  React Native's native (C++) build breaks on paths with spaces and on
  Windows' 260-character path limit, so the build runs from a temporary drive
  letter mapped to the project with `subst` (no admin rights; removed afterwards).

  The APK is signed with the debug key from Expo's template. That's fine for
  installing on your own phone, and updates install over each other because the
  key never changes. For the Play Store you'd need your own upload key (or EAS Build).

.PARAMETER Architectures
  CPU architectures to build. arm64-v8a covers every current phone (incl. Galaxy S24 FE)
  and builds ~4x faster than all four. Use "armeabi-v7a,arm64-v8a,x86,x86_64" for emulators too.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\build-android.ps1
#>
param(
  [string]$Architectures = 'arm64-v8a',
  [string]$JavaHome = $(if ($env:JAVA_HOME) { $env:JAVA_HOME } else { (Get-ChildItem "$env:LOCALAPPDATA\Programs" -Directory -Filter 'jdk-17*' -ErrorAction SilentlyContinue | Select-Object -First 1).FullName }),
  [string]$AndroidHome = $(if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { "$env:LOCALAPPDATA\Android\Sdk" })
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot

if (-not $JavaHome -or -not (Test-Path "$JavaHome\bin\java.exe")) { throw "JDK 17 not found. Set JAVA_HOME or pass -JavaHome." }
if (-not (Test-Path "$AndroidHome\platform-tools")) { throw "Android SDK not found at $AndroidHome. Set ANDROID_HOME or pass -AndroidHome." }
$env:JAVA_HOME = $JavaHome
$env:ANDROID_HOME = $AndroidHome
$env:Path = "$JavaHome\bin;$env:Path"

# Find a free drive letter for the short path.
$used = (Get-PSDrive -PSProvider FileSystem).Name
$letter = [char[]]'ZYXWVUTSRQPONMLK' | Where-Object { $used -notcontains [string]$_ } | Select-Object -First 1
if (-not $letter) { throw 'No free drive letter for subst.' }
$drive = "${letter}:"
subst $drive $projectRoot
try {
  Push-Location "$drive\"
  Write-Host "Building from $drive (mapped to $projectRoot)" -ForegroundColor Cyan

  Write-Host '1/3 Generating the native Android project...' -ForegroundColor Cyan
  npx expo prebuild --platform android --clean --no-install
  if ($LASTEXITCODE -ne 0) { throw 'expo prebuild failed' }
  Set-Content -Path android\local.properties -Value "sdk.dir=$($AndroidHome -replace '\\', '/')" -Encoding ascii

  Write-Host "2/3 Building the release APK ($Architectures)..." -ForegroundColor Cyan
  Push-Location android
  try {
    .\gradlew.bat assembleRelease "-PreactNativeArchitectures=$Architectures" --no-daemon
    if ($LASTEXITCODE -ne 0) { throw 'Gradle build failed' }
  } finally {
    Pop-Location
  }

  Write-Host '3/3 Copying the APK...' -ForegroundColor Cyan
  $version = (Get-Content app.json -Raw | ConvertFrom-Json).expo.version
  New-Item -ItemType Directory -Force release | Out-Null
  $apk = "release\LiteSocial-$version.apk"
  Copy-Item android\app\build\outputs\apk\release\app-release.apk $apk -Force
  Write-Host "Done: $projectRoot\$apk" -ForegroundColor Green
} finally {
  Pop-Location
  subst $drive /d
}
