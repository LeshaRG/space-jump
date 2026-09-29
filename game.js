/**
 * game.js — точка входа: Phaser, чёткая картинка на HiDPI-экранах,
 * пауза от платформы, вкладки и поворота устройства.
 */
import CONFIG    from "./src/config.js";
import YSDK      from "./src/ysdk.js";
import GameState from "./src/GameState.js";
import Audio     from "./src/audio.js";
import BootScene from "./src/scenes/BootScene.js";
import GameScene from "./src/scenes/GameScene.js";

// Канвас рисуется в физических пикселях экрана (до MAX_DPR), а CSS-размер —
// во весь iframe. Иначе на телефонах с DPR 2–3 картинка была бы мыльной.
const dpr  = () => Math.min(window.devicePixelRatio || 1, CONFIG.VIEW.MAX_DPR);
const size = () => ({ w: Math.max(1, window.innerWidth), h: Math.max(1, window.innerHeight) });

const d0 = dpr();
const s0 = size();

const game = new Phaser.Game({
  type:            Phaser.AUTO,
  parent:          "game",
  backgroundColor: "#070716",
  scale: {
    mode:   Phaser.Scale.NONE,
    width:  Math.round(s0.w * d0),
    height: Math.round(s0.h * d0),
    zoom:   1 / d0,
  },
  render: { antialias: true, powerPreference: "high-performance" },
  input:  { activePointers: 3 },
  disableContextMenu: true,   // долгий тап не открывает меню (п. 1.6.1.8)
  banner: false,
  scene:  [BootScene, GameScene],
});
game.registry.set("dpr", d0);

/* ─── Размер окна и поворот ─── */

const rotateQuery = window.matchMedia("(orientation: landscape) and (max-height: 500px) and (pointer: coarse)");

function relayout() {
  const d = dpr();
  const s = size();
  game.registry.set("dpr", d);
  game.scale.resize(Math.round(s.w * d), Math.round(s.h * d));
  game.scale.setZoom(1 / d);
  pause.rotate = rotateQuery.matches;   // телефон боком — игра на паузе под подсказкой
  applyPause();
}

window.addEventListener("resize", relayout);
window.addEventListener("orientationchange", () => setTimeout(relayout, 150));

/* ─── Пауза: платформа (п. 1.19.4), скрытая вкладка (п. 1.3), поворот ─── */

const pause = { api: false, hidden: document.hidden, rotate: rotateQuery.matches };
let pausedNow = null;

function applyPause() {
  const on = pause.api || pause.hidden || pause.rotate;
  if (on === pausedNow) return;
  pausedNow = on;
  game.registry.set("sysPaused", on);
  const scene = game.scene.getScene("GameScene");
  if (scene && scene.sys.isActive()) scene.onSystemPause(on);
  else if (on) Audio.pause();
  else Audio.resume();
}

YSDK.onPause(() => { pause.api = true; applyPause(); });
YSDK.onResume(() => { pause.api = false; applyPause(); });

document.addEventListener("visibilitychange", () => {
  pause.hidden = document.hidden;
  if (document.hidden) GameState.flush();   // дописываем прогресс из дебаунса
  applyPause();
});

// Последний шанс сохраниться перед закрытием вкладки
window.addEventListener("pagehide", () => GameState.flush());

// Сменили аккаунт в диалоге Яндекса — перечитываем прогресс
YSDK.onAccount(async () => {
  await GameState.load();
  Audio.setMuted(GameState.muted);
  Audio.setMusicOff(GameState.musicOff);
  const scene = game.scene.getScene("GameScene");
  if (!scene?.sys.isActive()) return;
  await scene.applySkin(GameState.skin);   // у другого аккаунта может быть другой скин
  if (scene.mode === "menu") scene.showMenu();
});

if (pause.hidden || pause.rotate) applyPause();

window.game = game;
export default game;
