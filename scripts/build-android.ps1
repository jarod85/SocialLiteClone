<#
.SYNOPSIS
  Builds an installable Lite Social APK on Windows, without Android Studio.

.DESCRIPTION
  1. Mirrors the project's source into a short build folder with no spaces.
     React Native's native build can't cope with spaces, and mapping a drive
     letter with subst doesn't work either: Node resolves it back to the real
     path and Gradle then sees two different roots. The folder must also be
     short: even with plugins/withCMakeObjectPathMax.js shortening CMake's
     object paths, the deepest ones are about 220 characters plus the folder,
     and Windows (without the admin-only long-path setting) stops at 260.
  2. Installs dependencies there when package-lock.json changed.
  3. Generates the native android/ project from app.json (Expo prebuild).
  4. Runs Gradle's release build.
  5. Copies the APK to release\LiteSocial-<version>.apk in this project.

  The APK is signed with the debug key from Expo's template. That's fine for
  installing on your own phone, and updates install over each other because the
  key never changes. For the Play Store you'd need your own upload key (or EAS Build).

.PARAMETER Architectures
  CPU architectures to build. arm64-v8a covers every current phone (incl. Galaxy S24 FE)
  and builds ~4x faster than all four. Use "arm64-v8a,x86_64" to include emulators.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\build-android.ps1
#>
param(
  [string]$Architectures = 'arm64-v8a',
  [string]$BuildDir = "$env:USERPROFILE\lsb",
  [string]$JavaHome = $(if ($env:JAVA_HOME) { $env:JAVA_HOME } else { (Get-ChildItem "$env:LOCALAPPDATA\Programs" -Directory -Filter 'jdk-17*' -ErrorAction SilentlyContinue | Select-Object -First 1).FullName }),
  [string]$AndroidHome = $(if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { "$env:LOCALAPPDATA\Android\Sdk" })
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot

if (-not $JavaHome -or -not (Test-Path "$JavaHome\bin\java.exe")) { throw "JDK 17 not found. Set JAVA_HOME or pass -JavaHome." }
if (-not (Test-Path "$AndroidHome\platform-tools")) { throw "Android SDK not found at $AndroidHome. Set ANDROID_HOME or pass -AndroidHome." }
if ($BuildDir -match '\s') { throw "The build folder must not contain spaces: $BuildDir" }
if ($BuildDir.Length -gt 25) { throw "The build folder path must be 25 characters or less (Windows path limit): $BuildDir" }
$env:JAVA_HOME = $JavaHome
$env:ANDROID_HOME = $AndroidHome
$env:Path = "$JavaHome\bin;$env:Path"

Write-Host "1/5 Copying the project to $BuildDir..." -ForegroundColor Cyan
# /MIR mirrors and deletes stale files; excluded folders are neither copied nor deleted.
robocopy $projectRoot $BuildDir /MIR /NFL /NDL /NJH /NJS /NP /XD node_modules android ios release .expo .git dist | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Copying the project failed (robocopy exit $LASTEXITCODE)" }

Push-Location $BuildDir
try {
  $lockHash = (Get-FileHash package-lock.json).Hash
  $stamp = 'node_modules\.lite-social-lock-hash'
  if (-not (Test-Path $stamp) -or (Get-Content $stamp) -ne $lockHash) {
    Write-Host '2/5 Installing dependencies...' -ForegroundColor Cyan
    npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
    Set-Content $stamp $lockHash
  } else {
    Write-Host '2/5 Dependencies unchanged.' -ForegroundColor Cyan
  }

  Write-Host '3/5 Generating the native Android project...' -ForegroundColor Cyan
  $env:CI = '1'
  npx expo prebuild --platform android --clean --no-install
  if ($LASTEXITCODE -ne 0) { throw 'expo prebuild failed' }
  Set-Content -Path android\local.properties -Value "sdk.dir=$($AndroidHome -replace '\\', '/')" -Encoding ascii

  Write-Host "4/5 Building the release APK ($Architectures)..." -ForegroundColor Cyan
  Push-Location android
  try {
    .\gradlew.bat assembleRelease "-PreactNativeArchitectures=$Architectures" --no-daemon
    if ($LASTEXITCODE -ne 0) { throw 'Gradle build failed' }
  } finally {
    Pop-Location
  }

  Write-Host '5/5 Copying the APK...' -ForegroundColor Cyan
  $version = (Get-Content app.json -Raw | ConvertFrom-Json).expo.version
  New-Item -ItemType Directory -Force "$projectRoot\release" | Out-Null
  $apk = "$projectRoot\release\LiteSocial-$version.apk"
  Copy-Item android\app\build\outputs\apk\release\app-release.apk $apk -Force
  Write-Host "Done: $apk" -ForegroundColor Green
} finally {
  Pop-Location
}
