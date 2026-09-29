/**
 * Aim — рогатка: зажал экран, оттянул, отпустил.
 *
 * Натяжение считается в CSS-пикселях от точки касания, поэтому ощущается
 * одинаково на телефоне и на мониторе. Прыжок летит в сторону, обратную
 * натяжению. Пока игрок целится, рисуется «исчезающий вектор» — начало
 * траектории, которое гаснет к концу. Рикошет виден, только если стена
 * попадает на эту видимую длину. С бустером «Точный прицел» виден весь путь
 * до приземления.
 *
 * Траектория считается той же функцией, что двигает героя (physics.js).
 */
import CONFIG from "./config.js";
import { simulate } from "./physics.js";

const J = CONFIG.JUMP;
const A = CONFIG.AIM;
const DEG = Math.PI / 180;

const COLOR_PATH  = 0xffffff;
const COLOR_FULL  = 0xffd166;
const COLOR_BAD   = 0xff4d5e;

export default class Aim {
  constructor(scene) {
    this.scene = scene;
    this.g = scene.add.graphics().setDepth(50);
    this.pull = scene.add.graphics().setDepth(51);
    this.res = { points: [], hits: [], land: null, swallow: null, fell: false };
    this._cum = [];               // длина пути до каждой точки траектории

    this.pointerId = null;
    this.sx = 0; this.sy = 0;     // точка касания, CSS px
    this.cx = 0; this.cy = 0;     // текущая точка
    this.holdTime = 0;
    this.saidLong = false;
    this._fading = false;
  }

  get active() {
    return this.pointerId !== null;
  }

  begin(id, x, y) {
    this.pointerId = id;
    this.sx = this.cx = x;
    this.sy = this.cy = y;
    this.holdTime = 0;
    this.saidLong = false;
    this._fading = false;
    this.g.setAlpha(1);
    this.pull.setAlpha(1);
  }

  move(x, y) {
    this.cx = x;
    this.cy = y;
  }

  /** Закончить натяжение. @returns {object|null} вектор прыжка */
  end(fullPull) {
    const launch = this.compute(fullPull);
    this.pointerId = null;
    return launch;
  }

  cancel() {
    this.pointerId = null;
    this.g.clear();
    this.pull.clear();
  }

  /**
   * Вектор прыжка по натяжению.
   * @returns {{vx, vy, power, valid, cancel}|null} null — натяжения ещё нет
   */
  compute(fullPull) {
    const dx = this.cx - this.sx;
    const dy = this.cy - this.sy;
    const len = Math.hypot(dx, dy);
    if (len < J.DEAD_ZONE) return null;

    // Летим противоположно натяжению; угол над горизонтом
    const lx = -dx / len;
    const ly = -dy / len;
    let elev = Math.atan2(-ly, Math.abs(lx)) / DEG;
    if (elev < J.CANCEL_ANGLE) return { vx: 0, vy: 0, power: 0, valid: false, cancel: true };
    elev = Math.max(elev, J.MIN_ANGLE);

    const power = Math.min(1, (len - J.DEAD_ZONE) / Math.max(1, fullPull - J.DEAD_ZONE));
    const speed = J.MIN_SPEED + (J.MAX_SPEED - J.MIN_SPEED) * power;
    const dir = lx >= 0 ? 1 : -1;
    return {
      vx: Math.cos(elev * DEG) * speed * (Math.abs(lx) < 1e-6 ? 0 : dir),
      vy: -Math.sin(elev * DEG) * speed,
      power,
      valid: true,
      cancel: false,
    };
  }

  /**
   * Нарисовать траекторию.
   * @param start  тело героя {x, y}
   * @param launch вектор из compute()
   * @param full   бустер «Точный прицел»: весь путь до приземления
   */
  drawPreview(start, launch, world, t, full, deathY) {
    const g = this.g;
    g.clear();
    g.setAlpha(1);
    this._fading = false;

    const maxTime = full ? A.FULL_TIME : A.PREVIEW_TIME;
    const res = simulate(start, launch.vx, launch.vy, world, t, maxTime, deathY, this.res);
    const n = res.points.length / 2 - 1;
    const skip = 26;   // не рисуем точки внутри самого героя

    if (full) {
      const bad = res.swallow || res.fell;
      this._dots(0, n, skip, Infinity, COLOR_FULL, 0.95, false);
      for (const h of res.hits) this._ricochetMark(h.x, h.y, COLOR_FULL);
      if (res.land) {
        g.lineStyle(4, COLOR_FULL, 1);
        g.strokeEllipse(res.land.x, res.land.y, 56, 16);
        g.fillStyle(COLOR_FULL, 0.25);
        g.fillEllipse(res.land.x, res.land.y, 56, 16);
      } else if (bad && n > 0) {
        const x = res.points[n * 2], y = res.points[n * 2 + 1];
        g.lineStyle(5, COLOR_BAD, 1);
        g.lineBetween(x - 12, y - 12, x + 12, y + 12);
        g.lineBetween(x - 12, y + 12, x + 12, y - 12);
      }
      return;
    }

    // Обычный прицел — один гаснущий вектор. Стена на его видимой длине —
    // вектор отражается от неё и гаснет дальше. Что дальше этой длины, не
    // показываем: иначе прицел подсказывал бы рикошеты через весь экран.
    const last = this._dots(0, n, skip, A.PREVIEW_LEN, COLOR_PATH, 0.95, true);
    for (const h of res.hits) {
      if (h.side === 0) continue;             // шапка мини-стены — не рикошет
      if (h.i > last) break;                  // удар дальше видимой длины
      const k = 1 - Math.max(0, this._cum[h.i] - skip) / A.PREVIEW_LEN;
      this._ricochetMark(h.x, h.y, COLOR_PATH, 0.95 * Math.pow(k, 0.85), 0.55 + 0.45 * k);
    }
  }

  /**
   * Точки вдоль пути от индекса i0: пропустить skip ед., нарисовать maxLen.
   * Попутно копит длину пути до каждой точки в this._cum.
   * @returns индекс последней точки в пределах видимой длины
   */
  _dots(i0, i1, skip, maxLen, color, alpha, fade) {
    const pts = this.res.points;
    const cum = this._cum;
    const g = this.g;
    let dist = 0;
    let next = skip;
    cum[i0] = 0;
    let i = i0 + 1;
    for (; i <= i1; i++) {
      dist += Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
      cum[i] = dist;
      if (dist - skip > maxLen) break;
      if (dist < next) continue;
      next += A.DOT_STEP;
      const k = fade ? 1 - (dist - skip) / maxLen : 1;
      g.fillStyle(color, alpha * Math.pow(k, 0.85));
      g.fillCircle(pts[i * 2], pts[i * 2 + 1], 2.5 + 3.5 * k);
    }
    return i - 1;
  }

  /** Вспышка в точке удара о стену. */
  _ricochetMark(x, y, color, alpha = 0.95, scale = 1) {
    const g = this.g;
    g.lineStyle(3, color, alpha);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      g.lineBetween(x + Math.cos(a) * 7 * scale, y + Math.sin(a) * 7 * scale, x + Math.cos(a) * 16 * scale, y + Math.sin(a) * 16 * scale);
    }
    g.fillStyle(color, alpha);
    g.fillCircle(x, y, 5 * scale);
  }

  clearPreview() {
    if (!this._fading) this.g.clear();
  }

  /**
   * Кольцо в точке касания и «резинка» до пальца.
   * @param toWorld (cssX, cssY) → {x, y} мира
   */
  drawPull(toWorld, launch, unitsPerCss) {
    const p = this.pull;
    p.clear();
    const a = toWorld(this.sx, this.sy);
    const b = toWorld(this.cx, this.cy);
    const bad = launch && launch.cancel;
    const color = bad ? COLOR_BAD : 0xffffff;
    p.lineStyle(3 * unitsPerCss, color, 0.4);
    p.strokeCircle(a.x, a.y, 20 * unitsPerCss);
    if (launch) {
      p.lineStyle(4 * unitsPerCss, color, bad ? 0.55 : 0.28 + 0.3 * launch.power);
      p.lineBetween(a.x, a.y, b.x, b.y);
      p.fillStyle(color, 0.5);
      p.fillCircle(b.x, b.y, 7 * unitsPerCss);
    }
  }

  /** После прыжка вектор не исчезает мгновенно, а гаснет. */
  fadeOut() {
    this._fading = true;
    this.pull.clear();
  }

  update(dt) {
    if (!this._fading) return;
    const a = this.g.alpha - dt / A.FADE_OUT;
    if (a <= 0) {
      this._fading = false;
      this.g.clear();
      this.g.setAlpha(1);
    } else {
      this.g.setAlpha(a);
    }
  }
}
