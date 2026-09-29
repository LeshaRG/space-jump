# build.ps1 — собирает архив для загрузки в консоль разработчика Яндекс Игр.
#
# Что делает:
#   1. Пересобирает атлас спрайтов (python tools/build_sprites.py).
#   2. Собирает ES-модули игры в один классический скрипт game.bundle.js
#      (esbuild, ES2017): один файл вместо двадцати, без каскада запросов
#      и без зависимости от поддержки import в старых браузерах.
#   3. Подменяет в index.html тег модуля на обычный <script>.
#   4. Кладёт только то, что грузит игра, и проверяет требования платформы.
#
# Требования, которые здесь соблюдаются:
#   • index.html в корне архива (п. 1.22);
#   • нет пробелов и кириллицы в именах файлов (п. 1.22);
#   • распакованный размер до 100 МБ (п. 1.21);
#   • никаких абсолютных ссылок на S3 Яндекса, SDK — как /sdk.js (п. 1.7).
#
# Запуск:  powershell -ExecutionPolicy Bypass -File build.ps1

$ErrorActionPreference = "Stop"
$root  = $PSScriptRoot
$stage = Join-Path $env:TEMP "space_jump_build"
$out   = Join-Path $root "space-jump.zip"

function Fail($msg) { Write-Host "ОШИБКА: $msg" -ForegroundColor Red; exit 1 }

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null

# ── 1. Спрайты ──────────────────────────────────
Write-Host "Собираю спрайты..."
$env:PYTHONIOENCODING = "utf-8"
& python (Join-Path $root "tools\build_sprites.py")
if ($LASTEXITCODE -ne 0) { Fail "tools/build_sprites.py завершился с ошибкой (нужен Python с Pillow и numpy)" }

# ── 2. Бандл ────────────────────────────────────
Write-Host "Собираю game.bundle.js..."
$bundle = Join-Path $stage "game.bundle.js"
& npx --yes esbuild (Join-Path $root "game.js") --bundle --format=iife --target=es2017 --minify --log-level=warning "--outfile=$bundle"
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $bundle)) {
  Fail "esbuild не собрал бандл. Нужен Node.js и доступ к npm для первой загрузки esbuild."
}

# ── 3. index.html: модуль -> обычный скрипт ─────
$html = Get-Content (Join-Path $root "index.html") -Raw -Encoding UTF8
if ($html -notmatch '<script type="module" src="game.js"></script>') {
  Fail "в index.html не найден тег модуля game.js — сборка рассчитана на него"
}
$html = $html -replace '<script type="module" src="game.js"></script>', '<script src="game.bundle.js"></script>'
[System.IO.File]::WriteAllText((Join-Path $stage "index.html"), $html, (New-Object System.Text.UTF8Encoding $false))

Copy-Item (Join-Path $root "phaser.min.js") $stage

# ── 4. Ассеты ───────────────────────────────────
$artSrc = Join-Path $root "assets\art"
$artDst = Join-Path $stage "assets\art"
New-Item -ItemType Directory -Path $artDst -Force | Out-Null
Get-ChildItem $artSrc -File | Where-Object { $_.Name -match '^(atlas\d*\.png|atlas\.json|sprites\.json)$' } |
  ForEach-Object { Copy-Item $_.FullName $artDst }

# Скины: атлас каждого скина и картинки для магазина (игра грузит только надетый)
$skinSrc = Join-Path $artSrc "skins"
if (Test-Path $skinSrc) {
  $skinDst = Join-Path $artDst "skins"
  New-Item -ItemType Directory -Path $skinDst -Force | Out-Null
  Get-ChildItem $skinSrc -File | Where-Object { $_.Name -match '^[a-z0-9_]+\.(png|json)$' } |
    ForEach-Object { Copy-Item $_.FullName $skinDst }
}

$sndSrc = Join-Path $root "assets\sounds"
if (Test-Path $sndSrc) {
  $sounds = Get-ChildItem $sndSrc -File | Where-Object { $_.Extension -match '^\.(mp3|ogg|wav|m4a)$' }
  if ($sounds) {
    $sndDst = Join-Path $stage "assets\sounds"
    New-Item -ItemType Directory -Path $sndDst -Force | Out-Null
    $sounds | ForEach-Object { Copy-Item $_.FullName $sndDst }
  }
}

# ── 5. Проверки ─────────────────────────────────

# 5a. Всё, на что ссылается манифест, должно лежать в архиве
$manifest = Get-Content (Join-Path $artDst "sprites.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$atlas    = Get-Content (Join-Path $artDst "atlas.json") -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($tex in $atlas.textures) {
  if (-not (Test-Path (Join-Path $artDst $tex.image))) { Fail "атлас ссылается на $($tex.image), но файла нет" }
}
if ($manifest.sounds) {
  foreach ($p in $manifest.sounds.PSObject.Properties) {
    foreach ($url in $p.Value) {
      if (-not (Test-Path (Join-Path $stage $url))) { Fail "манифест ссылается на $url, но файла нет" }
    }
  }
}
if ($manifest.skins) {
  foreach ($p in $manifest.skins.PSObject.Properties) {
    $s = $p.Value
    if ($s.icon -and -not (Test-Path (Join-Path $stage $s.icon))) { Fail "скин $($p.Name): нет картинки $($s.icon)" }
    if ($s.atlas) {
      $sj = Join-Path $stage $s.atlas.json
      if (-not (Test-Path $sj)) { Fail "скин $($p.Name): нет атласа $($s.atlas.json)" }
      $sa = Get-Content $sj -Raw -Encoding UTF8 | ConvertFrom-Json
      foreach ($tex in $sa.textures) {
        if (-not (Test-Path (Join-Path (Join-Path $stage $s.atlas.path) $tex.image))) { Fail "скин $($p.Name): атлас ссылается на $($tex.image), но файла нет" }
      }
    }
  }
}

# 5b. Никаких внешних скриптов и ссылок на S3 Яндекса
if ($html -match 'games\.s3\.yandex\.net|<script[^>]+src="https?://') {
  Fail "в index.html абсолютная ссылка на S3 Яндекса или внешний скрипт"
}
if ($html -notmatch '<script src="/sdk.js"></script>') { Fail "в index.html нет подключения /sdk.js" }
if ($html -notmatch 'YaGames\.init\(\)')               { Fail "в index.html нет вызова YaGames.init()" }

# 5c. Имена файлов: только печатный ASCII без пробелов
$bad = Get-ChildItem $stage -Recurse | Where-Object { $_.Name -match '[^!-~]' }
if ($bad) {
  $bad | ForEach-Object { Write-Host "  $($_.FullName)" }
  Fail "недопустимые имена файлов (пробелы или кириллица)"
}

# 5d. Размер
$sizeMb = [math]::Round(((Get-ChildItem $stage -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), 2)
if ($sizeMb -gt 100) { Fail "размер в распакованном виде $sizeMb МБ — больше лимита 100 МБ" }

# ── 6. Архив ────────────────────────────────────
# НЕ Compress-Archive: в Windows PowerShell 5.1 он пишет пути с обратным
# слешем (assets\art\atlas0.png). Сервер Яндекса распаковывает такую запись
# в один файл в корне — ассеты не находятся, игра не стартует, а модерация
# отвечает «SDK не встроено или встроено некорректно».
if (Test-Path $out) { Remove-Item $out -Force }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$fs  = [System.IO.File]::Open($out, [System.IO.FileMode]::Create)
$zip = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
Get-ChildItem $stage -Recurse -File | ForEach-Object {
  $rel = $_.FullName.Substring($stage.Length + 1).Replace('\', '/')
  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
    $zip, $_.FullName, $rel, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
}
$zip.Dispose()
$fs.Dispose()

# Контроль: имена записей и сырые байты — читатели zip любят молча
# нормализовать разделители
$check   = [System.IO.Compression.ZipFile]::OpenRead($out)
$entries = $check.Entries | ForEach-Object { $_.FullName }
$check.Dispose()
$raw = [System.Text.Encoding]::ASCII.GetString([System.IO.File]::ReadAllBytes($out))
if ($entries | Where-Object { $_.Contains('\') }) { Fail "в архиве есть пути с обратным слешем" }
if ($raw.Contains('assets\'))                      { Fail "в сырых байтах архива обратный слеш" }
if ($entries -notcontains "index.html")            { Fail "index.html не в корне архива" }

Write-Host ""
Write-Host "Готово: $out" -ForegroundColor Green
Write-Host "Файлов: $($entries.Count), распакованный размер: $sizeMb МБ"
Write-Host "Содержимое:"
$entries | Sort-Object | ForEach-Object { Write-Host "  $_" }
