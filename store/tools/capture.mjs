/**
 * capture.mjs — снимки настоящего геймплея для карточки игры.
 *
 *   node store/tools/capture.mjs [ru|en ...] [сценарий ...]
 *
 * Поднимает dev-сервер и Chrome без окна (см. cdp.mjs), играет ботом
 * (bot.js) и снимает страницу целиком в 1080×1920 — с HTML-интерфейсом,
 * как её видит игрок на телефоне. Кадры кладёт в store/_raw/<язык>/.
 * Из них make_media.py собирает скриншоты для консоли.
 */
import path from "node:path";
import { launch, STORE, sleep } from "./cdp.mjs";

const MOBILE = { width: 540, height: 960, dpr: 2, mobile: true };   // → 1080×1920

/** Сохранение «опытного игрока»: обучение пройдено, есть бустеры и скины. */
const SAVE = {
  best: 1500, bestHeight: 120, wallet: 1240, tutorial: true, runs: 12, rev: 99999,
  boosters: { jetpack: 3, teleport: 3, aim: 3, breaker: 3 },
  skins: ["white", "black", "red", "daisy", "biker", "demon"], skin: "white",
  hints: { hot: true, pay: true }, muted: true, musicOff: true,
};

const LINES = {
  ru: { aim: "Главное — не промахнуться.", hot: "Я в огне!", jet: "Полный вперёд!", hole: "Не смотри в бездну...", tele: "Вжух!" },
  en: { aim: "Just don't miss.", hot: "I'm on fire!", jet: "Full throttle!", hole: "Don't stare into the abyss...", tele: "Whoosh!" },
};

/**
 * Сценарии: каждый ставит игру в нужный момент и возвращается перед снимком.
 * Всё на экране — настоящие объекты игры в настоящем забеге.
 */
const SCENES = {
  // 1. Рогатка: оттягиваешь — виден гаснущий вектор; жар ×2, монеты
  async aim(page, L) {
    await page.eval(`__bot.skin("white")`);
    await page.eval(`__bot.start()`);
    await page.eval(`__bot.climbTo(1500)`);
    await page.eval(`(async () => {
      const s = __bot.S();
      s.hot.level = 1; s.hot.energy = 0.6; s.hot.left = 99;
      await __bot.jump({ kind: "hard", hold: 500, release: false });
      s.bubble.say(${JSON.stringify(L.aim)});
    })()`);
    await sleep(450);
  },

  // 2. Жар ×3 и монеты ×2: голубое пламя за героем в прыжке
  async hot(page, L) {
    await page.eval(`__bot.skin("red")`);
    await page.eval(`__bot.start()`);
    await page.eval(`__bot.climbTo(2600)`);
    await page.eval(`(async () => {
      const s = __bot.S();
      s.hot.level = 2; s.hot.energy = 1; s.x2 = 47;
      const r = await __bot.jump({ hold: 200, release: false });
      __bot.release(r.p);
      await __bot.sleep(330);
      s.bubble.say(${JSON.stringify(L.hot)});
    })()`);
    await sleep(120);
  },

  // 3. Джетпак: очки капают в полёте, счётчик «+N» и искры в счёт
  async jet(page, L) {
    await page.eval(`__bot.skin("biker")`);
    await page.eval(`__bot.start()`);
    await page.eval(`__bot.climbTo(1800)`);
    await page.eval(`(async () => {
      const s = __bot.S();
      s.hot.level = 1; s.hot.energy = 0.4;
      await __bot.until(() => s.hero.state === "stand");
      s.useJetpack();
      await __bot.sleep(1150);
      s.bubble.say(${JSON.stringify(L.jet)});
    })()`);
    await sleep(250);
  },

  // 4. Чёрная дыра и метеорит: прицел гнётся к дыре, сверху предупреждение
  async hole(page, L) {
    await page.eval(`__bot.skin("daisy")`);
    await page.eval(`__bot.start()`);
    await page.eval(`__bot.climbTo(4600)`);
    await page.eval(`(async () => {
      const s = __bot.S();
      const b = s.hero.b;
      await __bot.until(() => s.hero.state === "stand");
      // Дыра в кадре? Если генератор не поставил рядом — ставим над героем, как это делает он
      const v = s.view;
      const inView = s.world.holes.some(h => h.alive && h.y > v.top + 120 && h.y < b.y - 60);
      if (!inView) s.world.addHole(b.x < 270 ? b.x + 150 : b.x - 150, b.y - 250);
      s.hot.level = 1; s.hot.energy = 0.8; s.hot.left = 99;   // окно не истечёт, пока целимся
      s.world._warnMeteor(b, s.worldCtx);
      await __bot.jump({ hold: 520, release: false });
      s.bubble.say(${JSON.stringify(L.hole)});
    })()`);
    await sleep(500);
  },

  // 5. Премиум-скин и телепорт: подсвеченные платформы, куда можно переместиться
  async tele(page, L) {
    await page.eval(`__bot.skin("demon")`);
    await page.eval(`__bot.start()`);
    await page.eval(`__bot.climbTo(3000)`);
    await page.eval(`(async () => {
      const s = __bot.S();
      s.hot.level = 2; s.hot.energy = 1; s.hot.left = 99;
      await __bot.until(() => s.hero.state === "stand");
      await __bot.sleep(300);
      s.onBoosterButton("teleport");
      s.bubble.say(${JSON.stringify(L.tele)});
    })()`);
    await sleep(700);
  },
};

const args = process.argv.slice(2);
const langs = args.filter(a => a === "ru" || a === "en");
const names = args.filter(a => SCENES[a]);
const LANGS = langs.length ? langs : ["ru", "en"];
const LIST = names.length ? names : Object.keys(SCENES);

const cap = await launch();
try {
  for (const lang of LANGS) {
    for (const name of LIST) {
      let ok = false;
      for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
        try {
          await cap.open(MOBILE, SAVE, lang);
          await SCENES[name](cap.page, LINES[lang]);
          const mode = await cap.page.eval(`__bot.S().mode`);
          if (mode !== "play") throw new Error("забег закончился раньше снимка: " + mode);
          const file = await cap.shot(path.join(STORE, "_raw", lang, `${name}.png`));
          console.log(`  ${lang}/${name}  →  ${path.relative(STORE, file)}`);
          ok = true;
        } catch (e) {
          console.log(`  ${lang}/${name}: попытка ${attempt} не удалась — ${e.message}`);
        }
      }
    }
  }
  if (cap.logs.length) console.log("Ошибки на странице:", cap.logs);
} finally {
  await cap.close();
}
