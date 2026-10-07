/**
 * placeholders.js — процедурные текстуры-заглушки.
 *
 * Всё, для чего ещё нет арта, рисуется здесь через Canvas2D при загрузке:
 * монеты, бустеры, метеорит, чёрная дыра, турель, ракета, стены, фон,
 * частицы. Когда художник положит настоящий спрайт в соответствующий слот
 * (см. art.js и README), заглушка перестанет использоваться.
 *
 * Стиль подогнан под арт героя: толстый тёмный контур, голубое свечение.
 */

const OUTLINE = "#151528";
const CYAN    = "#46dcff";

/* ─── Утилиты ─────────────────────────────────────────── */

function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function rrect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Детерминированный ГПСЧ — заглушки одинаковые от запуска к запуску. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Неровный круг — для камней. */
function rockPath(ctx, cx, cy, r, rand, n = 11, jag = 0.18) {
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (1 - jag / 2 + rand() * jag);
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function glowCircle(ctx, x, y, r, color, alpha = 1) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.globalAlpha = alpha;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/* ─── Частицы ─────────────────────────────────────────── */

function dot(ctx, w) {
  const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.45, "rgba(255,255,255,0.85)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, w);
}

function spark(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(0.7, "rgba(255,255,255,1)");
  g.addColorStop(1, "rgba(255,255,255,0.2)");
  ctx.fillStyle = g;
  rrect(ctx, 0, 0, w, h, h / 2);
  ctx.fill();
}

function smoke(ctx, w) {
  const r = rng(7);
  for (let i = 0; i < 6; i++) {
    const x = w / 2 + (r() - 0.5) * w * 0.3;
    const y = w / 2 + (r() - 0.5) * w * 0.3;
    glowCircle(ctx, x, y, w * (0.25 + r() * 0.15), "rgba(255,255,255,0.55)");
  }
}

function star4(ctx, w) {
  const c = w / 2;
  glowCircle(ctx, c, c, c * 0.6, "rgba(255,255,255,0.6)");
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.moveTo(c, 0);
  ctx.quadraticCurveTo(c, c, w, c);
  ctx.quadraticCurveTo(c, c, c, w);
  ctx.quadraticCurveTo(c, c, 0, c);
  ctx.quadraticCurveTo(c, c, c, 0);
  ctx.fill();
}

function debris(ctx, w) {
  const r = rng(11);
  rockPath(ctx, w / 2, w / 2, w * 0.4, r, 7, 0.4);
  ctx.fillStyle = "#5d5a86";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
}

function ring(ctx, w) {
  const c = w / 2;
  ctx.lineWidth = 10;
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.beginPath();
  ctx.arc(c, c, c - 12, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 5;
  ctx.strokeStyle = "#fff";
  ctx.beginPath();
  ctx.arc(c, c, c - 12, 0, Math.PI * 2);
  ctx.stroke();
}

function chevron(ctx, w) {
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = w * 0.18;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(w * 0.3, w * 0.2);
  ctx.lineTo(w * 0.72, w * 0.5);
  ctx.lineTo(w * 0.3, w * 0.8);
  ctx.stroke();
}

/* ─── Предметы ────────────────────────────────────────── */

function coin(ctx, w) {
  const c = w / 2;
  const R = c - 3;
  ctx.fillStyle = OUTLINE;
  ctx.beginPath();
  ctx.arc(c, c, R, 0, Math.PI * 2);
  ctx.fill();
  const g = ctx.createRadialGradient(c - R * 0.3, c - R * 0.35, R * 0.1, c, c, R);
  g.addColorStop(0, "#fff3a6");
  g.addColorStop(0.55, "#ffcb2e");
  g.addColorStop(1, "#f08a00");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(c, c, R - 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(170,90,0,0.8)";
  ctx.beginPath();
  ctx.arc(c, c, R - 11, 0, Math.PI * 2);
  ctx.stroke();
  // Звезда
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? R * 0.22 : R * 0.5;
    ctx.lineTo(c + Math.cos(a) * rr, c + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = "#fff6c4";
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = "#b86a00";
  ctx.stroke();
  // Блик
  ctx.strokeStyle = "rgba(255,255,255,0.75)";
  ctx.lineWidth = 3.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(c, c, R - 8, Math.PI * 1.1, Math.PI * 1.45);
  ctx.stroke();
}

/** Алмаз: огранка «кристалл» — корона сверху, павильон снизу. */
function diamond(ctx, w) {
  const c = w / 2;
  glowCircle(ctx, c, c, c, "rgba(120,235,255,0.55)");
  const top = w * 0.22, mid = w * 0.42, bot = w * 0.9;
  const L = w * 0.1, R = w * 0.9, tl = w * 0.3, tr = w * 0.7, ml = w * 0.4, mr = w * 0.6;
  const poly = (pts, fill) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };
  // Грани короны и павильона разной яркости — камень «играет»
  poly([[tl, top], [c, top], [ml, mid]], "#c9f8ff");
  poly([[c, top], [tr, top], [mr, mid]], "#8fe9ff");
  poly([[c, top], [mr, mid], [ml, mid]], "#effdff");
  poly([[tl, top], [ml, mid], [L, mid]], "#6fdcff");
  poly([[tr, top], [R, mid], [mr, mid]], "#46c0f0");
  poly([[L, mid], [ml, mid], [c, bot]], "#39a9e6");
  poly([[ml, mid], [mr, mid], [c, bot]], "#86e3ff");
  poly([[mr, mid], [R, mid], [c, bot]], "#2586cc");
  // Рёбра граней
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(L, mid); ctx.lineTo(R, mid);
  ctx.moveTo(ml, mid); ctx.lineTo(c, bot); ctx.moveTo(mr, mid); ctx.lineTo(c, bot);
  ctx.stroke();
  // Контур
  ctx.beginPath();
  [[tl, top], [tr, top], [R, mid], [c, bot], [L, mid]].forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.lineJoin = "round";
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  // Искра
  ctx.save();
  ctx.translate(w * 0.3, w * 0.3);
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  const s = w * 0.11;
  ctx.moveTo(0, -s); ctx.quadraticCurveTo(0, 0, s, 0); ctx.quadraticCurveTo(0, 0, 0, s);
  ctx.quadraticCurveTo(0, 0, -s, 0); ctx.quadraticCurveTo(0, 0, 0, -s);
  ctx.fill();
  ctx.restore();
}

/** Пузырь «монеты ×2» — золотой, чтобы не путать с бустерами из запаса. */
function pickupX2(ctx, w) {
  const c = w / 2;
  const R = c - 6;
  glowCircle(ctx, c, c, c, "rgba(255,200,60,0.6)");
  const g = ctx.createRadialGradient(c - R * 0.35, c - R * 0.4, R * 0.1, c, c, R);
  g.addColorStop(0, "#fff0a0");
  g.addColorStop(0.55, "#ffc21a");
  g.addColorStop(1, "#c46a00");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(c, c, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  // Надпись ×2
  ctx.font = `900 ${Math.round(w * 0.4)}px "Trebuchet MS", "Segoe UI", Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = 6;
  ctx.strokeStyle = "#5a2a00";
  ctx.strokeText("×2", c, c + 2);
  ctx.fillStyle = "#fff";
  ctx.fillText("×2", c, c + 2);
  ctx.strokeStyle = "rgba(255,255,255,0.75)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(c, c, R - 6, Math.PI * 1.1, Math.PI * 1.4);
  ctx.stroke();
}

/** Пузырь бустера с иконкой. */
function pickup(kind) {
  return (ctx, w) => {
    const c = w / 2;
    const R = c - 6;
    glowCircle(ctx, c, c, c, "rgba(70,220,255,0.55)");
    const g = ctx.createRadialGradient(c - R * 0.35, c - R * 0.4, R * 0.1, c, c, R);
    g.addColorStop(0, "#6fe6ff");
    g.addColorStop(1, "#1b5fb8");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c, c, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();

    ctx.save();
    ctx.translate(c, c);
    const s = R / 13;
    ctx.scale(s, s);
    ctx.translate(-12, -12);
    ctx.strokeStyle = "#fff";
    ctx.fillStyle = "#fff";
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    PICKUP_ICONS[kind](ctx);
    ctx.restore();

    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(c, c, R - 6, Math.PI * 1.1, Math.PI * 1.4);
    ctx.stroke();
  };
}

/** Иконки бустеров в сетке 24×24 — повторяют icons.js. */
const PICKUP_ICONS = {
  jetpack(ctx) {
    rrect(ctx, 4.5, 3.5, 6, 11.5, 3); ctx.stroke();
    rrect(ctx, 13.5, 3.5, 6, 11.5, 3); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(10.5, 8); ctx.lineTo(13.5, 8); ctx.stroke();
    for (const x of [6, 15]) {
      ctx.fillStyle = "#ffb347";
      ctx.beginPath();
      ctx.moveTo(x, 16.5);
      ctx.quadraticCurveTo(x, 19, x + 1.5, 21.5);
      ctx.quadraticCurveTo(x + 3, 19, x + 3, 16.5);
      ctx.closePath();
      ctx.fill();
    }
  },
  teleport(ctx) {
    ctx.beginPath(); ctx.ellipse(12, 18.5, 7.5, 2.6, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(12, 14.5); ctx.lineTo(12, 3.8); ctx.moveTo(8.4, 7.4); ctx.lineTo(12, 3.8); ctx.lineTo(15.6, 7.4); ctx.stroke();
    ctx.beginPath(); ctx.arc(5.3, 10, 1.2, 0, Math.PI * 2); ctx.arc(18.7, 11.5, 1.2, 0, Math.PI * 2); ctx.fill();
  },
  aim(ctx) {
    for (let i = 0; i <= 6; i++) {
      const t = i / 7;
      const x = (1 - t) * (1 - t) * 3.5 + 2 * (1 - t) * t * 9.5 + t * t * 16;
      const y = (1 - t) * (1 - t) * 20.5 + 2 * (1 - t) * t * -1.5 + t * t * 14;
      ctx.beginPath(); ctx.arc(x, y, 1.1, 0, Math.PI * 2); ctx.fill();
    }
    ctx.beginPath(); ctx.arc(17.5, 16.5, 3.4, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(17.5, 16.5, 1, 0, Math.PI * 2); ctx.fill();
  },
  breaker(ctx) {
    rrect(ctx, 3.5, 3.5, 9, 17, 1.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(8.5, 3.5); ctx.lineTo(7, 8.5); ctx.lineTo(10, 11); ctx.lineTo(7.5, 15); ctx.lineTo(9, 20.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(16, 8.5); ctx.lineTo(20, 7); ctx.moveTo(16.2, 12); ctx.lineTo(20.5, 12); ctx.moveTo(16, 15.5); ctx.lineTo(20, 17); ctx.stroke();
  },
};

/* ─── Опасности ───────────────────────────────────────── */

function meteor(ctx, w) {
  const c = w / 2;
  const r = rng(5);
  glowCircle(ctx, c, c, c, "rgba(255,120,40,0.55)");
  rockPath(ctx, c, c, c * 0.72, r, 12, 0.2);
  const g = ctx.createRadialGradient(c - 10, c - 12, 4, c, c, c * 0.75);
  g.addColorStop(0, "#9b857a");
  g.addColorStop(1, "#4b3a3a");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  for (const [x, y, rr] of [[c - 10, c + 6, 7], [c + 12, c - 8, 5], [c + 6, c + 14, 4]]) {
    ctx.fillStyle = "rgba(40,28,30,0.55)";
    ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(255,210,170,0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, rr, Math.PI * 0.2, Math.PI * 1.1); ctx.stroke();
  }
  // Раскалённый край со стороны полёта (по умолчанию — снизу-справа)
  ctx.strokeStyle = "rgba(255,170,60,0.9)";
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(c, c, c * 0.62, -0.2, Math.PI * 0.75); ctx.stroke();
}

function holeDisk(ctx, w) {
  const c = w / 2;
  const g = ctx.createRadialGradient(c, c, c * 0.3, c, c, c);
  g.addColorStop(0, "rgba(255,236,190,1)");
  g.addColorStop(0.36, "rgba(255,150,70,0.95)");
  g.addColorStop(0.62, "rgba(190,70,255,0.6)");
  g.addColorStop(1, "rgba(80,30,160,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(c, c, c, 0, Math.PI * 2);
  ctx.fill();
  // Спиральные прожилки — чтобы вращение было видно
  const r = rng(3);
  ctx.lineCap = "round";
  for (let i = 0; i < 16; i++) {
    const a0 = r() * Math.PI * 2;
    const rad = c * (0.36 + r() * 0.5);
    ctx.strokeStyle = `rgba(255,255,255,${0.12 + r() * 0.25})`;
    ctx.lineWidth = 1.5 + r() * 3;
    ctx.beginPath();
    ctx.arc(c, c, rad, a0, a0 + 0.6 + r() * 1.2);
    ctx.stroke();
  }
}

function holeCore(ctx, w) {
  const c = w / 2;
  const g = ctx.createRadialGradient(c, c, c * 0.45, c, c, c);
  g.addColorStop(0, "rgba(0,0,0,1)");
  g.addColorStop(0.6, "rgba(0,0,0,0.85)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, w);
  ctx.fillStyle = "#000";
  ctx.beginPath(); ctx.arc(c, c, c * 0.5, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(255,215,150,0.95)";
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(c, c, c * 0.52, 0, Math.PI * 2); ctx.stroke();
}

/** Основание турели: плоской стороной к левой стене (для правой — отражение). */
function turretBase(ctx, w, h) {
  ctx.fillStyle = "#2a2842";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(2, 6);
  ctx.lineTo(w * 0.45, 6);
  ctx.arc(w * 0.45, h / 2, h / 2 - 6, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(2, h - 6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#44416a";
  rrect(ctx, 6, 12, w * 0.3, h - 24, 4);
  ctx.fill();
  glowCircle(ctx, w * 0.5, h / 2, 14, "rgba(255,77,94,0.9)");
  ctx.fillStyle = "#ff4d5e";
  ctx.beginPath(); ctx.arc(w * 0.5, h / 2, 6, 0, Math.PI * 2); ctx.fill();
}

function turretGun(ctx, w, h) {
  ctx.fillStyle = "#58557e";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 4;
  rrect(ctx, 4, h * 0.25, w - 10, h * 0.5, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#2a2842";
  rrect(ctx, w - 16, h * 0.14, 12, h * 0.72, 3);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#8f8cc0";
  ctx.fillRect(10, h * 0.34, w - 30, 3);
}

function rocket(ctx, w, h) {
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 3;
  // Хвостовые стабилизаторы
  ctx.fillStyle = "#c43a4a";
  ctx.beginPath();
  ctx.moveTo(4, 2); ctx.lineTo(14, h / 2); ctx.lineTo(4, h - 2); ctx.closePath();
  ctx.fill(); ctx.stroke();
  // Корпус
  ctx.fillStyle = "#e7e7f2";
  rrect(ctx, 8, h * 0.25, w - 22, h * 0.5, h * 0.25);
  ctx.fill(); ctx.stroke();
  // Нос
  ctx.fillStyle = "#ff4d5e";
  ctx.beginPath();
  ctx.moveTo(w - 15, h * 0.25); ctx.quadraticCurveTo(w - 1, h / 2, w - 15, h * 0.75); ctx.closePath();
  ctx.fill(); ctx.stroke();
}

function warning(ctx, w) {
  glowCircle(ctx, w / 2, w / 2, w / 2, "rgba(255,60,80,0.5)");
  ctx.fillStyle = "#ff4d5e";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 4;
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(w / 2, 8); ctx.lineTo(w - 8, w - 12); ctx.lineTo(8, w - 12); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.fillRect(w / 2 - 3, 22, 6, 18);
  ctx.beginPath(); ctx.arc(w / 2, w - 20, 3.5, 0, Math.PI * 2); ctx.fill();
}

/* ─── Уровень ─────────────────────────────────────────── */

/** Тайл боковой стены (60×512, повторяется по вертикали). side: 1 — левая стена. */
function sideWall(side) {
  return (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    const dark = "#141327", mid = "#2b2947", lit = "#3b3960";
    if (side > 0) { g.addColorStop(0, dark); g.addColorStop(0.7, mid); g.addColorStop(1, lit); }
    else          { g.addColorStop(0, lit);  g.addColorStop(0.3, mid); g.addColorStop(1, dark); }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // Стыки панелей и заклёпки
    ctx.fillStyle = OUTLINE;
    for (let y = 0; y < h; y += 128) {
      ctx.fillRect(0, y, w, 4);
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.fillRect(0, y + 4, w, 2);
      ctx.fillStyle = "#56537f";
      const xr = side > 0 ? w * 0.35 : w * 0.65;
      ctx.beginPath(); ctx.arc(xr, y + 22, 3, 0, Math.PI * 2); ctx.arc(xr, y + 106, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = OUTLINE;
    }
    // Светящаяся кромка со стороны поля
    const ex = side > 0 ? w - 7 : 7;
    const eg = ctx.createLinearGradient(ex - 8, 0, ex + 8, 0);
    eg.addColorStop(0, "rgba(70,220,255,0)");
    eg.addColorStop(0.5, "rgba(120,235,255,0.95)");
    eg.addColorStop(1, "rgba(70,220,255,0)");
    ctx.fillStyle = eg;
    ctx.fillRect(ex - 8, 0, 16, h);
    ctx.fillStyle = OUTLINE;
    ctx.fillRect(side > 0 ? w - 2 : 0, 0, 2, h);
  };
}

/** Поверхность планеты (512×256, повторяется по горизонтали). Линия y = 40 — уровень земли. */
function ground(ctx, w, h) {
  const top = 40;
  const surf = x => top + 3 * Math.sin((x / w) * Math.PI * 2 * 3) + 2 * Math.sin((x / w) * Math.PI * 2 * 7 + 1);
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let x = 0; x <= w; x += 4) ctx.lineTo(x, surf(x));
  ctx.lineTo(w, h);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, top, 0, h);
  g.addColorStop(0, "#8b86b6");
  g.addColorStop(0.18, "#5d5987");
  g.addColorStop(1, "#262340");
  ctx.fillStyle = g;
  ctx.fill();

  // Кратеры (с переносом через край — тайл бесшовный)
  const r = rng(21);
  for (let i = 0; i < 14; i++) {
    const cx = r() * w;
    const cy = top + 28 + r() * (h - top - 50);
    const rx = 14 + r() * 34;
    const ry = rx * (0.35 + r() * 0.15);
    for (const ox of [-w, 0, w]) {
      ctx.fillStyle = "rgba(20,18,40,0.45)";
      ctx.beginPath(); ctx.ellipse(cx + ox, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(200,196,240,0.35)";
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse(cx + ox, cy + 1.5, rx, ry, 0, 0.1, Math.PI - 0.1); ctx.stroke();
    }
  }
  // Кромка поверхности
  ctx.beginPath();
  for (let x = 0; x <= w; x += 4) (x ? ctx.lineTo(x, surf(x)) : ctx.moveTo(x, surf(x)));
  ctx.lineWidth = 5;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.beginPath();
  for (let x = 0; x <= w; x += 4) (x ? ctx.lineTo(x, surf(x) + 4) : ctx.moveTo(x, surf(x) + 4));
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = "rgba(220,216,255,0.7)";
  ctx.stroke();
}

/** Звёздный тайл 512×512 (бесшовный). */
function stars(seed, count, maxR, bright) {
  return (ctx, w, h) => {
    const r = rng(seed);
    const colors = ["255,255,255", "190,220,255", "255,236,200", "210,190,255"];
    for (let i = 0; i < count; i++) {
      const x = r() * w;
      const y = r() * h;
      const rad = 0.5 + r() * maxR;
      const col = colors[Math.floor(r() * colors.length)];
      const a = (0.35 + r() * 0.65) * bright;
      for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
        const px = x + ox, py = y + oy;
        if (px < -8 || px > w + 8 || py < -8 || py > h + 8) continue;
        if (rad > 1.6) glowCircle(ctx, px, py, rad * 4, `rgba(${col},${a * 0.35})`);
        ctx.fillStyle = `rgba(${col},${a})`;
        ctx.beginPath(); ctx.arc(px, py, rad, 0, Math.PI * 2); ctx.fill();
      }
    }
  };
}

function nebula(seed, palette) {
  return (ctx, w, h) => {
    const r = rng(seed);
    for (let i = 0; i < 9; i++) {
      const x = w * (0.3 + r() * 0.4);
      const y = h * (0.3 + r() * 0.4);
      // Свечение обязано погаснуть до края холста — иначе край текстуры
      // виден прямой линией через весь экран
      const room = Math.min(x, w - x, y, h - y) - 2;
      const rad = Math.min(w * (0.16 + r() * 0.2), room);
      glowCircle(ctx, x, y, rad, palette[i % palette.length], 0.55);
    }
  };
}

function planet(seed, base, dark, ringed) {
  return (ctx, w) => {
    const c = w / 2;
    const R = w * 0.3;
    const r = rng(seed);
    const drawRing = front => {
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(-0.35);
      ctx.strokeStyle = "rgba(230,210,255,0.55)";
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.ellipse(0, 0, R * 1.65, R * 0.42, 0, front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    };
    if (ringed) drawRing(false);
    glowCircle(ctx, c, c, R * 1.35, "rgba(140,120,255,0.25)");
    const g = ctx.createRadialGradient(c - R * 0.4, c - R * 0.4, R * 0.1, c, c, R);
    g.addColorStop(0, base);
    g.addColorStop(1, dark);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2); ctx.clip();
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.05 + r() * 0.08})`;
      ctx.fillRect(c - R, c - R + r() * R * 2, R * 2, 4 + r() * 10);
    }
    ctx.restore();
    ctx.lineWidth = 4;
    ctx.strokeStyle = OUTLINE;
    ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2); ctx.stroke();
    if (ringed) drawRing(true);
  };
}

/** Свечение атмосферы над поверхностью: снизу цвет, вверх — в прозрачность. */
function horizon(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "rgba(40,20,90,0)");
  g.addColorStop(0.55, "rgba(70,40,140,0.35)");
  g.addColorStop(0.85, "rgba(60,150,200,0.55)");
  g.addColorStop(1, "rgba(120,220,255,0.75)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/** Трещины для ломающейся платформы — ложатся поверх арта платформы (340 px ширины). */
function cracks(ctx, w, h) {
  const r = rng(9);
  ctx.strokeStyle = "rgba(30,10,20,0.85)";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (let i = 0; i < 5; i++) {
    let x = w * (0.12 + i * 0.19 + (r() - 0.5) * 0.06);
    let y = 2;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y);
    while (y < h - 4) {
      x += (r() - 0.5) * 18;
      y += 6 + r() * 8;
      ctx.lineTo(x, Math.min(y, h - 2));
    }
    ctx.stroke();
  }
}

/* ─── Запасные арты героя и платформы ─────────────────── */

function platformFallback(ctx, w, h) {
  const top = 10;
  const r = rng(13);
  for (let i = 0; i < 9; i++) {
    rockPath(ctx, w * (0.12 + i * 0.1), top + 42 + r() * 20, 18 + r() * 12, r, 8, 0.35);
    ctx.fillStyle = "#4b4870";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
  }
  rrect(ctx, 4, top, w - 8, 36, 14);
  ctx.fillStyle = "#dcdcec";
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.fillStyle = CYAN;
  rrect(ctx, w * 0.3, top + 20, w * 0.4, 7, 3);
  ctx.fill();
}

function heroFallback(ctx, w, h) {
  const cx = w / 2;
  rrect(ctx, cx - 38, h - 120, 76, 110, 30);
  ctx.fillStyle = "#f2f0f7";
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, h - 160, 58, 0, Math.PI * 2);
  ctx.fillStyle = "#f2f0f7";
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(cx + 14, h - 160, 36, 32, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#1c1a3a";
  ctx.fill();
  ctx.stroke();
}

/* ─── Реестр ──────────────────────────────────────────── */

/**
 * Текстуры: ключ → [ширина, высота, функция рисования].
 * Опора и масштаб для слотов описаны в art.js.
 */
export const TEXTURES = {
  ph_dot:      [32, 32, (c, w) => dot(c, w)],
  ph_spark:    [40, 8, spark],
  ph_smoke:    [64, 64, (c, w) => smoke(c, w)],
  ph_star:     [32, 32, (c, w) => star4(c, w)],
  ph_debris:   [24, 24, (c, w) => debris(c, w)],
  ph_ring:     [128, 128, (c, w) => ring(c, w)],
  ph_chevron:  [32, 32, (c, w) => chevron(c, w)],

  ph_coin:     [64, 64, (c, w) => coin(c, w)],
  ph_diamond:  [72, 72, (c, w) => diamond(c, w)],
  ph_pickup_jetpack:  [88, 88, pickup("jetpack")],
  ph_pickup_teleport: [88, 88, pickup("teleport")],
  ph_pickup_aim:      [88, 88, pickup("aim")],
  ph_pickup_breaker:  [88, 88, pickup("breaker")],
  ph_pickup_x2:       [88, 88, (c, w) => pickupX2(c, w)],

  ph_meteor:      [96, 96, (c, w) => meteor(c, w)],
  ph_hole_disk:   [256, 256, (c, w) => holeDisk(c, w)],
  ph_hole_core:   [96, 96, (c, w) => holeCore(c, w)],
  ph_turret_base: [64, 72, turretBase],
  ph_turret_gun:  [60, 26, turretGun],
  ph_rocket:      [48, 20, rocket],
  ph_warning:     [64, 64, (c, w) => warning(c, w)],

  ph_wall_l:   [60, 512, sideWall(1)],
  ph_wall_r:   [60, 512, sideWall(-1)],
  ph_ground:   [512, 256, ground],
  ph_stars_a:  [512, 512, stars(101, 140, 1.1, 0.7)],
  ph_stars_b:  [512, 512, stars(202, 60, 1.8, 0.9)],
  ph_stars_c:  [512, 512, stars(303, 18, 2.6, 1.0)],
  ph_nebula_a: [512, 512, nebula(41, ["rgba(123,63,228,0.9)", "rgba(45,108,223,0.9)", "rgba(208,70,154,0.7)"])],
  ph_nebula_b: [512, 512, nebula(42, ["rgba(31,181,168,0.8)", "rgba(45,108,223,0.9)", "rgba(123,63,228,0.7)"])],
  ph_planet_a: [256, 256, planet(51, "#ffb38a", "#8c3b5c", true)],
  ph_planet_b: [256, 256, planet(52, "#8ad8ff", "#27407d", false)],
  ph_planet_c: [256, 256, planet(53, "#c8a6ff", "#3c2a78", true)],
  // Высота 500, а не 512: текстура-степень двойки в WebGL повторяется по
  // кругу, и прозрачный верх градиента смешивался с ярким низом — через весь
  // экран шла светлая полоска. Не степень двойки — край не заворачивается.
  ph_horizon:  [8, 500, horizon],
  ph_cracks:   [340, 40, cracks],

  ph_platform: [342, 123, platformFallback],
  ph_hero:     [188, 242, heroFallback],
};

/** Создать все текстуры-заглушки, которых ещё нет в менеджере текстур. */
export function createPlaceholders(scene) {
  for (const [key, [w, h, draw]] of Object.entries(TEXTURES)) {
    if (scene.textures.exists(key)) continue;
    const c = canvas(w, h);
    const ctx = c.getContext("2d");
    draw(ctx, w, h);
    scene.textures.addCanvas(key, c);
  }
}
