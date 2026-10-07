/**
 * record.mjs — запись настоящего забега для промо-видео.
 *
 *   node store/tools/record.mjs [ru|en]
 *
 * Chrome без окна (cdp.mjs) показывает игру в 1080×1920, бот играет
 * (bot.js), а поток кадров идёт через Page.startScreencast — с HTML-
 * интерфейсом, как на экране телефона. Кадры с метками времени и отметки
 * моментов (джетпак, телепорт, чёрная дыра...) — в store/_rec/<язык>/.
 * Ролики из них собирает make_video.py.
 *
 * Забег честный: метеорит может сбить героя, и тот упадёт. Тогда дубль
 * переснимается (до 5 попыток).
 */
import fs from "node:fs";
import path from "node:path";
import { launch, STORE, sleep } from "./cdp.mjs";

const lang = process.argv[2] === "en" ? "en" : "ru";
const OUT = path.join(STORE, "_rec", lang);
const FR = path.join(OUT, "frames");

const SAVE = {
  best: 1500, bestHeight: 120, wallet: 1240, tutorial: true, runs: 12, rev: 99999,
  boosters: { jetpack: 3, teleport: 3, aim: 3, breaker: 3 },
  skins: ["white", "black", "red", "daisy", "biker", "demon"], skin: "white",
  hints: { hot: true, pay: true }, muted: true, musicOff: true,
};

const cap = await launch();
let frames = [];
let marks = {};
let recording = false;
let n = 0;

cap.page.on("Page.screencastFrame", p => {
  cap.page.send("Page.screencastFrameAck", { sessionId: p.sessionId }).catch(() => {});
  if (!recording) return;
  const f = `f${String(++n).padStart(5, "0")}.jpg`;
  fs.writeFileSync(path.join(FR, f), Buffer.from(p.data, "base64"));
  frames.push({ f, t: p.metadata.timestamp });
});

const mark = name => { marks[name] = Date.now() / 1000; };

/** Шаг сценария; если забег оборвался — дубль не удался. */
async function step(expr) {
  await cap.page.eval(expr);
  if ((await cap.page.eval(`__bot.S().mode`)) !== "play") throw new Error("герой упал");
}

async function take() {
  await cap.open({ width: 540, height: 960, dpr: 2, mobile: true }, SAVE, lang);
  await step(`__bot.start()`);
  await step(`__bot.climbTo(900)`);                     // разгон: жар копится с первых прыжков
  await cap.page.eval(`__bot.S().bubble.hide()`);
  await cap.page.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1080, maxHeight: 1920, everyNthFrame: 1 });
  recording = true;
  await sleep(300);

  mark("start");
  // Рогатка: видно, как оттягиваешь и куда полетишь
  mark("aim");
  await step(`__bot.jump({ hold: 650 })`);
  await step(`__bot.jump({ hold: 420, kind: "hard" })`);
  await step(`__bot.jump({ hold: 380 })`);
  await step(`__bot.jump({ hold: 350 })`);
  mark("rico");
  await step(`__bot.jump({ hold: 420, prefer: "rico" })`);
  await step(`__bot.jump({ hold: 330, kind: "hard" })`);

  // Джетпак: очки капают прямо в полёте
  mark("jet");
  await step(`(async () => { const s = __bot.S(); await __bot.until(() => s.hero.state === "stand"); s.useJetpack();
    await __bot.until(() => s.hero.state === "stand", 6000); })()`);
  mark("hot");
  for (let i = 0; i < 4; i++) await step(`__bot.jump({ hold: 300 })`);

  // Метеорит: предупреждение, пунктир — и он пролетает, пока мы прыгаем
  mark("meteor");
  await step(`(async () => { const s = __bot.S(); s.world._warnMeteor(s.hero.b, s.worldCtx); })()`);
  await step(`__bot.jump({ hold: 500 })`);
  await step(`__bot.jump({ hold: 350 })`);

  // Телепорт: подсветка платформ и перенос на самую высокую
  mark("tele");
  await step(`(async () => { const s = __bot.S(); await __bot.until(() => s.hero.state === "stand"); await __bot.sleep(150);
    s.onBoosterButton("teleport"); await __bot.sleep(900);
    const t = s.targeting?.rings.map(r => r.p).filter(p => p.alive).sort((a, b) => a.top - b.top)[0];
    if (t) s.teleportTo(t); await __bot.until(() => s.hero.state === "stand", 3000); })()`);
  await step(`__bot.jump({ hold: 330 })`);
  await step(`__bot.jump({ hold: 330, kind: "hard" })`);

  // Чёрная дыра: прицел гнётся к ней — облетаем
  mark("hole");
  await step(`(async () => { const s = __bot.S(); const b = s.hero.b; await __bot.until(() => s.hero.state === "stand");
    const v = s.view; if (!s.world.holes.some(h => h.alive && h.y > v.top + 120 && h.y < b.y - 60))
      s.world.addHole(b.x < 270 ? b.x + 150 : b.x - 150, b.y - 250); })()`);
  await step(`__bot.jump({ hold: 900 })`);
  for (let i = 0; i < 4; i++) await step(`__bot.jump({ hold: 330 })`);
  mark("end");
  await sleep(400);
}

try {
  for (let attempt = 1; attempt <= 5; attempt++) {
    fs.rmSync(OUT, { recursive: true, force: true });
    fs.mkdirSync(FR, { recursive: true });
    frames = [];
    marks = {};
    n = 0;
    try {
      await take();
      await cap.page.send("Page.stopScreencast");
      recording = false;
      await sleep(300);
      const dur = frames[frames.length - 1].t - frames[0].t;
      if (dur > 30) throw new Error(`дубль вышел длинным: ${dur.toFixed(1)} с`);
      fs.writeFileSync(path.join(OUT, "meta.json"), JSON.stringify({ lang, frames, marks }, null, 1));
      console.log(`${lang}: кадров ${frames.length}, ${dur.toFixed(1)} с, ~${(frames.length / dur).toFixed(0)} к/с (дубль ${attempt})`);
      break;
    } catch (e) {
      recording = false;
      await cap.page.send("Page.stopScreencast").catch(() => {});
      console.log(`${lang}: дубль ${attempt} не удался — ${e.message}`);
    }
  }
  if (cap.logs.length) console.log("Ошибки на странице:", cap.logs);
} finally {
  await cap.close();
}
