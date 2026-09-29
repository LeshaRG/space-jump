/**
 * Generator — процедурная генерация уровня рядами снизу вверх.
 *
 * Ряд — одна высота. В нём либо одна обычная платформа, либо «выбор»:
 * лёгкая платформа + сложная с монетками (маленькая, ломающаяся или
 * «карман» у стены, куда попадают только рикошетом). Монетки и алмазы
 * появляются ТОЛЬКО на сложных платформах, и у каждой сложной есть лёгкая
 * пара; если игрок встал на лёгкую — сложная исчезает (см. GameScene.onLand).
 *
 * Шаг рядов не превышает досягаемости прыжка, поэтому лёгкий путь
 * наверх существует всегда.
 */
import CONFIG from "../config.js";

const G  = CONFIG.GEN;
const HZ = CONFIG.HAZARDS;
const FIELD_W = CONFIG.VIEW.FIELD_W;
const HALF = FIELD_W / 2;

const lerp = (a, b, t) => a + (b - a) * t;

/** Расстояние от точки до отрезка. */
function segDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const len2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2));
  return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
}

/** Детерминированный ГПСЧ: один сид — один и тот же уровень (удобно для отладки). */
export function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export default class Generator {
  constructor(world, rng) {
    this.world = world;
    this.R = rng;
    this.y = 0;                     // верх последнего сгенерированного ряда
    this.row = 0;
    this.prevRow = [world.ground];
    this.lastChoice = -10;
    this.lastHole = -10;
    this.lastTurret = -10;
    this.lastX2 = -100;
    this.pocketShown = false;
    this.afterPocket = false;
  }

  /** Сложность 0..1 по высоте. */
  diff(h) {
    return Math.min(1, Math.max(0, h / G.DIFF_HEIGHT));
  }

  rand(a, b) { return a + (b - a) * this.R(); }
  pick(range) { return this.rand(range[0], range[1]); }
  /** Диапазон, который сужается/сдвигается с ростом сложности: [[старт], [финиш]]. */
  scaled(pair, d) { return this.rand(lerp(pair[0][0], pair[1][0], d), lerp(pair[0][1], pair[1][1], d)); }

  /** Генерировать ряды, пока не заполним мир до высоты yLimit (y вверх уменьшается). */
  fill(yLimit) {
    while (this.y > yLimit) this.nextRow();
  }

  nextRow() {
    const d = this.diff(-this.y);
    const row = ++this.row;
    const kind = this._rowKind(row, -this.y, d);
    const pocket = kind === "pocket" || kind === "pocket_crumble";
    // Верх стенки кармана должен быть в досягаемости прыжка — шаг такого ряда
    // меньше. Следующий ряд тоже ближе: из кармана прыгают через стенку.
    let gap = pocket ? this.pick(G.POCKET_GAP) : this.scaled(G.GAP, d);
    if (this.afterPocket) gap = Math.min(gap, 240);
    this.afterPocket = pocket;
    const y = Math.round(this.y - gap);
    const h = -y;
    const platforms = [];

    if (kind === "single") {
      const w = this.scaled(G.WIDTH, d);
      const x = this.rand(w / 2 + 10, FIELD_W - w / 2 - 10);
      const move = this._move(h, d, x, w / 2, 0, FIELD_W);
      const p = this.world.addPlatform({ kind: "normal", x, y, w, move, slot: move ? "platform_moving" : "platform" });
      platforms.push(p);
      this._maybePickup(p, h, row);
    } else {
      // Выбор: сложная с монетками на одной половине, лёгкая — на другой.
      // Карман — на стороне, противоположной прошлой надёжной платформе:
      // снизу в него не попасть (сплошное дно), нужен заход по дуге с рикошетом
      const prevSafe = this.prevRow.find(p => !p.hard) ?? this.world.ground;
      const side = pocket && Math.abs(prevSafe.baseX - HALF) > 20
        ? (prevSafe.baseX > HALF ? -1 : 1)
        : (this.R() < 0.5 ? -1 : 1);
      const ew = this.scaled(G.WIDTH, d) * 0.9;
      const [lo, hi] = this._half(-side, ew / 2);
      const ex = this.rand(lo, hi);
      const move = this._move(h, d, ex, ew / 2, -side < 0 ? 0 : HALF + 10, -side < 0 ? HALF - 10 : FIELD_W);
      const easy = this.world.addPlatform({ kind: "normal", x: ex, y, w: ew, move, slot: move ? "platform_moving" : "platform" });
      const hy = pocket
        ? Math.round(y + this.R() * 30)                       // карман — только ниже ряда, не выше
        : Math.round(y + (this.R() * 2 - 1) * G.PAIR_DY);
      const group = this._hard(kind, side, hy, d, h);
      easy.pairGroup = group;
      platforms.push(easy, group.platform);
      this.lastChoice = row;
    }

    this._maybeHole(this.y, y, h, d, row, platforms);
    this._maybeTurret(y, h, d, row, platforms);

    this.prevRow = platforms;
    this.y = y;
  }

  /* ─── Вид ряда ─── */

  _rowKind(row, h, d) {
    // Первые ряды — обучение: сначала просто прыжки, потом первая монетка,
    // первая ломающаяся платформа, первый «карман»
    if (row <= 3 || row === 5 || row === 6) return "single";
    if (row === 4) return "small";
    if (row === 7) return "crumble";
    if (row - this.lastChoice < 2) return "single";
    if (!this.pocketShown && h >= G.POCKET_FROM) {
      this.pocketShown = true;
      return "pocket";
    }
    if (this.R() < lerp(G.CHOICE[0], G.CHOICE[1], d)) return this._hardKind(h);
    return "single";
  }

  _hardKind(h) {
    const opts = [["small", 1]];
    if (h >= G.CRUMBLE_FROM) opts.push(["crumble", 1]);
    if (h >= G.POCKET_FROM)  opts.push(["pocket", 1.2]);
    if (h >= G.COMBO_FROM)   opts.push(["small_crumble", 0.6], ["pocket_crumble", 0.5]);
    const total = opts.reduce((s, o) => s + o[1], 0);
    let r = this.R() * total;
    for (const [k, w] of opts) { if ((r -= w) <= 0) return k; }
    return opts[0][0];
  }

  /* ─── Сложные платформы ─── */

  _hard(kind, side, y, d, h) {
    const group = { platform: null, walls: [], gone: false };
    const W = this.world;
    const pocket = kind === "pocket" || kind === "pocket_crumble";
    // Алмаз встаёт на место верхней монетки (последней добавленной)
    const DM = G.DIAMOND;
    const diamond = h >= DM.FROM && this.R() < lerp(DM.CHANCE[0], DM.CHANCE[1], d) * (pocket ? DM.POCKET : 1);
    let p;

    if (pocket) {
      // «Карман» у стены: платформа в узком проёме между мини-стеной и стеной поля.
      // Прямым прыжком туда не попасть — только рикошетом от стены.
      const pw = this.pick(G.POCKET_W);
      const x1 = side > 0 ? FIELD_W - pw : 0;
      const crumble = kind === "pocket_crumble";
      p = W.addPlatform({
        kind: "pocket", x: x1 + pw / 2, y, w: pw, hard: true, solidBottom: true, crumble,
        slot: crumble ? "platform_crumble" : "platform_small",
      });
      const wallH = this.pick(G.POCKET_WALL);
      const wx1 = side > 0 ? x1 - G.WALL_T : x1 + pw;
      group.walls.push(W.addWall(wx1, y - wallH, wx1 + G.WALL_T, y + G.POCKET_BELOW));
      const n = crumble ? 3 : 2;
      for (let i = 0; i < n; i++) W.addCoin(p, 0, -30 - i * 42, diamond && i === n - 1 ? "diamond" : "coin");
    } else {
      const small = kind === "small" || kind === "small_crumble";
      const crumble = kind === "crumble" || kind === "small_crumble";
      const w = small ? this.pick(G.SMALL_W) : this.pick(G.CRUMBLE_W);
      const [lo, hi] = this._half(side, w / 2);
      p = W.addPlatform({
        kind: small ? "small" : "crumble", x: this.rand(lo, hi), y, w, hard: true, crumble,
        slot: crumble ? "platform_crumble" : "platform_small",
      });
      const n = kind === "small_crumble" ? 2 : (crumble && d > 0.5 ? 2 : 1);
      const type = i => (diamond && i === n - 1 ? "diamond" : "coin");
      if (n === 1) W.addCoin(p, 0, -30, type(0));
      else if (w / 2 < 40) for (let i = 0; i < n; i++) W.addCoin(p, 0, -30 - i * 40, type(i));
      else for (let i = 0; i < n; i++) W.addCoin(p, (i - (n - 1) / 2) * 36, -30, type(i));
    }

    p.group = group;
    group.platform = p;
    return group;
  }

  /* ─── Помощники ─── */

  /** Диапазон центров для платформы полуширины hw в левой (-1) или правой (1) половине. */
  _half(side, hw) {
    return side < 0
      ? [hw + 10, Math.max(hw + 10, HALF - 24)]
      : [Math.min(FIELD_W - hw - 10, HALF + 24), FIELD_W - hw - 10];
  }

  /** Плавающая платформа: синусоида в пределах [minX, maxX]. */
  _move(h, d, x, hw, minX, maxX) {
    if (h < G.MOVING_FROM || this.R() > lerp(G.MOVING[0], G.MOVING[1], d)) return null;
    const room = Math.min(x - hw - minX, maxX - (x + hw));
    const amp = Math.min(this.pick(G.MOVE_AMP), room);
    if (amp < 24) return null;
    return { amp, w: (Math.PI * 2) / this.pick(G.MOVE_PERIOD), phase: this.R() * Math.PI * 2 };
  }

  _maybePickup(p, h, row) {
    if (p.move) return;
    let type = null;
    const X2 = G.X2;
    if (row === 5) type = "aim";   // первый бустер попадается рано — знакомство
    else if (h >= X2.FROM && row - this.lastX2 >= X2.GAP_ROWS && this.R() < X2.CHANCE) {
      type = "x2";                 // «монеты ×2 на минуту» — срабатывает сразу, в запас не идёт
      this.lastX2 = row;
    } else if (this.R() < G.PICKUP) {
      const weights = { ...CONFIG.BOOSTERS.PICK_WEIGHTS };
      if (h < G.POCKET_FROM) weights.breaker = 0;   // до «карманов» ломать нечего
      const total = Object.values(weights).reduce((s, v) => s + v, 0);
      let r = this.R() * total;
      for (const [k, w] of Object.entries(weights)) { if ((r -= w) <= 0) { type = k; break; } }
    }
    if (type) this.world.addPickup(p, type);
  }

  /**
   * Чёрная дыра в промежутке между рядами. Не вплотную к платформам (CLEAR),
   * но рядом с прямым путём между надёжными платформами: «просто прыгнуть
   * вверх» уже не выйдет — дыра тянет траекторию на себя, её надо облетать.
   */
  _maybeHole(yLow, yHigh, h, d, row, platforms) {
    const C = HZ.HOLE;
    if (h < C.FROM || row - this.lastHole < C.GAP_ROWS || this.R() > lerp(C.CHANCE[0], C.CHANCE[1], d)) return;
    if (yLow - yHigh < 200) return;
    const cy = (yLow + yHigh) / 2;
    const near = [...this.prevRow, ...platforms];
    const a = this.prevRow.find(p => !p.hard) ?? this.world.ground;
    const b = platforms.find(p => !p.hard) ?? platforms[0];
    const hard = platforms.find(p => p.hard);
    let best = null;
    let bestScore = Infinity;
    for (let i = 0; i < 16; i++) {
      const cx = this.rand(80, FIELD_W - 80);
      const clear = near.every(p => {
        const reach = p.halfW + (p.move ? p.move.amp : 0);
        const dx = Math.max(0, Math.abs(cx - p.baseX) - reach);
        const dy = cy - p.top;
        return dx * dx + dy * dy > C.CLEAR * C.CLEAR;
      });
      if (!clear) continue;
      // Путь к сложной платформе дыра не перекрывает: монетки должны оставаться достижимыми
      if (hard && segDist(cx, cy, a.baseX, a.top - 46, hard.baseX, hard.top - 46) < C.HARD_CLEAR) continue;
      const dist = segDist(cx, cy, a.baseX, a.top - 46, b.baseX, b.top - 46);
      const score = Math.abs(dist - C.PATH_DIST);
      if (score < bestScore) { bestScore = score; best = cx; }
    }
    if (best === null) return;
    this.world.addHole(best, cy);
    this.lastHole = row;
  }

  /** Турель на боковой стене — не на стороне «кармана». */
  _maybeTurret(y, h, d, row, platforms) {
    const C = HZ.TURRET;
    if (h < C.FROM || row - this.lastTurret < 5 || this.R() > lerp(C.CHANCE[0], C.CHANCE[1], d)) return;
    let side = this.R() < 0.5 ? -1 : 1;
    const pocketSide = platforms.find(p => p.kind === "pocket");
    if (pocketSide && Math.sign(pocketSide.baseX - HALF) === side) side = -side;
    this.world.addTurret(side, y - 70 - this.R() * 70);
    this.lastTurret = row;
  }
}
