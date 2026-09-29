/**
 * ysdk.js — единая обёртка над Yandex Games SDK.
 *
 * Все обращения к платформе идут только отсюда. Если SDK недоступен
 * (локальный запуск, открытие файла напрямую) — модуль уходит в offline-режим
 * и игра продолжает работать на localStorage.
 *
 * Документация:
 *   https://yandex.ru/dev/games/doc/ru/sdk/sdk-about        подключение
 *   https://yandex.ru/dev/games/doc/ru/sdk/sdk-game-events  LoadingAPI, GameplayAPI
 *   https://yandex.ru/dev/games/doc/ru/sdk/sdk-events       game_api_pause/resume
 *   https://yandex.ru/dev/games/doc/ru/sdk/sdk-adv          реклама
 *   https://yandex.ru/dev/games/doc/ru/sdk/sdk-player       игрок и сохранения
 *   https://yandex.ru/dev/games/doc/ru/sdk/sdk-leaderboard  лидерборды
 */

/** Ни один вызов платформы не должен вешать игру навсегда. */
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label}: таймаут ${ms} мс`)), ms)),
  ]);
}

const TIMEOUT = {
  INIT:   30000,   // лоадер сам догружает основной скрипт SDK
  PLAYER: 8000,    // getPlayer / getData / setData
};

const YSDK = {
  ready:      false,   // init() завершён (успешно или в offline)
  available:  false,   // SDK реально подключен
  sdk:        null,
  player:     null,
  authorized: false,
  lang:       "ru",
  deviceType: "desktop",

  _loadingDone:    false,
  _readyRequested: false,
  _gameplayOn:     false,
  _handlers: { pause: [], resume: [], account: [] },

  /* ═══════════════════════════════════════
     ИНИЦИАЛИЗАЦИЯ
  ═══════════════════════════════════════ */

  async init() {
    if (this._initPromise) return this._initPromise;
    this._initPromise = this._init();
    return this._initPromise;
  },

  async _init() {
    try {
      // YaGames.init() вызван в index.html сразу после загрузки /sdk.js —
      // повторный вызов лоадер не принимает, здесь только ждём результат.
      let pending = window.ysdkPromise;
      if (!pending) {
        if (typeof YaGames === "undefined") throw new Error("YaGames is not defined");
        pending = YaGames.init();
      }

      this.sdk = await withTimeout(pending, TIMEOUT.INIT, "YaGames.init");
      this.available = true;

      this.lang       = this.sdk.environment?.i18n?.lang ?? "ru";
      this.deviceType = this.sdk.deviceInfo?.type ?? "desktop";

      this._bindEvents();
      await this._initPlayer();

      console.log("[YSDK] initialized", { lang: this.lang, device: this.deviceType, authorized: this.authorized });

      // Игра могла дойти до готовности раньше, чем ответил SDK
      if (this._readyRequested) this.loadingReady();
    } catch (e) {
      console.warn("[YSDK] offline mode:", e.message);
      this.available = false;
      // Без SDK язык берём у браузера — иначе англоязычный игрок увидит русский
      const nav = (navigator.language || "ru").slice(0, 2).toLowerCase();
      this.lang = nav;
    }

    this.ready = true;
    return this;
  },

  async _initPlayer() {
    try {
      // scopes: false — никаких диалогов при старте: авторизация только по кнопке (п. 1.2.1)
      this.player = await withTimeout(this.sdk.getPlayer({ scopes: false }), TIMEOUT.PLAYER, "getPlayer");
      this.authorized = typeof this.player.isAuthorized === "function"
        ? this.player.isAuthorized()
        : this.player.getMode?.() !== "lite";   // getMode устарел — только как запасной путь
    } catch (e) {
      console.warn("[YSDK] getPlayer failed:", e.message);
      this.player = null;
      this.authorized = false;
    }
  },

  /** Имя игрока (или «Гость»). */
  getName() {
    const raw = this.authorized ? (this.player?.getName?.() ?? "") : "";
    return raw.trim() || (this.lang === "ru" ? "Гость" : "Guest");
  },

  /** Диалог авторизации. @returns {Promise<boolean>} вошёл ли пользователь */
  async openAuthDialog() {
    if (!this.available) return false;
    try {
      await this.sdk.auth.openAuthDialog();
      await this._initPlayer();
      return this.authorized;
    } catch {
      return false;
    }
  },

  /* ═══════════════════════════════════════
     LOADING / GAMEPLAY API (п. 1.19.2, 1.19.3)
  ═══════════════════════════════════════ */

  /**
   * Игра загружена, экранов загрузки нет, можно играть. Вызывается один раз.
   * Если SDK ещё не ответил — запоминаем и вызываем сразу после init:
   * пропущенный ready() — самая частая причина отказа модерации.
   */
  loadingReady() {
    this._readyRequested = true;
    if (this._loadingDone) return;
    const api = this.sdk?.features?.LoadingAPI;
    if (!api) return;
    try {
      api.ready();
      this._loadingDone = true;
      console.log("[YSDK] LoadingAPI.ready()");
    } catch (e) {
      console.warn("[YSDK] LoadingAPI.ready failed:", e.message);
    }
  },

  /** Игровой процесс идёт / остановлен. Повторные вызовы с тем же состоянием гасятся. */
  setGameplay(on) {
    if (on === this._gameplayOn) return;
    this._gameplayOn = on;
    try {
      if (on) this.sdk?.features?.GameplayAPI?.start();
      else    this.sdk?.features?.GameplayAPI?.stop();
    } catch {}
  },

  /* ═══════════════════════════════════════
     СОБЫТИЯ ПЛАТФОРМЫ (п. 1.19.4)
  ═══════════════════════════════════════ */

  _bindEvents() {
    const sdk = this.sdk;
    if (typeof sdk.on !== "function") return;
    sdk.on("game_api_pause",  () => this._emit("pause"));
    sdk.on("game_api_resume", () => this._emit("resume"));

    // Игрок сменил аккаунт в диалоге выбора — перечитываем его данные
    const ev = sdk.EVENTS ?? {};
    if (ev.ACCOUNT_SELECTION_DIALOG_CLOSED) {
      sdk.on(ev.ACCOUNT_SELECTION_DIALOG_CLOSED, async () => {
        await this._initPlayer();
        this._emit("account");
      });
    }
  },

  _emit(name) {
    for (const fn of this._handlers[name]) {
      try { fn(); } catch (e) { console.warn(`[YSDK] ${name} handler:`, e); }
    }
  },

  onPause(fn)   { this._handlers.pause.push(fn); },
  onResume(fn)  { this._handlers.resume.push(fn); },
  onAccount(fn) { this._handlers.account.push(fn); },

  /* ═══════════════════════════════════════
     РЕКЛАМА
  ═══════════════════════════════════════ */

  /** Полноэкранная реклама. @returns {Promise<boolean>} была ли показана */
  showFullscreen() {
    if (!this.available) return Promise.resolve(false);
    return new Promise(resolve => {
      let settled = false;
      const done = shown => { if (!settled) { settled = true; resolve(shown); } };
      try {
        this.sdk.adv.showFullscreenAdv({
          callbacks: {
            onClose: wasShown => done(!!wasShown),
            onError: err => { console.warn("[YSDK] fullscreen error", err); done(false); },
          },
        });
      } catch (e) {
        console.warn("[YSDK] fullscreen throw", e);
        done(false);
      }
      setTimeout(() => done(false), 60000);   // страховка от «зависшего» колбэка
    });
  },

  /** Реклама за вознаграждение. @returns {Promise<boolean>} true — награду выдать */
  showRewarded() {
    if (!this.available) {
      // Локально награду выдаём сразу — чтобы механику можно было тестировать
      console.warn("[YSDK] rewarded: offline mode, reward granted for testing");
      return Promise.resolve(true);
    }
    return new Promise(resolve => {
      let rewarded = false;
      let settled = false;
      const done = () => { if (!settled) { settled = true; resolve(rewarded); } };
      try {
        this.sdk.adv.showRewardedVideo({
          callbacks: {
            onRewarded: () => { rewarded = true; },
            onClose:    () => done(),
            onError:    err => { console.warn("[YSDK] rewarded error", err); done(); },
          },
        });
      } catch (e) {
        console.warn("[YSDK] rewarded throw", e);
        done();
      }
      setTimeout(done, 120000);
    });
  },

  /* ═══════════════════════════════════════
     СОХРАНЕНИЯ ИГРОКА
  ═══════════════════════════════════════ */

  async loadData() {
    if (!this.available || !this.player) return null;
    try {
      return await withTimeout(this.player.getData(), TIMEOUT.PLAYER, "getData");
    } catch (e) {
      console.warn("[YSDK] getData failed:", e.message);
      return null;
    }
  },

  async saveData(data) {
    if (!this.available || !this.player) return false;
    try {
      await withTimeout(this.player.setData(data, true), TIMEOUT.PLAYER, "setData");
      return true;
    } catch (e) {
      console.warn("[YSDK] setData failed:", e.message);
      return false;
    }
  },

  /* ═══════════════════════════════════════
     ЛИДЕРБОРДЫ
  ═══════════════════════════════════════ */

  /** API лидербордов: новый ysdk.leaderboards, старый getLeaderboards() — запасной. */
  async _leaderboards() {
    if (this._lbApi) return this._lbApi;
    if (!this.available) return null;

    if (this.sdk.leaderboards) {
      const lb = this.sdk.leaderboards;
      this._lbApi = {
        setScore:       (n, s) => lb.setScore(n, s),
        getEntries:     (n, o) => lb.getEntries(n, o),
        getPlayerEntry: n      => lb.getPlayerEntry(n),
      };
      return this._lbApi;
    }
    try {
      const lb = await this.sdk.getLeaderboards();
      this._lbApi = {
        setScore:       (n, s) => lb.setLeaderboardScore(n, s),
        getEntries:     (n, o) => lb.getLeaderboardEntries(n, o),
        getPlayerEntry: n      => lb.getLeaderboardPlayerEntry(n),
      };
      return this._lbApi;
    } catch (e) {
      console.warn("[YSDK] leaderboards unavailable:", e.message);
      return null;
    }
  },

  /** Отправить рекорд (только для авторизованных; лимит платформы — раз в секунду). */
  async submitScore(board, score) {
    if (!this.authorized) return false;
    const lb = await this._leaderboards();
    if (!lb) return false;
    try {
      await lb.setScore(board, score | 0);
      return true;
    } catch (e) {
      console.warn("[YSDK] setScore failed:", e.message);
      return false;
    }
  },

  /** Топ игроков: [{ rank, name, score, isMe }] */
  async getEntries(board, limit = 10) {
    const lb = await this._leaderboards();
    if (!lb) return [];
    try {
      const myId = this.player?.getUniqueID?.() ?? null;
      const res = await lb.getEntries(board, { quantityTop: limit, includeUser: true, quantityAround: 3 });
      return (res?.entries ?? []).map(e => ({
        rank:  e.rank,
        name:  e.player?.publicName || (this.lang === "ru" ? "Скрытый игрок" : "Hidden player"),
        score: e.score,
        isMe:  !!myId && e.player?.uniqueID === myId,
      }));
    } catch (e) {
      console.warn("[YSDK] getEntries failed:", e.message);
      return [];
    }
  },

  /** Место текущего игрока или null. */
  async getMyRank(board) {
    if (!this.authorized) return null;
    const lb = await this._leaderboards();
    if (!lb) return null;
    try {
      const entry = await lb.getPlayerEntry(board);
      return entry?.rank ?? null;
    } catch {
      return null;   // LEADERBOARD_PLAYER_NOT_PRESENT — игрока ещё нет в таблице
    }
  },
};

export default YSDK;
