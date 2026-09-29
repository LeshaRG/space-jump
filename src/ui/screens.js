/**
 * screens.js — HTML-экраны поверх игры: меню, магазин (бустеры, наборы,
 * скины), рекорды, пауза, конец полёта и окно «бустер закончился».
 *
 * Одновременно открыт один экран. Кнопки описываются атрибутом data-act,
 * обработчики передаёт сцена — экраны ничего не знают об игровой логике.
 */
import CONFIG    from "../config.js";
import GameState, { packPrice, setPrice } from "../GameState.js";
import YSDK      from "../ysdk.js";
import Audio     from "../audio.js";
import Art       from "../art.js";
import { t }     from "../i18n.js";
import { icon }  from "../icons.js";
import { isTestHost } from "../testing.js";

const B  = CONFIG.BOOSTERS;
const SK = CONFIG.SKINS;

/** Скидка в процентах для бейджа «−20%». */
const pct = off => Math.round(off * 100);

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Кнопки «звуки» и «музыка» — в левом и правом углу карточки, отдельно друг от друга. */
const soundBtn = () => `<button class="icon-btn${Audio.isMuted() ? " muted" : ""}" data-act="sound" aria-label="${t("sfx")}" title="${t("sfx")}">${icon(Audio.isMuted() ? "soundOff" : "soundOn")}</button>`;
const musicBtn = () => `<button class="icon-btn left${Audio.isMusicOff() ? " muted" : ""}" data-act="music" aria-label="${t("music")}" title="${t("music")}">${icon(Audio.isMusicOff() ? "musicOff" : "musicOn")}</button>`;

/** После переключения: перерисовать кнопку на месте. */
const refresh = (btn, make) => { btn.outerHTML = make(); };

const UI = {
  el: null,

  /** Открыть экран: разметка + обработчики по data-act. */
  open(cls, html, handlers) {
    this.close();
    const root = document.createElement("div");
    root.className = `screen ${cls}`;
    root.innerHTML = `<div class="card">${html}</div>`;
    document.body.appendChild(root);
    root.addEventListener("click", e => {
      const btn = e.target.closest("[data-act]");
      if (!btn || btn.disabled) return;
      e.stopPropagation();
      Audio.play("click");
      handlers[btn.dataset.act]?.(btn, btn.dataset);
    });
    this.el = root;
    return root;
  },

  close() {
    this.el?.remove();
    this.el = null;
  },

  /** Строка статуса экрана: ошибка (красная) или ok — хорошая новость. */
  status(text, ok = false) {
    const s = this.el?.querySelector(".status");
    if (!s) return;
    s.textContent = text;
    s.classList.toggle("ok", ok);
  },

  /* ═══════ Главное меню ═══════ */

  menu(h) {
    const login = YSDK.available && !YSDK.authorized
      ? `<button class="btn ghost small" data-act="login">${icon("user")}${t("login")}</button>`
      : "";
    this.open("menu", `
      ${musicBtn()}${soundBtn()}
      <div class="logo"><span class="logo-a">SPACE</span><span class="logo-b">JUMP</span></div>
      <div class="player">${icon("user")}<span>${esc(YSDK.getName())}</span></div>
      <div class="stats">
        <div class="stat"><span class="stat-label">${t("best")}</span><span class="stat-val">${GameState.best}</span></div>
        <div class="stat"><span class="stat-label">${t("height")}</span><span class="stat-val cyan">${t("meters", GameState.bestHeight)}</span></div>
        <div class="stat"><span class="stat-label">${t("coins")}</span><span class="stat-val gold">${icon("coin")}${GameState.wallet}</span></div>
      </div>
      <button class="btn primary big" data-act="play">${icon("play")}${t("play")}</button>
      <div class="btn-row tiles">
        <button class="btn" data-act="shop">${icon("jetpack")}${t("shop")}</button>
        <button class="btn" data-act="skins">${icon("helmet")}${t("tabSkins")}</button>
        <button class="btn" data-act="leaders">${icon("ranking")}${t("leaderboard")}</button>
      </div>
      ${login}
      <p class="howto">${t("howTo")}</p>
    `, {
      play:    () => h.onPlay(),
      shop:    () => h.onShop("boosters"),
      skins:   () => h.onShop("skins"),
      leaders: () => h.onLeaders(),
      login:   () => h.onLogin(),
      sound:   btn => { h.onSound(); refresh(btn, soundBtn); },
      music:   btn => { h.onMusic(); refresh(btn, musicBtn); },
    });
  },

  /* ═══════ Магазин: бустеры и скины ═══════ */

  /**
   * @param h { onBack, onBuy(k, n) → bool, onBuySet(set) → bool, onAd(k) → Promise<bool>, onSkin(id) → Promise<bool> }
   * @param tab "boosters" | "skins"
   */
  shop(h, tab = "boosters") {
    let first = true;
    const render = (msg = "", ok = false) => {
      // Перерисовка после покупки — без анимации появления и с той же прокруткой
      const scroll = first ? 0 : (this.el?.scrollTop ?? 0);
      const test = isTestHost() && h.onTestCoins
        ? `<button class="btn tiny test" data-act="testCoins">${icon("coin")}+${CONFIG.TEST.COINS.toLocaleString("ru-RU")} · ${t("test")}</button>`
        : "";
      this.open("shop" + (first ? "" : " noanim"), `
        <div class="tabs">
          <button class="tab${tab === "boosters" ? " on" : ""}" data-act="tab" data-tab="boosters">${icon("jetpack")}${t("tabBoosters")}</button>
          <button class="tab${tab === "skins" ? " on" : ""}" data-act="tab" data-tab="skins">${icon("helmet")}${t("tabSkins")}</button>
        </div>
        <div class="wallet-row"><div class="wallet">${icon("coin")}<span>${GameState.wallet}</span></div>${test}</div>
        ${tab === "skins" ? this._skinsHtml() : this._boostersHtml()}
        <div class="status"></div>
        <button class="btn ghost" data-act="back">${icon("back")}${t("back")}</button>
      `, {
        back: () => h.onBack(),
        testCoins: () => { h.onTestCoins(); render(t("got"), true); },
        tab:  (btn, d) => { if (d.tab !== tab) { tab = d.tab; first = true; render(); } },
        buy:  (btn, d) => { if (h.onBuy(d.k, Number(d.n) || 1)) render(t("got"), true); },
        set:  (btn, d) => {
          const set = B.SETS.find(s => s.id === d.id);
          if (set && h.onBuySet(set)) render(t("got"), true);
        },
        ad:   async (btn, d) => {
          btn.disabled = true;
          const ok = await h.onAd(d.k);
          if (!this.el) return;
          if (ok) render(t("got"), true);
          else btn.disabled = false;
        },
        skin: async btn => {
          btn.disabled = true;
          btn.classList.add("busy");
          const ok = await h.onSkin(btn.dataset.id);
          if (!this.el) return;
          if (ok) render();
          else { btn.disabled = false; btn.classList.remove("busy"); }
        },
      });
      this.el.scrollTop = scroll;
      first = false;
      if (msg) this.status(msg, ok);
    };
    render();
  },

  _boostersHtml() {
    const N = B.PACK.N;
    const full = B.ORDER.reduce((s, k) => s + B[k].PRICE, 0);
    const sets = B.SETS.map(s => `
      <div class="bcard set">
        <div class="bicon gold">${icon("pack")}</div>
        <div class="binfo">
          <div class="bname">${t("setName", s.EACH)} <span class="off">${t("off", pct(s.OFF))}</span></div>
          <div class="bdesc">${t("setDesc", s.EACH)} · <s>${full * s.EACH}</s></div>
          <div class="set-icons">${B.ORDER.map(k => icon(k)).join("")}</div>
        </div>
        <div class="bbuy">
          <button class="btn small gold" data-act="set" data-id="${s.id}" ${GameState.canBuySet(s) ? "" : "disabled"}>${icon("coin")}${setPrice(s)}</button>
        </div>
      </div>`).join("");

    const cards = B.ORDER.map(k => `
      <div class="bcard wide">
        <div class="bicon">${icon(k)}</div>
        <div class="binfo">
          <div class="bname">${t("b_" + k)} <span class="bown">×${GameState.count(k)}</span></div>
          <div class="bdesc">${t("b_" + k + "_d")}</div>
        </div>
        <div class="bbuy">
          <button class="btn small gold" data-act="buy" data-k="${k}" data-n="1" ${GameState.canBuy(k) ? "" : "disabled"}>${icon("coin")}${B[k].PRICE}</button>
          <button class="btn small gold pack" data-act="buy" data-k="${k}" data-n="${N}" ${GameState.canBuy(k, N) ? "" : "disabled"}>
            <span class="pk">×${N}</span>${icon("coin")}${packPrice(k, N)}<span class="off">${t("off", pct(B.PACK.OFF))}</span>
          </button>
          <button class="btn small ad" data-act="ad" data-k="${k}" ${GameState.count(k) >= B.MAX ? "disabled" : ""}>${icon("ad")}+1</button>
        </div>
      </div>`).join("");

    return `
      <div class="blist">
        <div class="shop-sub">${icon("pack")}${t("packsTitle")}</div>
        ${sets}
        <div class="shop-sub">${icon("jetpack")}${t("tabBoosters")}</div>
        ${cards}
        <div class="bcard coins">
          <div class="bicon gold">${icon("coin")}</div>
          <div class="binfo">
            <div class="bname">${t("coinsAdName")}</div>
            <div class="bdesc">${t("coinsAdDesc")}</div>
          </div>
          <div class="bbuy">
            <button class="btn small ad" data-act="ad" data-k="coins">${icon("ad")}+${CONFIG.ADS.REWARD_COINS}</button>
          </div>
        </div>
      </div>`;
  },

  _skinsHtml() {
    // Скин без собранного арта в магазин не попадает — надеть было бы нечего
    const ids = SK.ORDER.filter(id => !SK.HIDDEN.includes(id) && (id === "white" || Art.hasSkin(id)));
    const cards = ids.map(id => {
      const s = SK[id];
      const own = GameState.hasSkin(id);
      const on = GameState.skin === id;
      const src = Art.skinIcon(id);
      const pic = src
        ? `<img src="${src}" alt="" draggable="false">`
        : `<span class="skin-ph" style="color:${s.COLOR}">${icon("helmet")}</span>`;
      let btn;
      if (on) btn = `<button class="btn small worn" disabled>${icon("check")}${t("equipped")}</button>`;
      else if (own) btn = `<button class="btn small" data-act="skin" data-id="${id}">${t("equip")}</button>`;
      else btn = `<button class="btn small gold" data-act="skin" data-id="${id}" ${GameState.wallet >= s.PRICE ? "" : "disabled"}>${icon("coin")}${s.PRICE}</button>`;
      return `
        <div class="skin${on ? " on" : ""}${s.PREMIUM ? " premium" : ""}">
          ${s.PREMIUM ? `<div class="skin-tag">${icon("crown")}${t("premium")}</div>` : ""}
          <div class="skin-pic">${pic}</div>
          <div class="skin-name">${t("skin_" + id)}</div>
          ${btn}
        </div>`;
    }).join("");
    return `<div class="skins">${cards}</div>`;
  },

  /* ═══════ Рекорды ═══════ */

  leaders(h) {
    this.open("leaders", `
      <div class="screen-title">${icon("ranking")}${t("leaderboard")}</div>
      <div class="lb-rank"></div>
      <div class="lb-table"><div class="lb-empty">${t("loading")}</div></div>
      <button class="btn ghost" data-act="back">${icon("back")}${t("back")}</button>
    `, { back: () => h.onBack() });

    const root = this.el;
    Promise.all([YSDK.getEntries(CONFIG.LEADERBOARD, 10), YSDK.getMyRank(CONFIG.LEADERBOARD)]).then(([entries, rank]) => {
      if (this.el !== root) return;   // экран уже закрыли
      const $rank = root.querySelector(".lb-rank");
      const $table = root.querySelector(".lb-table");
      if (rank) $rank.textContent = t("yourRank", rank);
      else if (YSDK.available && !YSDK.authorized) $rank.textContent = t("loginHint");

      if (!entries.length) {
        $table.innerHTML = `
          <div class="lb-empty">${t("noScores")}</div>
          <div class="lb-row me"><span class="lb-pos">—</span><span class="lb-name">${esc(YSDK.getName())}</span><span class="lb-score">${GameState.best}</span></div>`;
        return;
      }
      // Место — цветной бейдж, а не эмодзи-медали: они по-разному выглядят в разных ОС
      const tier = r => (r <= 3 ? ` t${r}` : "");
      $table.innerHTML = entries.map(e => `
        <div class="lb-row${e.isMe ? " me" : ""}">
          <span class="lb-pos${tier(e.rank)}">${e.rank}</span>
          <span class="lb-name">${esc(e.name)}</span>
          <span class="lb-score">${e.score | 0}</span>
        </div>`).join("");
    });
  },

  /* ═══════ Пауза ═══════ */

  pause(h) {
    this.open("pause", `
      ${musicBtn()}${soundBtn()}
      <div class="screen-title">${t("pause")}</div>
      <button class="btn primary big" data-act="resume">${icon("play")}${t("resume")}</button>
      <button class="btn" data-act="restart">${icon("restart")}${t("restart")}</button>
      <button class="btn ghost" data-act="menu">${icon("back")}${t("menu")}</button>
    `, {
      resume:  () => h.onResume(),
      restart: () => h.onRestart(),
      menu:    () => h.onMenu(),
      sound:   btn => { h.onSound(); refresh(btn, soundBtn); },
      music:   btn => { h.onMusic(); refresh(btn, musicBtn); },
    });
  },

  /* ═══════ Конец полёта ═══════ */

  /**
   * @param d { score, best, heightM, runCoins, picked, earned, doubled, canDouble, record, canRevive }
   */
  gameOver(d, h) {
    const revive = d.canRevive ? `
      <div class="revive">
        <button class="btn ad big" data-act="revive">${icon("play")}${t("continueAd")}</button>
        <div class="revive-desc">${t("continueDesc")}</div>
      </div>` : "";
    const dbl = d.canDouble
      ? `<button class="btn tiny ad" data-act="double">${icon("ad")}${t("doubleAd")}</button>`
      : (d.doubled ? `<span class="dbl-ok">×2${icon("check")}</span>` : "");
    this.open("over", `
      <div class="over-icon">${icon("helmet")}</div>
      <div class="screen-title red">${t("gameOver")}</div>
      ${d.record ? `<div class="badge">${icon("star")}${t("newRecord")}</div>` : ""}
      <div class="over-score">${d.score}</div>
      <div class="rows">
        <div class="row"><span>${t("best")}</span><b>${d.best}</b></div>
        <div class="row"><span>${t("height")}</span><b class="cyan">${t("meters", d.heightM)}</b></div>
        <div class="row coins-row">
          <span>${t("coins")}</span>
          <b class="gold">${icon("coin")}${GameState.wallet}<small>+${d.runCoins}</small>${dbl}</b>
        </div>
        <div class="row-note">${t("coinsPicked")} ${d.picked} · ${t("coinsEarned")} ${d.earned}</div>
      </div>
      ${revive}
      <div class="status"></div>
      <button class="btn primary" data-act="again">${icon("restart")}${t("playAgain")}</button>
      <div class="btn-row tiles">
        <button class="btn" data-act="shop">${icon("jetpack")}${t("shop")}</button>
        <button class="btn" data-act="skins">${icon("helmet")}${t("tabSkins")}</button>
        <button class="btn" data-act="leaders">${icon("ranking")}${t("leaderboard")}</button>
      </div>
      <button class="btn ghost" data-act="menu">${icon("back")}${t("menu")}</button>
    `, {
      revive:  btn => h.onRevive(btn),
      double:  btn => h.onDouble(btn),
      again:   () => h.onAgain(),
      shop:    () => h.onShop("boosters"),
      skins:   () => h.onShop("skins"),
      leaders: () => h.onLeaders(),
      menu:    () => h.onMenu(),
    });
  },

  /* ═══════ Бустер закончился (во время забега) ═══════ */

  boosterPopup(k, h) {
    const price = B[k].PRICE;
    const N = B.PACK.N;
    this.open("popup", `
      <div class="bicon big">${icon(k)}</div>
      <div class="screen-title small">${t("boosterEmpty")}</div>
      <div class="bname">${t("b_" + k)}</div>
      <div class="bdesc">${t("b_" + k + "_d")}</div>
      <div class="wallet small">${icon("coin")}<span>${GameState.wallet}</span></div>
      <div class="btn-row">
        <button class="btn gold" data-act="buy" data-n="1" ${GameState.canBuy(k) ? "" : "disabled"}>${icon("coin")}${price}</button>
        <button class="btn gold pack" data-act="buy" data-n="${N}" ${GameState.canBuy(k, N) ? "" : "disabled"}>
          <span class="pk">×${N}</span>${icon("coin")}${packPrice(k, N)}<span class="off">${t("off", pct(B.PACK.OFF))}</span>
        </button>
      </div>
      <button class="btn ad" data-act="ad">${icon("ad")}${t("getForAd")}</button>
      <div class="status"></div>
      <button class="btn ghost" data-act="close">${t("cancel")}</button>
    `, {
      buy:   (btn, d) => h.onBuy(Number(d.n) || 1),
      ad:    async btn => {
        btn.disabled = true;
        const ok = await h.onAd();
        if (!ok && this.el) btn.disabled = false;
      },
      close: () => h.onClose(),
    });
  },
};

export default UI;
