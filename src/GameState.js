/**
 * GameState — постоянный прогресс игрока: рекорд, монеты, бустеры, скины,
 * настройки.
 *
 * Сохранение: Yandex player.setData + localStorage как резерв. Запись
 * дебаунсится (лимит платформы — 100 запросов за 5 минут). У снимка есть
 * номер ревизии: при загрузке побеждает более свежий снимок (облако или
 * локальный), а рекорд берётся максимальный из обоих.
 */
import CONFIG  from "./config.js";
import YSDK    from "./ysdk.js";
import Storage from "./storage.js";

const SAVE_DEBOUNCE_MS = 2000;
const B  = CONFIG.BOOSTERS;
const SK = CONFIG.SKINS;

function freshBoosters() {
  const b = {};
  for (const k of B.ORDER) b[k] = B.START;
  return b;
}

const int = (v, def = 0) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : def;
};

/** Цена с округлением до 5 — «160», а не «157». */
const round5 = n => Math.max(5, Math.round(n / 5) * 5);

/** Цена пачки из n штук бустера k со скидкой (n = 1 — обычная цена). */
export function packPrice(k, n) {
  return n === 1 ? B[k].PRICE : round5(B[k].PRICE * n * (1 - B.PACK.OFF));
}

/** Цена набора «всех бустеров по each». */
export function setPrice(set) {
  const sum = B.ORDER.reduce((s, k) => s + B[k].PRICE, 0);
  return round5(sum * set.EACH * (1 - set.OFF));
}

const GameState = {
  best:       0,      // лучший счёт
  bestHeight: 0,      // лучшая высота, м
  wallet:     0,      // монеты
  boosters:   freshBoosters(),
  skins:      ["white"],   // купленные скины
  skin:       "white",     // надетый скин
  hints:      {},          // показанные подсказки { hot: true, ... }
  muted:      false,
  tutorial:   false,  // обучение пройдено
  runs:       0,
  rev:        0,      // ревизия снимка

  deaths: 0,          // за сессию — для частоты полноэкранной рекламы

  _timer: null,
  _dirty: false,

  /* ═══════ Монеты ═══════ */

  addCoins(n) {
    this.wallet += n;
    this.save();
  },

  spend(n) {
    if (this.wallet < n) return false;
    this.wallet -= n;
    this.save();
    return true;
  },

  /* ═══════ Бустеры ═══════ */

  count(k) {
    return this.boosters[k] | 0;
  },

  addBooster(k, n = 1) {
    this.boosters[k] = Math.min(B.MAX, this.count(k) + n);
    this.save();
  },

  /** Списать один бустер. @returns {boolean} */
  useBooster(k) {
    if (this.count(k) <= 0) return false;
    this.boosters[k] -= 1;
    this.save();
    return true;
  },

  /** Хватает ли монет и места под n штук бустера k. */
  canBuy(k, n = 1) {
    return this.wallet >= packPrice(k, n) && this.count(k) + n <= B.MAX;
  },

  /** Купить n штук (пачка — со скидкой). */
  buyBooster(k, n = 1) {
    if (!this.canBuy(k, n)) return false;
    this.wallet -= packPrice(k, n);
    this.boosters[k] = this.count(k) + n;
    this.save();
    return true;
  },

  canBuySet(set) {
    return this.wallet >= setPrice(set) && B.ORDER.every(k => this.count(k) + set.EACH <= B.MAX);
  },

  buySet(set) {
    if (!this.canBuySet(set)) return false;
    this.wallet -= setPrice(set);
    for (const k of B.ORDER) this.boosters[k] = this.count(k) + set.EACH;
    this.save();
    return true;
  },

  /* ═══════ Скины ═══════ */

  hasSkin(id) {
    return this.skins.includes(id);
  },

  buySkin(id) {
    const s = SK[id];
    if (!s || this.hasSkin(id) || this.wallet < s.PRICE) return false;
    this.wallet -= s.PRICE;
    this.skins.push(id);
    this.skin = id;
    this.save(true);
    return true;
  },

  equipSkin(id) {
    if (!this.hasSkin(id)) return false;
    this.skin = id;
    this.save();
    return true;
  },

  /** Подсказка показывается один раз за всё время. @returns {boolean} показать сейчас */
  hintOnce(key) {
    if (this.hints[key]) return false;
    this.hints[key] = true;
    this.save();
    return true;
  },

  /* ═══════ Итог забега ═══════ */

  /** Записать результат забега. @returns {boolean} новый рекорд */
  recordScore(score, heightM) {
    this.bestHeight = Math.max(this.bestHeight, heightM | 0);
    const record = score > this.best;
    if (record) this.best = score | 0;
    this.save(true);
    return record;
  },

  /* ═══════ Сохранение / загрузка ═══════ */

  _snapshot() {
    return {
      best:       this.best | 0,
      bestHeight: this.bestHeight | 0,
      wallet:     this.wallet | 0,
      boosters:   { ...this.boosters },
      skins:      [...this.skins],
      skin:       this.skin,
      hints:      { ...this.hints },
      muted:      !!this.muted,
      tutorial:   !!this.tutorial,
      runs:       this.runs | 0,
      rev:        this.rev | 0,
    };
  },

  _normalize(d) {
    if (!d || typeof d !== "object") return null;
    const boosters = freshBoosters();
    if (d.boosters && typeof d.boosters === "object") {
      for (const k of B.ORDER) boosters[k] = Math.min(B.MAX, int(d.boosters[k], B.START));
    }
    // Скины: только известные, «классика» есть всегда, надет — только купленный
    const skins = ["white"];
    if (Array.isArray(d.skins)) {
      for (const id of d.skins) if (SK[id] && !skins.includes(id)) skins.push(id);
    }
    const skin = skins.includes(d.skin) ? d.skin : "white";
    const hints = {};
    if (d.hints && typeof d.hints === "object") {
      for (const [k, v] of Object.entries(d.hints)) if (v) hints[k] = true;
    }
    return {
      best:       int(d.best),
      bestHeight: int(d.bestHeight),
      wallet:     int(d.wallet),
      boosters,
      skins,
      skin,
      hints,
      muted:      !!d.muted,
      tutorial:   !!d.tutorial,
      runs:       int(d.runs),
      rev:        int(d.rev, -1),
    };
  },

  _apply(d) {
    this.wallet   = d.wallet;
    this.boosters = d.boosters;
    this.skins    = d.skins;
    this.skin     = d.skin;
    this.hints    = d.hints;
    this.muted    = d.muted;
    this.tutorial = d.tutorial;
    this.runs     = d.runs;
  },

  /** Сначала localStorage, затем облако; свежий снимок побеждает. */
  async load() {
    let local = null;
    try {
      const raw = Storage.getItem(CONFIG.STORAGE.SAVE);
      if (raw) local = this._normalize(JSON.parse(raw));
    } catch (e) {
      console.warn("[GameState] local load failed:", e.message);
    }
    const cloud = this._normalize(await YSDK.loadData());

    const base = cloud && (!local || cloud.rev >= local.rev) ? cloud : local;
    if (base) this._apply(base);
    this.best       = Math.max(local?.best ?? 0, cloud?.best ?? 0);
    this.bestHeight = Math.max(local?.bestHeight ?? 0, cloud?.bestHeight ?? 0);
    this.rev        = Math.max(local?.rev ?? 0, cloud?.rev ?? 0, 0);

    // Если облако отстало от локальной копии — сразу выравниваем
    if (YSDK.available && local && (!cloud || local.rev > cloud.rev || local.best > cloud.best)) {
      this.save(true);
    }
  },

  /** Отложенное сохранение. force — записать немедленно. */
  save(force = false) {
    this._dirty = true;
    if (force) {
      if (this._timer) { clearTimeout(this._timer); this._timer = null; }
      this._write();
      return;
    }
    if (!this._timer) this._timer = setTimeout(() => this._write(), SAVE_DEBOUNCE_MS);
  },

  _write() {
    this._timer = null;
    if (!this._dirty) return;
    this._dirty = false;
    this.rev += 1;
    const snap = this._snapshot();
    Storage.setItem(CONFIG.STORAGE.SAVE, JSON.stringify(snap));
    YSDK.saveData(snap);
  },

  /** Дописать то, что ждёт в дебаунсе (уход со вкладки, закрытие). */
  flush() {
    if (this._dirty || this._timer) this.save(true);
  },
};

export default GameState;
