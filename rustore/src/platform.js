/**
 * platform.js — платформа Android-версии (RuStore). Подменяет src/ysdk.js.
 *
 * scripts/build-web.mjs собирает игру из исходников в корне репозитория и
 * при этом направляет импорт ./ysdk.js сюда. Интерфейс тот же, что у YSDK,
 * поэтому код игры не меняется (и версия для Яндекса тоже):
 *   init, loadingReady, setGameplay, onPause / onResume / onAccount,
 *   showFullscreen, showRewarded, loadData / saveData,
 *   submitScore, getEntries, getMyRank, getName, openAuthDialog,
 *   поля available, authorized, lang, deviceType.
 *
 * Чем Android-версия отличается от версии для Яндекс Игр:
 *   • реклама — Yandex Mobile Ads SDK через нативный плагин YandexAds
 *     (android/app/src/main/java/.../YandexAdsPlugin.java). Если рекламные
 *     блоки не указаны в app.config.json, кнопки «за рекламу» скрыты;
 *   • входа и облачных сохранений нет — прогресс хранится в приложении;
 *   • «Рекорды» — лучшие забеги на этом телефоне;
 *   • кнопка «Назад»: пауза в забеге, закрыть окно, в меню — свернуть игру;
 *   • вибрация на ударах и падениях, экран не гаснет во время забега;
 *   • в меню — ссылка на политику конфиденциальности (обязательна в RuStore).
 *
 * Меню и рекорды дополняются через DOM (MutationObserver): общий код экранов
 * (src/ui/screens.js) о платформе ничего не знает. Если там поменяются
 * классы .screen.menu, .screen.leaders, .lb-rank, .lb-table, .btn.ad или
 * data-act="back|close|resume|menu", — проверьте этот файл.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";
import { App }   from "@capacitor/app";
import GameState from "../../src/GameState.js";
import Audio     from "../../src/audio.js";
import { t }     from "../../src/i18n.js";
import { icon }  from "../../src/icons.js";
import { getItem, setItem } from "../../src/storage.js";

/* global __APP_VERSION__ */
const VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";

const NATIVE    = Capacitor.isNativePlatform();
const YandexAds = registerPlugin("YandexAds");
const GameHost  = registerPlugin("GameHost");

/** В браузере (проверка сборки на компьютере) рекламу можно изобразить: ?fakeads */
const FAKE_ADS = !NATIVE && /[?&]fakeads\b/.test(location.search);

const RUNS_KEY = "space_jump_android_runs_v1";
const RUNS_MAX = 10;

/** Строки, которых нет в общем словаре игры. */
const TEXT = {
  ru: {
    privacy: "Политика конфиденциальности",
    player:  "Космонавт",
    runs:    "Лучшие забеги на этом телефоне",
    noRuns:  "Сыграйте забег — здесь появятся ваши лучшие результаты",
    version: v => `Версия ${v}`,
    noPage:  "Не удалось открыть текст политики. Он есть на странице:",
  },
  en: {
    privacy: "Privacy policy",
    player:  "Astronaut",
    runs:    "Your best runs on this device",
    noRuns:  "Play a run — your best results will show up here",
    version: v => `Version ${v}`,
    noPage:  "Could not open the policy text. It is available at:",
  },
};

/** Звук → тактильный отклик. Системная настройка «Вибрация при касании» соблюдается. */
const HAPTIC = {
  land:    "tick",      // приземление
  bounce:  "tick",      // рикошет от стены
  hit:     "heavy",     // метеорит или ракета
  fall:    "heavy",     // упал
  swallow: "heavy",     // чёрная дыра
  hotUp:   "confirm",   // жар растёт
  record:  "confirm",   // новый рекорд
};

function withTimeout(promise, ms, fallback) {
  return Promise.race([promise, new Promise(res => setTimeout(() => res(fallback), ms))]);
}

function detectLang() {
  const nav = (navigator.language || "ru").slice(0, 2).toLowerCase();
  return ["ru", "uk", "be", "kk"].includes(nav) ? "ru" : "en";
}

const YSDK = {
  ready:      false,
  available:  false,   // нет аккаунтов и облака: игра не показывает «Войти» и подсказку о входе
  sdk:        null,
  player:     null,
  authorized: false,
  lang:       "ru",
  deviceType: "mobile",

  ads:        false,   // реклама настроена и SDK доступен
  _gameplayOn: false,
  _handlers:  { pause: [], resume: [], account: [] },

  /* ═══════ Инициализация ═══════ */

  async init() {
    if (this._initPromise) return this._initPromise;
    this._initPromise = this._init();
    return this._initPromise;
  },

  async _init() {
    this.lang = detectLang();
    document.documentElement.classList.add("android");

    hookAudio();
    hookRecords();
    watchScreens();
    if (NATIVE) bindApp();
    else window.__androidBack = onBack;   // проверка «Назад» в браузере

    // Плагин отвечает сразу: настроены ли блоки. SDK грузит рекламу в фоне.
    if (NATIVE) {
      const res = await withTimeout(YandexAds.init().catch(e => {
        console.warn("[platform] YandexAds.init:", e?.message ?? e);
        return null;
      }), 5000, null);
      this.ads = !!res?.enabled;
      if (res?.demo) console.warn("[platform] реклама: демо-блоки Яндекса (отладочная сборка)");
    } else {
      this.ads = FAKE_ADS;
    }
    document.documentElement.classList.toggle("no-ads", !this.ads);
    console.log("[platform] android", { lang: this.lang, native: NATIVE, ads: this.ads, version: VERSION });

    this.ready = true;
    return this;
  },

  getName() {
    return tx("player");
  },

  async openAuthDialog() {
    return false;
  },

  /* ═══════ Загрузка и игровой процесс ═══════ */

  loadingReady() {},

  /** Забег идёт — экран не гаснет; в меню и на паузе — как обычно. */
  setGameplay(on) {
    if (on === this._gameplayOn) return;
    this._gameplayOn = on;
    if (NATIVE) GameHost.keepScreenOn({ on }).catch(() => {});
  },

  _emit(name) {
    for (const fn of this._handlers[name]) {
      try { fn(); } catch (e) { console.warn(`[platform] ${name} handler:`, e); }
    }
  },

  onPause(fn)   { this._handlers.pause.push(fn); },
  onResume(fn)  { this._handlers.resume.push(fn); },
  onAccount(fn) { this._handlers.account.push(fn); },

  /* ═══════ Реклама ═══════ */

  /** Полноэкранная реклама. @returns {Promise<boolean>} была ли показана */
  async showFullscreen() {
    if (!this.ads) return false;
    if (FAKE_ADS) return fakeAd("interstitial");
    const res = await withTimeout(YandexAds.showInterstitial().catch(e => {
      console.warn("[platform] interstitial:", e?.message ?? e);
      return null;
    }), 60000, null);
    return !!res?.shown;
  },

  /** Реклама за вознаграждение. @returns {Promise<boolean>} true — награду выдать */
  async showRewarded() {
    if (!this.ads) return false;
    if (FAKE_ADS) return fakeAd("rewarded");
    const res = await withTimeout(YandexAds.showRewarded().catch(e => {
      console.warn("[platform] rewarded:", e?.message ?? e);
      return null;
    }), 120000, null);
    return !!res?.rewarded;
  },

  /* ═══════ Сохранения: только в приложении (localStorage WebView) ═══════ */

  async loadData()  { return null; },
  async saveData()  { return false; },

  /* ═══════ Рекорды: лучшие забеги на этом устройстве ═══════ */

  /** Забеги записывает обёртка над GameState.recordScore (hookRecords). */
  async submitScore() { return false; },

  async getEntries(board, limit = 10) {
    const { runs, last } = loadRuns();
    return runs.slice(0, limit).map((r, i) => ({
      rank:  i + 1,
      name:  runLabel(r),
      score: r.s,
      isMe:  r.id === last,     // подсвечен последний забег
    }));
  },

  async getMyRank() { return null; },
};

export default YSDK;

function tx(key, ...args) {
  const v = (TEXT[YSDK.lang] ?? TEXT.en)[key];
  return typeof v === "function" ? v(...args) : v;
}

/* ═══════════════════════════════════════
   ЖИЗНЕННЫЙ ЦИКЛ И КНОПКА «НАЗАД»
═══════════════════════════════════════ */

function bindApp() {
  // Свернули игру, звонок, поверх открылась реклама — игра встаёт на паузу.
  // visibilitychange WebView тоже присылает, но событие приложения надёжнее.
  App.addListener("pause",  () => YSDK._emit("pause"));
  App.addListener("resume", () => YSDK._emit("resume"));
  App.addListener("backButton", onBack);
}

function scene() {
  return window.game?.scene?.getScene?.("GameScene") ?? null;
}

/**
 * «Назад» ведёт себя как кнопки на экране:
 * политика → закрыть; забег → пауза; пауза → продолжить;
 * магазин, рекорды, окно бустера → назад; конец забега → в меню;
 * главное меню → свернуть игру (как «Домой», прогресс уже сохранён).
 */
function onBack() {
  if (privacyEl) { closePrivacy(); return; }
  const s = scene();
  if (s?.adBusy) return;

  const screen = document.querySelector("body > .screen");
  if (screen) {
    if (screen.classList.contains("menu")) {
      GameState.flush?.();
      App.minimizeApp().catch(() => {});
      return;
    }
    for (const act of ["back", "close", "resume", "menu"]) {
      const btn = screen.querySelector(`[data-act="${act}"]`);
      if (btn && !btn.disabled) { btn.click(); return; }
    }
    return;
  }
  if (s?.mode === "play") s.openPause();
}

/* ═══════════════════════════════════════
   ВИБРАЦИЯ
═══════════════════════════════════════ */

function hookAudio() {
  if (!NATIVE || Audio._hapticHooked) return;
  Audio._hapticHooked = true;
  const play = Audio.play.bind(Audio);
  Audio.play = name => {
    const kind = HAPTIC[name];
    if (kind) GameHost.haptic({ kind }).catch(() => {});
    play(name);
  };
}

/* ═══════════════════════════════════════
   ЛИЧНЫЕ РЕКОРДЫ
═══════════════════════════════════════ */

function loadRuns() {
  try {
    const d = JSON.parse(getItem(RUNS_KEY) || "null");
    if (d && Array.isArray(d.runs)) return { runs: d.runs.filter(r => r && r.s > 0), last: d.last ?? null };
  } catch {}
  return { runs: [], last: null };
}

function saveRuns(runs, last) {
  setItem(RUNS_KEY, JSON.stringify({ runs, last }));
}

/** «3 окт. · 245 м» */
function runLabel(r) {
  let date = "";
  try {
    date = new Date(r.t).toLocaleDateString(YSDK.lang === "ru" ? "ru-RU" : "en-US", { day: "numeric", month: "short" });
  } catch {}
  return date ? `${date} · ${t("meters", r.h | 0)}` : t("meters", r.h | 0);
}

/**
 * Каждый итог забега проходит через GameState.recordScore (конец забега и
 * досрочный выход в меню). Забег после «продолжить за рекламу» — тот же
 * объект scene.run: его запись обновляется, а не дублируется.
 */
function hookRecords() {
  if (GameState._runsHooked) return;
  GameState._runsHooked = true;
  const orig = GameState.recordScore;
  let lastRun = null;

  GameState.recordScore = function (score, heightM) {
    const record = orig.call(this, score, heightM);
    try {
      const s = score | 0;
      const h = heightM | 0;
      if (s > 0) {
        const run = scene()?.run ?? null;
        const { runs, last } = loadRuns();
        // Если запись этого забега уже выпала из топа, она просто заводится заново
        const same = run && run === lastRun ? runs.find(r => r.id === last) : null;
        let id;
        if (same) {
          same.s = Math.max(same.s, s);
          same.h = Math.max(same.h, h);
          same.t = Date.now();
          id = same.id;
        } else {
          id = Math.max(Date.now(), ...runs.map(r => r.id + 1));
          runs.push({ id, s, h, t: Date.now() });
        }
        lastRun = run;
        runs.sort((a, b) => b.s - a.s || a.t - b.t);
        saveRuns(runs.slice(0, RUNS_MAX), id);
      }
    } catch (e) {
      console.warn("[platform] runs:", e.message);
    }
    return record;
  };
}

/* ═══════════════════════════════════════
   ДОПОЛНЕНИЯ ЭКРАНОВ
═══════════════════════════════════════ */

function watchScreens() {
  if (watchScreens.on) return;
  watchScreens.on = true;
  const run = () => new MutationObserver(muts => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (!(n instanceof HTMLElement) || !n.classList.contains("screen")) continue;
        if (n.classList.contains("menu")) addPrivacyLink(n);
        else if (n.classList.contains("leaders")) patchLeaders(n);
      }
    }
  }).observe(document.body, { childList: true });
  if (document.body) run();
  else document.addEventListener("DOMContentLoaded", run, { once: true });
}

function addPrivacyLink(screen) {
  const card = screen.querySelector(".card");
  if (!card || card.querySelector(".pv-link")) return;
  const a = document.createElement("button");
  a.type = "button";
  a.className = "pv-link";
  a.textContent = tx("privacy");
  a.addEventListener("click", e => {
    e.stopPropagation();
    Audio.play("click");
    openPrivacy();
  });
  card.appendChild(a);
}

/** Подзаголовок «на этом телефоне» и свой текст для пустой таблицы. */
function patchLeaders(screen) {
  const rank = screen.querySelector(".lb-rank");
  if (rank && !rank.textContent) rank.textContent = tx("runs");
  const table = screen.querySelector(".lb-table");
  if (!table) return;
  const fix = () => {
    if (!table.querySelector(".lb-row")) return false;   // ещё «Загрузка...»
    const empty = table.querySelector(".lb-empty");
    if (empty) {
      empty.textContent = tx("noRuns");
      if (!(GameState.best > 0)) table.querySelector(".lb-row.me")?.remove();
    }
    return true;
  };
  if (fix()) return;
  const mo = new MutationObserver(() => { if (fix()) mo.disconnect(); });
  mo.observe(table, { childList: true });
  setTimeout(() => mo.disconnect(), 10000);
}

/* ═══════════════════════════════════════
   ПОЛИТИКА КОНФИДЕНЦИАЛЬНОСТИ — текст из privacy.html внутри приложения
═══════════════════════════════════════ */

let privacyEl = null;

function openUrl(url) {
  if (NATIVE) GameHost.openUrl({ url }).catch(() => {});
  else window.open(url, "_blank", "noopener");
}

async function openPrivacy() {
  if (privacyEl) return;
  const root = document.createElement("div");
  root.className = "screen privacy";
  root.innerHTML = `
    <div class="card">
      <div class="policy">${t("loading")}</div>
      <div class="pv-version">${tx("version", VERSION)}</div>
      <button class="btn ghost" type="button" data-pv="back">${icon("back")}${t("back")}</button>
    </div>`;
  root.addEventListener("click", e => {
    const link = e.target.closest("a[href]");
    if (link) {
      e.preventDefault();
      if (/^https?:|^mailto:/.test(link.getAttribute("href"))) openUrl(link.href);
      return;
    }
    if (e.target.closest('[data-pv="back"]')) {
      Audio.play("click");
      closePrivacy();
    }
  });
  document.body.appendChild(root);
  privacyEl = root;

  const box = root.querySelector(".policy");
  try {
    const html = await (await fetch("privacy.html", { cache: "no-store" })).text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const part = doc.querySelector(`[data-lang="${YSDK.lang}"]`) ?? doc.querySelector("[data-lang]");
    if (!part) throw new Error("нет раздела политики");
    if (privacyEl === root) box.innerHTML = part.innerHTML;
  } catch (e) {
    console.warn("[platform] privacy:", e.message);
    if (privacyEl === root) {
      box.innerHTML = `<p>${tx("noPage")}</p><p><a href="${PRIVACY_URL}">${PRIVACY_URL}</a></p>`;
    }
  }
}

function closePrivacy() {
  privacyEl?.remove();
  privacyEl = null;
}

/* global __PRIVACY_URL__ */
const PRIVACY_URL = typeof __PRIVACY_URL__ === "string" ? __PRIVACY_URL__ : "";

/* ═══════════════════════════════════════
   ИМИТАЦИЯ РЕКЛАМЫ В БРАУЗЕРЕ (?fakeads)
═══════════════════════════════════════ */

function fakeAd(kind) {
  console.log(`[platform] fake ${kind} ad`);
  return new Promise(res => setTimeout(() => res(true), 700));
}
