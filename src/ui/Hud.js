/**
 * Hud — игровой интерфейс поверх канваса: счёт, рекорд, «жар», монеты и
 * выплаты за очки, «монеты ×2», пауза и панель бустеров. HTML вместо текста
 * Phaser: чёткий шрифт на любом DPR и адаптивная вёрстка с учётом безопасных
 * зон (вырез камеры, жесты iOS). DOM обновляется только при изменении значений.
 */
import CONFIG from "../config.js";
import { t } from "../i18n.js";
import { icon } from "../icons.js";

const ORDER = CONFIG.BOOSTERS.ORDER;
const DOTS = 24;                 // «очки, летящие в счёт» — пул элементов

export default class Hud {
  constructor({ onPause, onBooster }) {
    const el = document.createElement("div");
    el.id = "hud";
    el.className = "hidden";
    el.innerHTML = `
      <div class="hud-top">
        <button class="hud-btn" data-act="pause" aria-label="${t("pause")}">${icon("pause")}</button>
        <div class="hud-score">
          <div class="hud-score-val">0</div>
          <div class="hud-best"></div>
          <div class="hud-hot lvl0">
            <div class="hot-ring">${icon("flame")}</div>
            <div class="hot-bar"><i></i></div>
            <div class="hot-x">×1</div>
          </div>
        </div>
        <div class="hud-right">
          <div class="hud-coins">${icon("coin")}<span>0</span></div>
          <div class="hud-pay"><div class="pay-bar"><i></i></div><span class="pay-n"></span></div>
          <div class="hud-x2">${icon("coin")}<b>×2</b><span></span></div>
        </div>
      </div>
      <div class="hud-gain"><span class="gain-n">+0</span><span class="gain-x"></span></div>
      <div class="hud-toast"></div>
      <div class="hud-boosters">
        ${ORDER.map(k => `
          <button class="bst" data-k="${k}" aria-label="${t("b_" + k)}">
            ${icon(k)}
            <span class="bst-n">0</span>
            <span class="bst-tag"></span>
          </button>`).join("")}
      </div>`;
    document.body.appendChild(el);
    this.el = el;

    this.$score = el.querySelector(".hud-score-val");
    this.$best  = el.querySelector(".hud-best");
    this.$coins = el.querySelector(".hud-coins span");
    this.$coinBox = el.querySelector(".hud-coins");
    this.$toast = el.querySelector(".hud-toast");
    this.$hot = el.querySelector(".hud-hot");
    this.$hotRing = el.querySelector(".hot-ring");
    this.$hotBar = el.querySelector(".hot-bar i");
    this.$hotX = el.querySelector(".hot-x");
    this.$pay = el.querySelector(".hud-pay");
    this.$payBar = el.querySelector(".pay-bar i");
    this.$payN = el.querySelector(".pay-n");
    this.$x2 = el.querySelector(".hud-x2");
    this.$x2n = el.querySelector(".hud-x2 span");
    this.$gain = el.querySelector(".hud-gain");
    this.$gainN = el.querySelector(".gain-n");
    this.$gainX = el.querySelector(".gain-x");
    this.$b = {};
    for (const k of ORDER) {
      const btn = el.querySelector(`[data-k="${k}"]`);
      this.$b[k] = { btn, n: btn.querySelector(".bst-n"), tag: btn.querySelector(".bst-tag") };
    }

    // Нажатия на кнопки не должны превращаться в натяжение рогатки
    el.addEventListener("pointerdown", e => { if (e.target.closest("button")) e.stopPropagation(); });
    el.addEventListener("click", e => {
      const btn = e.target.closest("button");
      if (!btn) return;
      e.stopPropagation();
      if (btn.dataset.act === "pause") onPause();
      else if (btn.dataset.k) onBooster(btn.dataset.k);
    });

    this._cache = {};
    this._toastTimer = null;
    this._score = 0;          // настоящий счёт
    this._disp = 0;           // показанный — догоняет настоящий «прокруткой»
    this._dots = [];
    this._animOk = typeof el.animate === "function";
  }

  show() { this.el.classList.remove("hidden"); }
  hide() { this.el.classList.add("hidden"); }

  _set(key, value, fn) {
    if (this._cache[key] === value) return;
    this._cache[key] = value;
    fn(value);
  }

  /** Замена класса-анимации: снять и поставить заново, чтобы проигралась ещё раз. */
  _replay(node, cls) {
    node.classList.remove(cls);
    void node.offsetWidth;
    node.classList.add(cls);
  }

  /* ═══════ Счёт ═══════ */

  setScore(score, best, beaten = false) {
    this._score = score;
    this._set("best", best, v => { this.$best.textContent = `${t("best")} ${v}`; });
    this._set("beaten", beaten, v => this.$best.classList.toggle("beaten", v));
  }

  /** Каждый кадр: счёт «прокручивается» к настоящему значению. */
  tick(dt) {
    const diff = this._score - this._disp;
    if (!diff) return;
    const step = Math.max(1, Math.ceil(Math.abs(diff) * Math.min(1, dt * 12)));
    this._disp = diff > 0 ? Math.min(this._score, this._disp + step) : this._score;
    this.$score.textContent = this._disp;
  }

  recordFlash() {
    this.$score.classList.remove("gain");
    this._replay(this.$score, "record");
  }

  /* ═══════ Монеты ═══════ */

  setCoins(n) {
    this._set("coins", n, v => { this.$coins.textContent = v; });
  }

  /** Короткая «пульсация» счётчика монет при подборе. */
  bumpCoins() {
    this._replay(this.$coinBox, "bump");
  }

  /**
   * Полоска до следующей выплаты за очки.
   * @param progress 0..1  @param n сколько монет будет  @param rec выше рекорда (×2)
   */
  setPay(progress, n, rec) {
    const p = Math.round(Math.max(0, Math.min(1, progress)) * 100);
    this._set("payP", p, v => { this.$payBar.style.width = v + "%"; });
    this._set("payN", n, v => { this.$payN.textContent = `+${v}`; });
    this._set("payRec", rec, v => this.$pay.classList.toggle("rec", v));
  }

  /** Выплата: «+N» взлетает от полоски к счётчику монет. */
  payout(n, rec) {
    this.bumpCoins();
    if (!this._animOk) return;
    const from = this.$payN.getBoundingClientRect();
    const to = this.$coins.getBoundingClientRect();
    const pop = document.createElement("div");
    pop.className = "hud-pop" + (rec ? " rec" : "");
    pop.innerHTML = `+${n}${icon("coin")}`;
    this.el.appendChild(pop);
    const x0 = from.left, y0 = from.top;
    const x1 = to.left, y1 = to.top - 4;
    pop.animate([
      { transform: `translate(${x0}px, ${y0}px) scale(.6)`, opacity: 0 },
      { transform: `translate(${x0 - 6}px, ${y0 + 16}px) scale(1.25)`, opacity: 1, offset: 0.3 },
      { transform: `translate(${x1}px, ${y1}px) scale(.8)`, opacity: 0 },
    ], { duration: 900, easing: "cubic-bezier(.3,.6,.4,1)" }).onfinish = () => pop.remove();
  }

  /** «Монеты ×2»: сколько секунд осталось (0 — не действует). */
  setX2(sec) {
    const s = Math.ceil(sec);
    this._set("x2", s, v => {
      this.$x2.classList.toggle("on", v > 0);
      this.$x2.classList.toggle("warn", v > 0 && v <= 10);
      this.$x2n.textContent = v;
    });
  }

  /* ═══════ Жар ═══════ */

  /**
   * @param level 0/1/2 — ×1/×2/×3
   * @param energy 0..1 — шкала до следующего множителя
   * @param win 0..1 — сколько осталось от окна на прыжок (0 — окно не идёт)
   */
  setHot(level, energy, win) {
    this._set("hotL", level, v => {
      this.$hot.classList.remove("lvl0", "lvl1", "lvl2");
      this.$hot.classList.add("lvl" + v);
      this.$hotX.textContent = `×${v + 1}`;
    });
    this._set("hotE", Math.round(energy * 100), v => { this.$hotBar.style.width = v + "%"; });
    this._set("hotW", Math.round(win * 100), v => { this.$hotRing.style.setProperty("--p", v / 100); });
    this._set("hotU", win > 0 && win < 0.34, v => this.$hot.classList.toggle("urgent", v));
  }

  // Классы-анимации взаимоисключающие: иначе более поздний в CSS перебьёт другой
  hotUp()   { this.$hot.classList.remove("lost"); this._replay(this.$hot, "up"); }
  hotLost() { this.$hot.classList.remove("up"); this._replay(this.$hot, "lost"); }

  /* ═══════ Счётчик очков в полёте на джетпаке ═══════ */

  gainStart() {
    this.$gain.getAnimations?.().forEach(a => a.cancel());
    this.$gainN.textContent = "+0";
    this.$gainX.textContent = "";
    this.$gain.classList.add("show");
    this._cache.gainN = 0;
    this._cache.gainX = 1;
  }

  gainSet(n, mult) {
    this._set("gainN", n, v => { this.$gainN.textContent = `+${v}`; });
    this._set("gainX", mult, v => { this.$gainX.textContent = v > 1 ? `×${v}` : ""; });
  }

  /** Полёт кончился — счётчик «вливается» в счёт. */
  gainEnd(n) {
    this.gainSet(n, this._cache.gainX ?? 1);
    const done = () => {
      this.$gain.classList.remove("show");
      this.$score.classList.remove("record");
      this._replay(this.$score, "gain");
    };
    if (!this._animOk || n <= 0) return done();
    const a = this.$gain.getBoundingClientRect();
    const b = this.$score.getBoundingClientRect();
    const dy = b.top + b.height / 2 - (a.top + a.height / 2);
    this.$gain.animate([
      { transform: "translate(-50%, 0) scale(1)", opacity: 1 },
      { transform: "translate(-50%, 8px) scale(1.15)", opacity: 1, offset: 0.25 },
      { transform: `translate(-50%, ${dy}px) scale(.45)`, opacity: 0 },
    ], { duration: 650, easing: "cubic-bezier(.5,0,.75,.4)" }).onfinish = done;
  }

  /** Искра от героя (CSS-координаты) к счёту. */
  flyDot(x, y) {
    if (!this._animOk) return;
    let d = this._dots.find(e => !e._busy);
    if (!d) {
      if (this._dots.length >= DOTS) return;
      d = document.createElement("div");
      d.className = "hud-fly";
      this.el.appendChild(d);
      this._dots.push(d);
    }
    const r = this.$score.getBoundingClientRect();
    const tx = r.left + r.width / 2 + (Math.random() - 0.5) * r.width * 0.5;
    const ty = r.top + r.height / 2;
    d._busy = true;
    d.style.display = "block";
    d.animate([
      { transform: `translate(${x}px, ${y}px) scale(1.2)`, opacity: 1 },
      { transform: `translate(${tx}px, ${ty}px) scale(.5)`, opacity: 0.2 },
    ], { duration: 420 + Math.random() * 160, easing: "cubic-bezier(.45,0,.8,.5)" }).onfinish = () => {
      d._busy = false;
      d.style.display = "none";
    };
  }

  /* ═══════ Рогатка и бустеры ═══════ */

  /**
   * Натяжение рогатки: кнопки гаснут и пропускают касание сквозь себя.
   * Иначе палец или мышь, заехав на кнопку, перестают двигать прицел —
   * Phaser слушает движение только на канвасе под кнопками.
   */
  setAiming(on) {
    this._set("aiming", on, v => this.el.classList.toggle("aiming", v));
  }

  /**
   * @param counts { jetpack: n, ... }
   * @param state  { aim: осталось прыжков с прицелом, targeting: выбор цели телепорта }
   */
  setBoosters(counts, state) {
    for (const k of ORDER) {
      const n = counts[k] | 0;
      const b = this.$b[k];
      const active = (k === "aim" && state.aim > 0) || (k === "teleport" && state.targeting) || (k === "jetpack" && state.jet);
      const tag = k === "aim" && state.aim > 0 ? `×${state.aim}` : "";
      this._set(`n_${k}`, n, v => {
        b.n.textContent = v > 0 ? v : "+";
        b.btn.classList.toggle("empty", v <= 0);
      });
      this._set(`a_${k}`, active, v => b.btn.classList.toggle("active", v));
      this._set(`t_${k}`, tag, v => { b.tag.textContent = v; b.tag.classList.toggle("on", !!v); });
    }
  }

  /** Подсветить кнопку бустера (подобрали на платформе). */
  flash(k) {
    const b = this.$b[k]?.btn;
    if (b) this._replay(b, "flash");
  }

  toast(text, ms = 1800) {
    this.$toast.textContent = text;
    this.$toast.classList.add("show");
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.$toast.classList.remove("show"), ms);
  }

  destroy() {
    clearTimeout(this._toastTimer);
    this.el.remove();
  }
}
