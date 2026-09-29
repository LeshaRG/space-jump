/**
 * BootScene — загрузка графики и звука, инициализация Yandex Games SDK
 * и прогресса игрока. Параллельно, чтобы не удлинять загрузку.
 *
 * Сначала грузится манифест assets/art/sprites.json (его пишет
 * tools/build_sprites.py), по нему — атлас и звуки. Нет манифеста —
 * не беда: всё нарисуется заглушками.
 */
import YSDK      from "../ysdk.js";
import GameState from "../GameState.js";
import Audio     from "../audio.js";
import Art       from "../art.js";
import { t }     from "../i18n.js";

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise(res => setTimeout(res, ms))]);
}

export default class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: "BootScene" });
  }

  preload() {
    // SDK инициализируем параллельно с загрузкой ассетов
    this._sdk = YSDK.init();

    const bar = document.querySelector("#preloader .pl-bar i");
    this.load.on("progress", v => { if (bar) bar.style.width = `${Math.round(v * 100)}%`; });
    this.load.on("loaderror", file => console.warn("[boot] не загрузился файл:", file.key, file.src));

    this.load.json("manifest", "assets/art/sprites.json");
    this.load.on("filecomplete-json-manifest", (key, type, data) => {
      if (data?.atlas) this.load.multiatlas(data.atlas.key, data.atlas.json, data.atlas.path);
      for (const [name, urls] of Object.entries(data?.sounds ?? {})) this.load.audio(name, urls);
    });
  }

  async create() {
    const manifest = this.cache.json.get("manifest") ?? null;
    Art.init(this, manifest);

    // Ни платформа, ни сеть, ни заблокированное хранилище не должны помешать
    // дойти до меню: иначе LoadingAPI.ready() не будет вызван никогда
    try {
      await this._sdk;
      await withTimeout(GameState.load(), 10000);
    } catch (e) {
      console.warn("[boot] инициализация с ошибкой, играем офлайн:", e.message);
    }

    // Надетый скин — его маленький атлас грузим сразу, остальные — по запросу
    try {
      await withTimeout(Art.loadSkin(this, GameState.skin), 8000);
    } catch (e) {
      console.warn("[boot] скин не загрузился:", e.message);
    }
    Art.setSkin(GameState.skin);

    Audio.init(this.game, manifest?.sounds);
    Audio.setMuted(GameState.muted);
    Audio.setMusicOff(GameState.musicOff);

    const rotate = document.querySelector("#rotate span");
    if (rotate) rotate.textContent = t("rotate");
    document.documentElement.lang = YSDK.lang === "ru" ? "ru" : "en";

    this.scene.start("GameScene", { autostart: false });
  }
}
