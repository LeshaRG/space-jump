/**
 * bot.js — помощник для съёмки промо-материалов: играет «как человек».
 * Вставляется в страницу игры (capture.mjs). Прыгает настоящей рогаткой:
 * зажимает, плавно оттягивает (виден вектор прицела) и отпускает, а куда
 * прыгать — считает той же физикой, что и игра (physics.simulate).
 */
(async () => {
  const P = await import("/src/physics.js");
  const C = (await import("/src/config.js")).default;
  const GS = (await import("/src/GameState.js")).default;
  const Art = (await import("/src/art.js")).default;

  const S = () => window.game.scene.getScene("GameScene");
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 15000) => {
    const t0 = performance.now();
    while (!fn()) {
      if (performance.now() - t0 > ms) return false;
      await sleep(16);
    }
    return true;
  };
  const res = { points: [], hits: [], land: null, swallow: null, fell: false };

  /** Все прыжки на платформу target; lo — самый слабый, hi — самый сильный. */
  function findJumps(target, t0) {
    const s = S();
    const b = s.hero.b;
    const out = [];
    for (let a = 16; a <= 164; a += 3) {
      for (let sp = 380; sp <= C.JUMP.MAX_SPEED; sp += 30) {
        const r = (a * Math.PI) / 180;
        const vx = Math.cos(r) * sp, vy = -Math.sin(r) * sp;
        P.simulate({ x: b.x, y: b.y }, vx, vy, s.world.phys, t0, 2.4, b.y + 1500, res);
        if (res.land?.platform !== target) continue;
        const lx = Math.abs(res.land.x - P.platformX(target, t0 + res.land.time));
        if (lx > target.halfW - 10) continue;
        out.push({ vx, vy, sp, a, bounces: res.hits.filter(h => h.side !== 0).length, lx });
      }
    }
    return out;
  }

  /** Ближайшая платформа выше: kind — "safe" | "hard" | "any". */
  function nextTarget(kind = "safe", maxUp = 430) {
    const s = S();
    const b = s.hero.b;
    const list = s.world.platforms.filter(p => p.alive && p.solid && p.kind !== "ground"
      && p.top < b.y - 50 && p.top > b.y - maxUp
      && (kind === "any" || (kind === "hard" ? p.hard : (!p.hard && !p.crumble))));
    list.sort((p, q) => q.top - p.top);
    return list[0] ?? null;
  }

  /** Натяжение рогатки под нужный вектор: обратная задача к Aim.compute. */
  function pullFor(j) {
    const s = S();
    const speed = Math.hypot(j.vx, j.vy);
    const power = Math.max(0, Math.min(1, (speed - C.JUMP.MIN_SPEED) / (C.JUMP.MAX_SPEED - C.JUMP.MIN_SPEED)));
    const full = s.fullPull();
    const len = C.JUMP.DEAD_ZONE + power * (full - C.JUMP.DEAD_ZONE) + 0.5;
    return { ux: -j.vx / speed, uy: -j.vy / speed, len };
  }

  /** Зажать экран и плавно оттянуть к вектору j (не отпуская). */
  async function aim(j, ms = 420) {
    const s = S();
    const h = s.hero;
    const feet = s.worldToCss(h.b.x, h.b.y);
    const { ux, uy, len } = pullFor(j);
    // Палец — под ногами, чуть в сторону прыжка: резинка уходит вниз, от героя
    const sx = Math.max(40, Math.min(s.cssW - 40, feet.x - Math.sign(ux || 1) * 30));
    const sy = Math.max(120, Math.min(s.cssH - 220, feet.y + 40));
    s.aim.begin(7, sx, sy);
    s.hud.setAiming(true);
    const steps = Math.max(6, Math.round(ms / 30));
    for (let i = 1; i <= steps; i++) {
      const k = 1 - Math.pow(1 - i / steps, 2);
      s.aim.move(sx + ux * len * k, sy + uy * len * k);
      await sleep(ms / steps);
    }
    return { sx, sy, ex: sx + ux * len, ey: sy + uy * len };
  }

  function release(p) {
    const s = S();
    s.onPointerUp({ id: 7, x: p.ex * s.dpr, y: p.ey * s.dpr });
  }

  /**
   * Прыжок на следующую платформу рогаткой.
   * opts: { kind: "safe"|"hard"|"any", prefer: "low"|"rico", hold: мс, release: true }
   */
  async function jump(opts = {}) {
    const s = S();
    await until(() => s.hero.state === "stand" || s.mode !== "play", 8000);
    if (s.mode !== "play") return "mode " + s.mode;
    await sleep(opts.wait ?? 60);
    const hold = opts.hold ?? 420;
    let t = null, list = [];
    for (const kind of [opts.kind ?? "safe", "safe", "any"]) {
      t = nextTarget(kind, opts.maxUp);
      if (!t) continue;
      // Считаем на момент отпускания: платформы могут плавать
      list = findJumps(t, s.simTime + hold / 1000 + 0.02);
      if (list.length) break;
    }
    if (!list.length) return "no jump";
    let j;
    if (opts.prefer === "rico") j = list.filter(x => x.bounces > 0).sort((a, b) => a.sp - b.sp)[0] ?? list[0];
    else j = list.sort((a, b) => a.sp - b.sp || a.lx - b.lx)[Math.min(2, list.length - 1)];
    const p = await aim(j, hold);
    if (opts.release === false) return { aiming: true, p };
    release(p);
    await until(() => s.hero.state !== "stand", 1500);
    await until(() => s.hero.state === "stand" || s.mode !== "play", 6000);
    return { hard: t.hard, score: s.run.score, y: Math.round(-s.hero.b.y), hot: s.hot.level };
  }

  /** Лезть вверх, пока не наберём высоту h (ед.) — быстрыми прыжками (жар копится). */
  async function climbTo(h, opts = {}) {
    const s = S();
    for (let i = 0; i < 400 && -s.hero.b.y < h && s.mode === "play"; i++) {
      const r = await jump({ hold: 160, wait: 30, ...opts });
      if (typeof r === "string" && r !== "no jump") break;
      if (r === "no jump") await sleep(200);
    }
    return Math.round(-s.hero.b.y);
  }

  window.__bot = {
    S, C, GS, Art, P, sleep, until, findJumps, nextTarget, aim, release, jump, climbTo,
    /** Начать забег из меню. */
    async start() {
      document.querySelector('[data-act="play"]')?.click();
      await until(() => S().mode === "play", 5000);
      await sleep(900);
    },
    /** Надеть скин (атлас подгружается). */
    async skin(id) {
      GS.skins = [...new Set([...GS.skins, id])];
      GS.skin = id;
      await S().applySkin(id);
    },
  };
  return true;
})();
