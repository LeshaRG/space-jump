/**
 * Hero — космонавт: физическое тело, состояние и спрайт.
 *
 * Логика состояний (прыжок, приземление, джетпак, телепорт) живёт в GameScene;
 * здесь — тело, выбор позы по состоянию и «сочность» отрисовки: наклон в
 * полёте, сжатие при приземлении, растяжение при толчке, мигание неуязвимости.
 *
 * Позы берутся из слотов арта: hero_idle, hero_crouch, hero_jump, hero_fall,
 * hero_land, hero_jetpack, hero_hit. Чего нет — подменяется соседней позой.
 */
import CONFIG from "./config.js";
import Art    from "./art.js";
import { HERO_H } from "./physics.js";

const HC = CONFIG.HERO;

export default class Hero {
  constructor(scene, x, y, platform) {
    this.scene = scene;

    /** Тело: (x, y) — середина подошв. */
    this.b = { x, y, vx: 0, vy: 0, platform, localX: x - platform.baseX, slide: 0 };
    this.px = x;
    this.py = y;

    this.state    = "stand";   // stand | air | jet | tele | dead
    this.facing   = 1;         // арт смотрит вправо
    this.aiming   = false;
    this.invuln   = 0;
    this.hitT     = 0;
    this.landT    = 0;
    this.bounces  = 0;         // рикошетов в текущем прыжке
    this.launchFrom = null;
    this.launchY  = y;
    this.lastPlatform = platform;
    this.fallSaid = false;
    this.fade     = 1;         // для телепорта и «съедания» чёрной дырой
    this.suck     = null;      // чёрная дыра, которая затягивает героя

    this._sx = 1;              // сквош/стретч
    this._sy = 1;
    this._pose = "";

    this.sprite = Art.sprite(scene, "hero_idle", x, y).setDepth(30);
    this._fitSprite();
    this.sprite.setScale(this.scale);
    this._pose = "hero_idle";
  }

  /** Масштаб и опора по арту позы hero_idle (у скина с рогами холст выше). */
  _fitSprite() {
    const info = Art.get("hero_idle");
    this.scale = HC.DRAW_H / info.ref;
    // Опора спрайта — центр тела, а не ноги: наклон и вращение идут вокруг корпуса
    const frame = this.scene.textures.getFrame(info.texture, info.frames[0]);
    const frameH = frame ? frame.realHeight : 242;
    this.sprite.setOrigin(info.pivot[0], info.pivot[1] - (HERO_H / 2) / this.scale / frameH);
  }

  /** Сменили скин: пересчитать опору и переключить текущую позу на новый атлас. */
  refreshSkin() {
    this._fitSprite();
    this._pose = "";
  }

  /** Сорваться с платформы / получить импульс. */
  toAir(vx, vy) {
    const b = this.b;
    b.platform = null;
    b.slide = 0;
    b.vx = vx;
    b.vy = vy;
    this.state = "air";
    this.launchY = b.y;
    this.launchFrom = null;
  }

  onLaunch() {
    this._sx = 0.84;
    this._sy = 1.2;
  }

  onLanded(hard) {
    this.landT = 0.12;
    this._sx = hard ? 1.22 : 1.14;
    this._sy = hard ? 0.78 : 0.86;
  }

  onHit() {
    this.hitT = 0.7;
  }

  get center() {
    return { x: this.b.x, y: this.b.y - HERO_H / 2 };
  }

  /**
   * @param alpha доля шага для интерполяции позиции
   * @param dt    реальное время кадра
   */
  render(alpha, dt) {
    const b = this.b;
    const x = this.px + (b.x - this.px) * alpha;
    const y = this.py + (b.y - this.py) * alpha;

    this.landT = Math.max(0, this.landT - dt);
    this.hitT = Math.max(0, this.hitT - dt);

    // ── Поза ──
    let pose;
    switch (this.state) {
      case "stand": pose = this.aiming ? "hero_crouch" : (this.landT > 0 ? "hero_land" : "hero_idle"); break;
      case "air":   pose = this.hitT > 0 ? "hero_hit" : (b.vy < 0 ? "hero_jump" : "hero_fall"); break;
      case "jet":   pose = "hero_jetpack"; break;
      case "dead":  pose = "hero_hit"; break;
      default:      pose = "hero_jump";
    }
    if (pose !== this._pose) {
      Art.apply(this.sprite, pose, true);
      this._pose = pose;
    }

    // ── Сквош/стретч возвращается к норме ──
    const k = 1 - Math.exp(-dt * 14);
    this._sx += (1 - this._sx) * k;
    this._sy += (1 - this._sy) * k;

    // ── Наклон ──
    const spinning = (this.state === "air" && this.hitT > 0) || (this.state === "dead" && this.suck);
    if (spinning) {
      // Сбит метеоритом / затянут в чёрную дыру — кувырок
      this.sprite.rotation += dt * (this.suck ? 11 : 14) * this.facing;
    } else {
      let rot = 0;
      if (this.state === "air") rot = Math.max(-0.22, Math.min(0.22, b.vx / 2600));
      else if (this.state === "jet") rot = Math.max(-0.2, Math.min(0.2, (b.x - this.px) * 0.05));
      else if (this.state === "dead") rot = this.sprite.rotation;
      this.sprite.rotation += (rot - this.sprite.rotation) * (1 - Math.exp(-dt * 12));
    }

    // Сжатие идёт вокруг центра тела — поднимаем опору, чтобы ноги оставались на настиле
    const s = this.scale * this.fade;
    this.sprite
      .setPosition(x, y - (HERO_H / 2) * this._sy + HC.SINK)
      .setScale(s * this._sx, s * this._sy)
      .setFlipX(this.facing < 0);

    // Мигание неуязвимости
    this.sprite.setAlpha(this.invuln > 0 && this.state !== "tele" ? (Math.sin(this.scene.time.now / 45) > 0 ? 1 : 0.35) : Math.min(1, this.fade * 1.5));
  }
}
