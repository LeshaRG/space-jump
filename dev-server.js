/**
 * dev-server.js — локальный сервер для разработки. Без зависимостей.
 *
 *   node dev-server.js            (или start.bat)
 *
 * Что делает:
 *   • отдаёт игру (ES-модули с file:// не работают);
 *   • вместо /sdk.js отдаёт sdk-mock.js — мок Yandex Games SDK, который
 *     пишет в консоль каждый вызов (init, LoadingAPI.ready, GameplayAPI...);
 *   • при старте и при любом изменении PNG в папках с артом пересобирает
 *     атлас (python tools/build_sprites.py);
 *   • после пересборки или правки кода сам перезагружает вкладку браузера;
 *   • слушает все сетевые интерфейсы и печатает адрес для телефона в той же
 *     сети — живая перезагрузка работает и на телефоне.
 */
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = __dirname;
// Порт: node dev-server.js --port 5173, или переменная PORT (так делает start.bat)
const argPort = process.argv.includes("--port") ? Number(process.argv[process.argv.indexOf("--port") + 1]) : 0;
const PORT = argPort || Number(process.env.PORT) || 5174;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".webp": "image/webp",
  ".svg":  "image/svg+xml",
  ".mp3":  "audio/mpeg",
  ".ogg":  "audio/ogg",
  ".wav":  "audio/wav",
  ".m4a":  "audio/mp4",
  ".ico":  "image/x-icon",
};

/* ─── Живая перезагрузка (только для локальной разработки) ─── */

const clients = new Set();
const LIVE_RELOAD = `
<script>
  (function () {
    var es = new EventSource("/__reload");
    es.onmessage = function () { location.reload(); };
  })();
</script>`;

function reloadBrowsers(reason) {
  console.log(`  ↻ перезагрузка: ${reason}`);
  for (const res of clients) res.write("data: reload\n\n");
}

/* ─── Сборка спрайтов ─── */

let building = false;
let buildAgain = false;

function buildSprites(then) {
  if (building) { buildAgain = true; return; }
  building = true;
  const py = process.platform === "win32" ? "python" : "python3";
  const proc = spawn(py, [path.join("tools", "build_sprites.py")], {
    cwd: ROOT, env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
  proc.stdout.on("data", d => process.stdout.write("  [спрайты] " + d.toString().replace(/\n(?=.)/g, "\n  [спрайты] ")));
  proc.stderr.on("data", d => process.stderr.write("  [спрайты] " + d));
  proc.on("error", () => {
    console.warn("  [спрайты] Python не найден — играем на уже собранном атласе.");
    building = false;
  });
  proc.on("close", code => {
    building = false;
    if (buildAgain) { buildAgain = false; return buildSprites(then); }
    if (code === 0) then?.();
  });
}

/* ─── Наблюдение за файлами ─── */

// store/ — промо-материалы (скриншоты, видео), rustore/ — Android-версия (www, Gradle):
// их запись не должна перезагружать игру
const IGNORE = /(^|[\\/])(node_modules|\.git|\.claude|assets[\\/]art|build|store|rustore)([\\/]|$)/;
let timer = null;
let pending = { art: false, code: false };
const mtimes = new Map();
const STARTED = Date.now();

/** Windows присылает события и на простое чтение файла — реагируем только на реальную запись. */
function reallyChanged(file) {
  let mtime = -1;
  try { mtime = fs.statSync(path.join(ROOT, file)).mtimeMs; } catch {}
  const known = mtimes.has(file);
  const same = mtimes.get(file) === mtime;
  mtimes.set(file, mtime);
  if (same) return false;
  // Первое событие по файлу, который не менялся с запуска сервера, — это чтение
  return known || mtime < 0 || mtime >= STARTED;
}

function onChange(file) {
  if (!file || IGNORE.test(file) || !reallyChanged(file)) return;
  const ext = path.extname(file).toLowerCase();
  const sound = [".mp3", ".ogg", ".wav", ".m4a"].includes(ext);
  // Новый звук тоже требует пересборки: список звуков лежит в манифесте.
  // JSON в art/ — это anchors.json скинов, тоже графика
  if (ext === ".png" || sound || file.endsWith("art.config.json") || (ext === ".json" && /^art[\\/]/.test(file))) pending.art = true;
  else if ([".js", ".html", ".css", ".json"].includes(ext)) pending.code = true;
  else return;

  clearTimeout(timer);
  timer = setTimeout(() => {
    const { art, code } = pending;
    pending = { art: false, code: false };
    if (art) buildSprites(() => reloadBrowsers("графика"));
    else if (code) reloadBrowsers(path.basename(file));
  }, 350);
}

try {
  fs.watch(ROOT, { recursive: true }, (event, file) => onChange(file));
} catch (e) {
  console.warn("  Не удалось включить наблюдение за файлами:", e.message);
}

/* ─── HTTP ─── */

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";

  if (urlPath === "/__reload") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
    res.write("retry: 1000\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  // На Яндекс Играх /sdk.js отдаёт платформа; локально — мок
  if (urlPath === "/sdk.js") {
    res.writeHead(200, { "Content-Type": MIME[".js"], "Cache-Control": "no-store" });
    res.end(fs.readFileSync(path.join(ROOT, "sdk-mock.js")));
    return;
  }

  const filePath = path.join(ROOT, path.normalize(urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404: " + urlPath);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream", "Cache-Control": "no-store" });
    if (ext === ".html") data = Buffer.from(data.toString("utf8").replace("</body>", LIVE_RELOAD + "\n</body>"));
    res.end(data);
  });
});

server.on("error", err => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n  Порт ${PORT} занят — уже запущен этот или другой сервер (например, Jetpack Canyon).`);
    console.error(`  Закройте его или поменяйте PORT в start.bat.\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

/**
 * IPv4-адреса компьютера для входа с других устройств. Сначала обычная
 * локальная сеть (Wi-Fi, Ethernet), потом VPN вроде Tailscale; виртуальные
 * адаптеры (Hyper-V, WSL, VirtualBox) — телефону они недоступны.
 */
function lanAddresses() {
  const list = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.internal || !(a.family === "IPv4" || a.family === 4)) continue;
      if (a.address.startsWith("169.254.")) continue;                       // адрес без DHCP
      if (/vEthernet|VirtualBox|VMware|Hyper-V|WSL|Docker/i.test(name)) continue;
      const vpn = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a.address)   // 100.64/10 — Tailscale и др.
        || /tailscale|zerotier|hamachi|radmin|vpn|wireguard/i.test(name);
      list.push({ name, address: a.address, vpn });
    }
  }
  return list.sort((a, b) => a.vpn - b.vpn);
}

buildSprites(() => {});
// Без явного хоста Node слушает все интерфейсы (IPv4 и IPv6) — нужно для телефона
server.listen(PORT, () => {
  const lan = lanAddresses();
  const line = (label, host) => console.log(`  ${label.padEnd(24)} http://${host}:${PORT}`);
  console.log(`\n  Space Jump — локальный тест\n`);
  line("На этом компьютере:", "localhost");
  for (const a of lan) line(a.vpn ? `Через VPN (${a.name}):` : "С телефона:", a.address);
  if (!lan.length) console.log("  Сеть не найдена — с телефона не зайти, только с этого компьютера.");
  console.log(`
  Телефон не открывает страницу?
    • телефон должен быть в той же сети, что и компьютер (не в гостевом Wi-Fi);
    • брандмауэр Windows должен пропускать Node.js: в окне «Разрешить доступ»
      отметьте ОБЕ галочки — «Частные» и «Общественные» сети.

  Картинки в GG/, platformAnim1/ и art/ пересобираются сами — просто сохраните PNG.
  Закрыть сервер: Ctrl+C
`);
});
