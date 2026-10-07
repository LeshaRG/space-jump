/**
 * build-web.mjs — веб-часть Android-версии: игра из корня репозитория → rustore/www.
 *
 *   1. Пересобирает атлас спрайтов (tools/build_sprites.py) — как build.ps1 для Яндекса.
 *   2. Собирает ES-модули игры в один скрипт (esbuild) и подменяет два модуля:
 *        src/ysdk.js    → rustore/src/platform.js  (реклама, «Назад», рекорды…)
 *        src/testing.js → rustore/src/testing.js   (без тестовых кнопок)
 *      Остальной код общий с версией для Яндекса и не меняется.
 *   3. index.html: без SDK Яндекса, с бандлом и android.css.
 *   4. Копирует Phaser, ассеты и политику конфиденциальности.
 *   5. Проверяет, что на месте всё, на что ссылается манифест.
 *
 * Запуск:  node scripts/build-web.mjs        (из папки rustore)
 * Дальше:  npx cap sync android              (копирует www в Android-проект)
 */
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RU   = path.resolve(HERE, "..");    // rustore/
const ROOT = path.resolve(RU, "..");      // игра
const OUT  = path.join(RU, "www");
const CFG  = JSON.parse(fs.readFileSync(path.join(RU, "app.config.json"), "utf8"));

function fail(msg) {
  console.error(`ОШИБКА: ${msg}`);
  process.exit(1);
}

const key = p => path.resolve(p).toLowerCase();

/* ── 1. Спрайты ─────────────────────────────── */

console.log("Собираю спрайты...");
const py = spawnSync("python", [path.join(ROOT, "tools", "build_sprites.py")], {
  cwd: ROOT, stdio: "inherit", env: { ...process.env, PYTHONIOENCODING: "utf-8" },
});
if (py.error) console.warn("  Python не найден — беру уже собранные атласы из assets/art");
else if (py.status !== 0) fail("tools/build_sprites.py завершился с ошибкой");

/* ── 2. Бандл с подменой платформы ──────────── */

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const SWAP = new Map([
  [key(path.join(ROOT, "src", "ysdk.js")),    path.join(RU, "src", "platform.js")],
  [key(path.join(ROOT, "src", "testing.js")), path.join(RU, "src", "testing.js")],
]);
const swapped = new Set();

const platformSwap = {
  name: "platform-swap",
  setup(b) {
    b.onResolve({ filter: /(^|[\\/])(ysdk|testing)\.js$/ }, args => {
      if (!args.resolveDir) return undefined;
      const k = key(path.resolve(args.resolveDir, args.path));
      const to = SWAP.get(k);
      if (!to) return undefined;
      swapped.add(k);
      return { path: to };
    });
  },
};

console.log("Собираю game.bundle.js...");
await build({
  entryPoints: [path.join(ROOT, "game.js")],
  outfile:     path.join(OUT, "game.bundle.js"),
  bundle:      true,
  format:      "iife",
  target:      "es2017",
  minify:      true,
  logLevel:    "warning",
  plugins:     [platformSwap],
  define: {
    __APP_VERSION__: JSON.stringify(CFG.versionName),
    __PRIVACY_URL__: JSON.stringify(CFG.privacyUrl),
  },
}).catch(() => fail("esbuild не собрал бандл"));

if (swapped.size !== SWAP.size) {
  fail("подмена модулей не сработала (src/ysdk.js или src/testing.js не импортируется по старому пути) — в Android-сборку попал бы код Яндекса");
}
const bundle = fs.readFileSync(path.join(OUT, "game.bundle.js"), "utf8");
if (/YaGames|ysdkPromise/.test(bundle)) fail("в бандле остались обращения к SDK Яндекса");

/* ── 3. index.html ──────────────────────────── */

let html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const sdkBlock = /\s*<!-- Yandex Games SDK -->\s*<script src="\/sdk\.js"><\/script>\s*<script>[\s\S]*?<\/script>/;
if (!sdkBlock.test(html)) fail("в index.html не найден блок SDK Яндекса — сборка рассчитана на него");
html = html.replace(sdkBlock, "");

const moduleTag = '<script type="module" src="game.js"></script>';
if (!html.includes(moduleTag)) fail("в index.html не найден тег модуля game.js");
html = html.replace(moduleTag, '<script src="game.bundle.js"></script>');
html = html.replace("</head>", '  <link rel="stylesheet" href="android.css" />\n</head>');

if (/sdk\.js|YaGames/.test(html)) fail("в index.html остался SDK Яндекса");
if (/<(script|link)[^>]+(src|href)="(https?:)?\/\//.test(html)) fail("в index.html внешний скрипт или стиль — в приложении всё должно быть локальным");
fs.writeFileSync(path.join(OUT, "index.html"), html);

/* ── 4. Файлы ───────────────────────────────── */

const copy = (from, to) => {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
};
const copyMatching = (dir, re, dst) => {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (f.isFile() && re.test(f.name)) { copy(path.join(dir, f.name), path.join(dst, f.name)); n++; }
  }
  return n;
};

copy(path.join(ROOT, "phaser.min.js"), path.join(OUT, "phaser.min.js"));
copy(path.join(RU, "src", "android.css"), path.join(OUT, "android.css"));
copy(path.join(RU, "privacy", "index.html"), path.join(OUT, "privacy.html"));

const art = path.join(ROOT, "assets", "art");
copyMatching(art, /^(atlas\d*\.png|atlas\.json|sprites\.json)$/, path.join(OUT, "assets", "art"));
copyMatching(path.join(art, "skins"), /^[a-z0-9_]+\.(png|json)$/, path.join(OUT, "assets", "art", "skins"));
copyMatching(path.join(ROOT, "assets", "sounds"), /\.(mp3|ogg|wav|m4a)$/i, path.join(OUT, "assets", "sounds"));

/* ── 5. Проверки ────────────────────────────── */

const readJson = p => JSON.parse(fs.readFileSync(p, "utf8"));
const need = (rel, what) => { if (!fs.existsSync(path.join(OUT, rel))) fail(`${what}: нет файла ${rel}`); };

const manifest = readJson(path.join(OUT, "assets", "art", "sprites.json"));
const atlas = readJson(path.join(OUT, "assets", "art", "atlas.json"));
for (const tex of atlas.textures ?? []) need(path.join("assets", "art", tex.image), "атлас");
for (const urls of Object.values(manifest.sounds ?? {})) for (const u of urls) need(u, "звук");
for (const [id, s] of Object.entries(manifest.skins ?? {})) {
  if (s.icon) need(s.icon, `скин ${id}`);
  if (s.atlas) {
    need(s.atlas.json, `скин ${id}`);
    for (const tex of readJson(path.join(OUT, s.atlas.json)).textures ?? []) need(path.join(s.atlas.path, tex.image), `скин ${id}`);
  }
}

const bad = [];
const walk = d => {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p);
    else if (/[^!-~]/.test(f.name)) bad.push(p);
  }
};
walk(OUT);
if (bad.length) fail(`недопустимые имена файлов (пробелы или кириллица):\n  ${bad.join("\n  ")}`);

const size = d => fs.readdirSync(d, { withFileTypes: true })
  .reduce((s, f) => s + (f.isDirectory() ? size(path.join(d, f.name)) : fs.statSync(path.join(d, f.name)).size), 0);
console.log(`www готов: ${(size(OUT) / 1048576).toFixed(2)} МБ, версия ${CFG.versionName} (${CFG.versionCode})`);

if (fs.readFileSync(path.join(RU, "privacy", "index.html"), "utf8").includes("ВАШ_EMAIL")) {
  console.warn("ВНИМАНИЕ: в privacy/index.html не указана почта для связи (ВАШ_EMAIL) — заполните до публикации");
}
