/**
 * cdp.mjs — игра в Chrome без окна (headless) под управлением протокола
 * DevTools. Без зависимостей: Node 22 (встроенный WebSocket) + установленный
 * Chrome или Edge.
 *
 * Зачем не снимок canvas, как в FlyMount: у Space Jump счёт, жар, монеты и
 * бустеры — HTML поверх canvas. Chrome снимает страницу целиком, как её
 * видит игрок, в точном разрешении и без рамок браузера.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const STORE = path.join(ROOT, "store");

const BROWSERS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
];

export const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitHttp(url, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url);
      if (r.ok) return r;
    } catch {}
    await sleep(200);
  }
  throw new Error(`не отвечает ${url}`);
}

class Client {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.id) {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) p.rej(new Error(`${p.method}: ${m.error.message}`));
        else p.res(m.result);
      } else if (m.method) {
        for (const fn of this.handlers.get(m.method) ?? []) fn(m.params);
      }
    };
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { res, rej, method }));
  }

  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
    return () => this.handlers.set(method, this.handlers.get(method).filter(f => f !== fn));
  }

  /** Выполнить JS на странице и дождаться результата (промисы тоже). */
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    }
    return r.result.value;
  }
}

/**
 * Поднять dev-сервер игры и Chrome без окна.
 * @returns {{ page: Client, open(viewport, save?), shot(file), close() }}
 */
export async function launch({ port = 5190, cdpPort = 9333 } = {}) {
  const server = spawn(process.execPath, [path.join(ROOT, "dev-server.js"), "--port", String(port)], {
    cwd: ROOT, stdio: "ignore",
  });
  await waitHttp(`http://localhost:${port}/`);

  const exe = BROWSERS.find(p => fs.existsSync(p));
  if (!exe) throw new Error("не найден Chrome или Edge");
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "sj-capture-"));
  const browser = spawn(exe, [
    "--headless=new", `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--mute-audio",
    "--autoplay-policy=no-user-gesture-required", "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
    "--ignore-gpu-blocklist", "--window-size=1920,1080", "about:blank",
  ], { stdio: "ignore" });

  await waitHttp(`http://127.0.0.1:${cdpPort}/json/version`);
  const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
  const target = targets.find(t => t.type === "page");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const page = new Client(ws);
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  const logs = [];
  page.on("Runtime.exceptionThrown", p => logs.push("EXCEPTION " + (p.exceptionDetails.exception?.description ?? p.exceptionDetails.text)));
  page.on("Runtime.consoleAPICalled", p => {
    if (p.type === "error") logs.push("console.error " + p.args.map(a => a.value ?? a.description).join(" "));
  });

  const base = `http://localhost:${port}/`;

  return {
    page,
    logs,

    /**
     * Открыть игру с нужным экраном и сохранением.
     * @param vp { width, height, dpr, mobile }  CSS-пиксели и плотность
     * @param save объект сохранения (как в localStorage) или null — новый игрок
     */
    async open(vp, save = null, lang = "ru") {
      await page.send("Emulation.setDeviceMetricsOverride", {
        width: vp.width, height: vp.height, deviceScaleFactor: vp.dpr, mobile: !!vp.mobile,
        screenWidth: vp.width, screenHeight: vp.height,
      });
      await page.send("Emulation.setTouchEmulationEnabled", vp.mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
      await page.send("Page.navigate", { url: base + "?capture=1" });
      await sleep(300);
      await page.eval(`localStorage.clear(); ${save ? `localStorage.setItem("space_jump_save_v1", ${JSON.stringify(JSON.stringify(save))});` : ""} true`);
      await page.send("Page.navigate", { url: `${base}?lang=${lang}` });
      const ok = await page.eval(`(async () => {
        for (let i = 0; i < 300; i++) {
          const s = window.game?.scene?.getScene("GameScene");
          if (s && s.sys.isActive() && s.mode === "menu" && !document.getElementById("preloader")) return true;
          await new Promise(r => setTimeout(r, 100));
        }
        return false;
      })()`);
      if (!ok) throw new Error("игра не дошла до меню");
      await page.eval(fs.readFileSync(path.join(STORE, "tools", "bot.js"), "utf8"));
      await sleep(400);
    },

    /** Снимок страницы целиком (с HTML-интерфейсом) в PNG. */
    async shot(file) {
      const r = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, fromSurface: true });
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(r.data, "base64"));
      return file;
    },

    async close() {
      try { await page.send("Browser.close"); } catch {}
      browser.kill();
      server.kill();
      await sleep(300);
      try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
    },
  };
}
