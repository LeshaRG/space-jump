# build.ps1 — собирает Space Jump для Android (RuStore): подписанный APK.
#
# Что делает:
#   1. Веб-часть: игра из корня репозитория -> rustore/www (scripts/build-web.mjs).
#   2. Копирует её в Android-проект (npx cap sync android).
#   3. Собирает APK через Gradle и подписывает ключом из rustore/keystore/.
#   4. Проверяет подпись и кладёт файл в rustore/dist/.
#
# Запуск (из любой папки):
#   powershell -ExecutionPolicy Bypass -File rustore\build.ps1          # релиз для RuStore
#   powershell -ExecutionPolicy Bypass -File rustore\build.ps1 -Debug   # отладочная сборка
#
# Нужны: Node.js 22+, JDK 21 и Android SDK (платформа 36). Если они лежат в
# E:\Android (jdk-21, sdk) — скрипт найдёт их сам; иначе — JAVA_HOME и
# ANDROID_HOME (или Android Studio со стандартными путями).

param([switch]$Debug)

$ErrorActionPreference = "Stop"
$ru   = $PSScriptRoot
$root = Split-Path $ru -Parent
$cfg  = Get-Content (Join-Path $ru "app.config.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$cap  = Get-Content (Join-Path $ru "capacitor.config.json") -Raw -Encoding UTF8 | ConvertFrom-Json

function Fail($msg) { Write-Host "ОШИБКА: $msg" -ForegroundColor Red; exit 1 }
function Step($msg) { Write-Host ""; Write-Host "== $msg" -ForegroundColor Cyan }

if ($cfg.appId -ne $cap.appId) { Fail "appId в app.config.json ($($cfg.appId)) и capacitor.config.json ($($cap.appId)) должны совпадать" }

# ── Инструменты ──────────────────────────────
function FirstDir($paths) { foreach ($p in $paths) { if ($p -and (Test-Path $p)) { return (Resolve-Path $p).Path } } return $null }

$jdk = FirstDir @("E:\Android\jdk-21", $env:JAVA_HOME, "C:\Program Files\Android\Android Studio\jbr")
if (-not $jdk) { Fail "не найден JDK 21: поставьте Android Studio или укажите JAVA_HOME" }
$sdk = FirstDir @("E:\Android\sdk", $env:ANDROID_HOME, $env:ANDROID_SDK_ROOT, "$env:LOCALAPPDATA\Android\Sdk")
if (-not $sdk) { Fail "не найден Android SDK: поставьте Android Studio или укажите ANDROID_HOME" }
$env:JAVA_HOME = $jdk
$env:ANDROID_HOME = $sdk
$env:Path = "$jdk\bin;$env:Path"
# Кеш Gradle (сотни мегабайт) — рядом с SDK, а не на системном диске
if ((Split-Path $sdk -Parent) -and -not $env:GRADLE_USER_HOME) {
  $env:GRADLE_USER_HOME = Join-Path (Split-Path $sdk -Parent) "gradle-home"
}
Write-Host "JDK: $jdk"
Write-Host "SDK: $sdk"

# Android-проекту нужен путь к SDK
$sdkDir = $sdk -replace '\\', '\\'
[System.IO.File]::WriteAllText((Join-Path $ru "android\local.properties"), "sdk.dir=$sdkDir`n", (New-Object System.Text.UTF8Encoding $false))

Push-Location $ru
try {
  # ── 1. Зависимости и веб-часть ────────────────
  if (-not (Test-Path (Join-Path $ru "node_modules\@capacitor\android"))) {
    Step "npm install"
    & npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { Fail "npm install завершился с ошибкой" }
  }

  Step "Веб-часть игры"
  & node scripts/build-web.mjs
  if ($LASTEXITCODE -ne 0) { Fail "сборка веб-части не удалась" }

  # ── 2. Копия в Android-проект ─────────────────
  Step "cap sync android"
  & npx cap sync android
  if ($LASTEXITCODE -ne 0) { Fail "cap sync завершился с ошибкой" }

  # ── 3. Gradle ─────────────────────────────────
  $keyProps = Join-Path $ru "keystore\keystore.properties"
  if (-not $Debug -and -not (Test-Path $keyProps)) {
    Fail "нет ключа подписи rustore\keystore\keystore.properties — без него RuStore APK не примет (см. rustore\README.md)"
  }
  $task = if ($Debug) { "assembleDebug" } else { "assembleRelease" }
  Step "Gradle $task"
  Push-Location (Join-Path $ru "android")
  try {
    # --no-daemon: без него Gradle оставляет фоновый процесс, который держит
    # вывод команды открытым, — сборка заканчивается, а окно или скрипт «висит»
    & .\gradlew.bat $task --console=plain --no-daemon
    if ($LASTEXITCODE -ne 0) { Fail "Gradle не собрал APK" }
  } finally { Pop-Location }

  # ── 4. Проверка и результат ───────────────────
  $variant = if ($Debug) { "debug" } else { "release" }
  $apk = Join-Path $ru "android\app\build\outputs\apk\$variant\app-$variant.apk"
  if (-not (Test-Path $apk)) { Fail "не найден $apk" }

  $bt = Get-ChildItem (Join-Path $sdk "build-tools") -Directory | Sort-Object { [version]($_.Name -replace '-.*$', '') } | Select-Object -Last 1
  $apksigner = Join-Path $bt.FullName "apksigner.bat"
  $aapt = Join-Path $bt.FullName "aapt2.exe"
  Step "Проверка подписи"
  & $apksigner verify --print-certs $apk | Select-String "Signer #1 certificate (DN|SHA-256)"
  if ($LASTEXITCODE -ne 0) { Fail "APK не подписан или подпись повреждена" }
  & $aapt dump badging $apk | Select-String "^package:|^minSdkVersion|^targetSdkVersion|^application-label:"

  $dist = Join-Path $ru "dist"
  New-Item -ItemType Directory -Force $dist | Out-Null
  $suffix = if ($Debug) { "-debug" } else { "" }
  $out = Join-Path $dist "space-jump-$($cfg.versionName)$suffix.apk"
  Copy-Item $apk $out -Force

  $ads = if ($cfg.ads.interstitial -or $cfg.ads.rewarded) { "блоки из app.config.json" }
         elseif ($Debug) { "демо-блоки Яндекса (тестовая реклама)" }
         else { "ВЫКЛЮЧЕНА — блоки не указаны, кнопки за рекламу скрыты" }
  $mb = [math]::Round((Get-Item $out).Length / 1MB, 1)
  Write-Host ""
  Write-Host "Готово: $out ($mb МБ)" -ForegroundColor Green
  Write-Host "Версия $($cfg.versionName) (код $($cfg.versionCode)), пакет $($cfg.appId)"
  Write-Host "Реклама: $ads"
  if ((Get-Content (Join-Path $ru "privacy\index.html") -Raw -Encoding UTF8) -match "ВАШ_EMAIL") {
    Write-Host "Не забудьте: почта для связи в rustore\privacy\index.html (ВАШ_EMAIL)" -ForegroundColor Yellow
  }
} finally { Pop-Location }
