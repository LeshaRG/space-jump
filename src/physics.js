/**
 * physics.js — движение героя.
 *
 * Одна и та же функция шага двигает героя в игре и считает линию прицела.
 * Шаг фиксированный, платформы двигаются как функция времени, гравитация
 * чёрных дыр та же — поэтому предсказанная траектория совпадает с реальным
 * прыжком до пикселя (пока не вмешаются метеорит или ракета).
 *
 * Тело: { x, y, vx, vy }, где (x, y) — середина подошв.
 * Мир:  { fieldW, platforms[], walls[], holes[] } — живые объекты уровня.
 */
import CONFIG from "./config.js";

const { GRAVITY, MAX_FALL, WALL_BOUNCE, CAP_BOUNCE, HEAD_BUMP, SLIDE_DECEL, STEP } = CONFIG.PHYS;
const HW   = CONFIG.HERO.W / 2;
const HH   = CONFIG.HERO.H;
const FOOT = CONFIG.HERO.FOOT;
const EPS  = 0.01;

export const EV_NONE    = 0;
export const EV_LAND    = 1;
export const EV_SWALLOW = 2;

/** Центр платформы по X в момент t (плавающие платформы — синусоида). */
export function platformX(p, t) {
  return p.move ? p.baseX + p.move.amp * Math.sin(p.move.w * t + p.move.phase) : p.baseX;
}

/** Запись о столкновении со стеной — для эффектов и для отрисовки рикошета в прицеле. */
function recordHit(out, x, y, b, side) {
  out.hitCount++;
  if (out.hits) out.hits.push({ x, y, vx: b.vx, vy: b.vy, side, i: 0 });
}

/**
 * Один шаг полёта.
 * @param {object} b   тело героя (меняется на месте)
 * @param {object} w   мир
 * @param {number} t   время мира в начале шага
 * @param {number} dt  длительность шага
 * @param {object} out { ev, platform, hole, hitCount, hits|null } — результат шага
 */
export function stepAir(b, w, t, dt, out) {
  out.ev = EV_NONE;
  out.hitCount = 0;

  // ── Силы: гравитация и чёрные дыры ──
  let ax = 0;
  let ay = GRAVITY;
  const cy = b.y - HH / 2;
  for (let i = 0; i < w.holes.length; i++) {
    const h = w.holes[i];
    if (!h.alive) continue;
    const dx = h.x - b.x;
    const dy = h.y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 > h.range * h.range) continue;
    const d = Math.sqrt(d2) || 1;
    if (d < h.core) {
      out.ev = EV_SWALLOW;
      out.hole = h;
      return out;
    }
    // Притяжение ~1/r², плавно гаснет к краю зоны, чтобы не было «ступеньки»
    const k = 1 - d / h.range;
    const a = Math.min(h.strength / d2, h.maxAcc) * k * (2 - k);
    ax += (dx / d) * a;
    ay += (dy / d) * a;
  }
  b.vx += ax * dt;
  b.vy = Math.min(b.vy + ay * dt, MAX_FALL);

  const px = b.x;
  const py = b.y;
  b.x += b.vx * dt;
  b.y += b.vy * dt;

  // ── Боковые стены поля: рикошет ──
  if (b.x - HW < 0) {
    b.x = HW;
    b.vx = Math.abs(b.vx) * WALL_BOUNCE;
    recordHit(out, 0, b.y - HH / 2, b, 1);
  } else if (b.x + HW > w.fieldW) {
    b.x = w.fieldW - HW;
    b.vx = -Math.abs(b.vx) * WALL_BOUNCE;
    recordHit(out, w.fieldW, b.y - HH / 2, b, -1);
  }

  // ── Мини-стены у сложных платформ ──
  for (let i = 0; i < w.walls.length; i++) {
    const s = w.walls[i];
    if (!s.alive) continue;
    if (b.x + HW <= s.x1 || b.x - HW >= s.x2 || b.y <= s.y1 || b.y - HH >= s.y2) continue;

    if (px + HW <= s.x1 + EPS) {                 // слева — рикошет влево
      b.x = s.x1 - HW;
      b.vx = -Math.abs(b.vx) * WALL_BOUNCE;
      recordHit(out, s.x1, b.y - HH / 2, b, -1);
    } else if (px - HW >= s.x2 - EPS) {          // справа — рикошет вправо
      b.x = s.x2 + HW;
      b.vx = Math.abs(b.vx) * WALL_BOUNCE;
      recordHit(out, s.x2, b.y - HH / 2, b, 1);
    } else if (py <= s.y1 + EPS) {               // сверху — отскок от шапки стены
      b.y = s.y1;
      b.vy = -Math.abs(b.vy) * CAP_BOUNCE;
      b.vx += (b.x < (s.x1 + s.x2) / 2 ? -1 : 1) * 140;
      recordHit(out, b.x, s.y1, b, 0);
    } else {                                     // снизу — стукнулся головой
      b.y = s.y2 + HH;
      b.vy = Math.abs(b.vy) * HEAD_BUMP;
    }
  }

  // ── Платформы ──
  if (b.vy > 0) {
    // Проходимы снизу; приземление — когда подошвы пересекли верх настила
    let best = null;
    for (let i = 0; i < w.platforms.length; i++) {
      const p = w.platforms[i];
      if (!p.alive || !p.solid) continue;
      if (py > p.top + EPS || b.y < p.top) continue;
      const cx = platformX(p, t + dt);
      if (b.x + FOOT <= cx - p.halfW || b.x - FOOT >= cx + p.halfW) continue;
      if (!best || p.top < best.top) best = p;
    }
    if (best) {
      b.y = best.top;
      out.ev = EV_LAND;
      out.platform = best;
      return out;
    }
  } else if (b.vy < 0) {
    // У «карманов» сплошное дно: снизу в них не запрыгнуть
    for (let i = 0; i < w.platforms.length; i++) {
      const p = w.platforms[i];
      if (!p.alive || !p.solid || !p.solidBottom) continue;
      const head0 = py - HH;
      const head1 = b.y - HH;
      if (head0 < p.bottom - EPS || head1 > p.bottom) continue;
      const cx = platformX(p, t + dt);
      if (b.x + HW <= cx - p.halfW || b.x - HW >= cx + p.halfW) continue;
      b.y = p.bottom + HH;
      b.vy = Math.abs(b.vy) * HEAD_BUMP;
    }
  }
  return out;
}

/**
 * Шаг стояния на платформе: скольжение и перенос плавающей платформой.
 * @returns {boolean} true — герой соскользнул с края
 */
export function stepStand(b, w, t, dt) {
  const p = b.platform;

  if (b.slide !== 0) {
    const dec = SLIDE_DECEL * dt;
    b.slide = Math.abs(b.slide) <= dec ? 0 : b.slide - Math.sign(b.slide) * dec;
    b.localX += b.slide * dt;
  }

  const cx = platformX(p, t + dt);
  b.x = cx + b.localX;
  b.y = p.top;

  // Стены поля и мини-стены не пускают (важно для земли и «карманов»)
  let pushed = false;
  if (b.x - HW < 0) { b.x = HW; pushed = true; }
  else if (b.x + HW > w.fieldW) { b.x = w.fieldW - HW; pushed = true; }
  for (let i = 0; i < w.walls.length; i++) {
    const s = w.walls[i];
    if (!s.alive) continue;
    if (b.x + HW <= s.x1 || b.x - HW >= s.x2 || b.y <= s.y1 || b.y - HH >= s.y2) continue;
    b.x = b.x < (s.x1 + s.x2) / 2 ? s.x1 - HW : s.x2 + HW;
    pushed = true;
  }
  if (pushed) {
    b.localX = b.x - cx;
    b.slide = 0;
  }

  return Math.abs(b.localX) > p.halfW + FOOT;
}

/**
 * Прогноз траектории для прицела.
 * @param res { points: [x0,y0,x1,y1,...] (центр тела), hits: [], land, swallow, fell }
 */
export function simulate(start, vx, vy, w, t0, maxTime, deathY, res) {
  res.points.length = 0;
  res.hits.length = 0;
  res.land = null;
  res.swallow = null;
  res.fell = false;

  const b = { x: start.x, y: start.y, vx, vy };
  const out = { ev: EV_NONE, platform: null, hole: null, hitCount: 0, hits: res.hits };
  const steps = Math.ceil(maxTime / STEP);

  res.points.push(b.x, b.y - HH / 2);
  for (let i = 0; i < steps; i++) {
    const before = res.hits.length;
    stepAir(b, w, t0 + i * STEP, STEP, out);
    for (let k = before; k < res.hits.length; k++) res.hits[k].i = res.points.length / 2;
    res.points.push(b.x, b.y - HH / 2);

    if (out.ev === EV_LAND) {
      res.land = { x: b.x, y: b.y, platform: out.platform, time: (i + 1) * STEP };
      break;
    }
    if (out.ev === EV_SWALLOW) {
      res.swallow = out.hole;
      break;
    }
    if (b.y - HH > deathY) {
      res.fell = true;
      break;
    }
  }
  return res;
}

export const HERO_HALF_W = HW;
export const HERO_H = HH;
