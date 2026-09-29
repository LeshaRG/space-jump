/**
 * check_levels.mjs — проверка проходимости генерации уровней.
 *
 *   node tools/check_levels.mjs [уровней=20] [высота=20000]
 *
 * Генерирует уровни тем же генератором, что и игра, и перебором прыжков
 * (той же физикой, что в игре) проверяет для каждого ряда:
 *   • с надёжной платформы ряда можно допрыгнуть до надёжной следующего;
 *   • сложная платформа достижима с надёжной платформы ниже;
 *   • из сложной можно выбраться — наверх или на лёгкую пару.
 * Запускать после правок GEN и PHYS в src/config.js.
 */
import CONFIG from "../src/config.js";
import { simulate, platformX } from "../src/physics.js";
import Generator, { makeRng } from "../src/world/Generator.js";

const LEVELS = Number(process.argv[2]) || 20;
const HEIGHT = Number(process.argv[3]) || 20000;
const FIELD_W = CONFIG.VIEW.FIELD_W;
const HZ = CONFIG.HAZARDS;
const FOOT = CONFIG.HERO.FOOT;
const HW = CONFIG.HERO.W / 2;

/** Мир без графики: только то, что нужно физике. */
function fakeWorld() {
  const w = {
    platforms: [], walls: [], holes: [],
    addPlatform(o) {
      const p = {
        kind: o.kind, hard: !!o.hard, baseX: o.x, halfW: o.w / 2, top: o.y, bottom: o.y + CONFIG.PLATFORM.THICK,
        move: o.move || null, solidBottom: !!o.solidBottom, alive: true, solid: true, crumble: !!o.crumble,
        pairGroup: null, group: null,
      };
      w.platforms.push(p);
      return p;
    },
    addWall(x1, y1, x2, y2) { const s = { x1, y1, x2, y2, alive: true }; w.walls.push(s); return s; },
    addCoin() {}, addPickup() {}, addTurret() {},
    addHole(x, y) {
      const C = HZ.HOLE;
      w.holes.push({ x, y, range: C.RANGE, core: C.CORE, strength: C.STRENGTH, maxAcc: C.MAX_ACC, alive: true });
    },
  };
  w.ground = w.addPlatform({ kind: "ground", x: FIELD_W / 2, y: 0, w: FIELD_W });
  return w;
}

const res = { points: [], hits: [], land: null, swallow: null, fell: false };

/** Можно ли с платформы from попасть на платформу to: перебор точки старта, фазы и вектора прыжка. */
function reachable(from, to, phys) {
  const spots = from.kind === "ground" ? [0] : [-0.6, -0.2, 0.2, 0.6];
  const phases = from.move || to.move ? [0, 0.9, 1.8, 2.7] : [0];
  for (const t0 of phases) {
    for (const k of spots) {
      let x = platformX(from, t0) + k * from.halfW;
      x = Math.max(HW, Math.min(FIELD_W - HW, x));
      for (const s of phys.walls) {                     // в кармане стартуем не внутри стенки
        if (x + HW > s.x1 && x - HW < s.x2 && from.top > s.y1 && from.top - CONFIG.HERO.H < s.y2) {
          x = x < (s.x1 + s.x2) / 2 ? s.x1 - HW : s.x2 + HW;
        }
      }
      const start = { x, y: from.top };
      for (let a = 8; a <= 172; a += 2) {
        const r = (a * Math.PI) / 180;
        for (let sp = 300; sp <= CONFIG.JUMP.MAX_SPEED; sp += 25) {
          simulate(start, Math.cos(r) * sp, -Math.sin(r) * sp, phys, t0, 3.5, from.top + 2000, res);
          if (res.land?.platform !== to) continue;
          const lx = res.land.x - platformX(to, t0 + res.land.time);
          if (to.kind !== "pocket" && Math.abs(lx) > to.halfW + FOOT - 8) continue;   // впритык к краю не считаем
          return true;
        }
      }
    }
  }
  return false;
}

let rows = 0;
let hardChecked = 0;
const fails = [], hardUnreach = [], hardStuck = [];
const kinds = {};
const started = Date.now();

for (let level = 0; level < LEVELS; level++) {
  const seed = 1000 + level * 7919;
  const world = fakeWorld();
  const gen = new Generator(world, makeRng(seed));

  // Платформы каждого ряда — по мере генерации
  const byRow = [];
  let before = world.platforms.length;
  while (gen.y > -HEIGHT) {
    gen.nextRow();
    byRow.push(world.platforms.slice(before));
    before = world.platforms.length;
  }
  const phys = { fieldW: FIELD_W, platforms: world.platforms, walls: world.walls, holes: world.holes };

  let safePrev = world.ground;
  for (let i = 0; i < byRow.length; i++) {
    const safe = byRow[i].find(p => !p.hard);
    const hard = byRow[i].find(p => p.hard);
    rows++;
    const kind = hard ? hard.kind + (hard.crumble ? "+crumble" : "") : "single";
    kinds[kind] = (kinds[kind] || 0) + 1;

    if (!reachable(safePrev, safe, phys)) {
      fails.push(`seed ${seed} ряд ${i + 1} (h=${Math.round(-safe.top)}): ${safePrev.kind} → ${safe.kind}${safe.move ? "~" : ""}` +
        ` dy=${Math.round(safePrev.top - safe.top)} dx=${Math.round(safe.baseX - safePrev.baseX)}`);
    }
    if (hard) {
      hardChecked++;
      if (!reachable(safePrev, hard, phys)) {
        hardUnreach.push(`seed ${seed} ряд ${i + 1}: ${kind} dy=${Math.round(safePrev.top - hard.top)}`);
      }
      const next = byRow[i + 1]?.find(p => !p.hard);
      if (!((next && reachable(hard, next, phys)) || reachable(hard, safe, phys))) {
        hardStuck.push(`seed ${seed} ряд ${i + 1}: из ${kind} не выбраться`);
      }
    }
    safePrev = safe;
  }
}

console.log(`Уровней: ${LEVELS}, рядов: ${rows}, сложных: ${hardChecked}, время: ${((Date.now() - started) / 1000).toFixed(1)} с`);
console.log("Виды рядов:", kinds);
console.log(`Надёжный путь прерывается: ${fails.length}`);
fails.slice(0, 15).forEach(f => console.log("  x", f));
console.log(`Сложная недостижима: ${hardUnreach.length}`);
hardUnreach.slice(0, 10).forEach(f => console.log("  x", f));
console.log(`Из сложной не выбраться: ${hardStuck.length}`);
hardStuck.slice(0, 10).forEach(f => console.log("  x", f));
process.exit(fails.length ? 1 : 0);
