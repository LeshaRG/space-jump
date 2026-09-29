/**
 * World — все объекты уровня: платформы, мини-стены, монеты и алмазы,
 * бустеры на платформах и опасности (метеориты, чёрные дыры, турели с ракетами).
 *
 * Логика объектов идёт фиксированным шагом (step), отрисовка — каждый кадр
 * (render) с интерполированным временем, чтобы движение было плавным на
 * экранах с любой частотой.
 */
import CONFIG from "../config.js";
import Art    from "../art.js";
import Audio  from "../audio.js";
import { platformX, HERO_H, HERO_HALF_W } from "../physics.js";

const V  = CONFIG.VIEW;
const P  = CONFIG.PLATFORM;
const HZ = CONFIG.HAZARDS;
const FIELD_W = V.FIELD_W;

const COIN_D    = 30;  // диаметр монеты, ед.
const DIAMOND_D = 38;  // размер алмаза, ед.
const PICKUP_D  = 44;  // диаметр пузыря бустера, ед.

/** Пересекает ли круг хитбокс героя (ноги в b.x, b.y). */
export function circleHitsHero(cx, cy, r, b) {
  const nx = Math.max(b.x - HERO_HALF_W, Math.min(cx, b.x + HERO_HALF_W));
  const ny = Math.max(b.y - HERO_H, Math.min(cy, b.y));
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

export default class World {
  constructor(scene, fx) {
    this.scene = scene;
    this.fx = fx;

    this.platforms = [];
    this.walls     = [];
    this.holes     = [];
    this.coins     = [];
    this.pickups   = [];
    this.turrets   = [];
    this.rockets   = [];
    this.meteors   = [];

    /** То, что видит физика героя. */
    this.phys = { fieldW: FIELD_W, platforms: this.platforms, walls: this.walls, holes: this.holes };

    this._id = 0;
    this.meteorTimer = 6;
    this.ground = this.addPlatform({ kind: "ground", x: FIELD_W / 2, y: 0, w: FIELD_W });
  }

  /* ═══════════════════════════════════════
     СОЗДАНИЕ
  ═══════════════════════════════════════ */

  /**
   * @param o { kind, x, y, w, move?, hard?, crumble?, solidBottom?, slot? }
   *          x — центр, y — верх настила, w — ширина, по которой можно ходить
   */
  addPlatform(o) {
    const p = {
      id:          ++this._id,
      kind:        o.kind,
      hard:        !!o.hard,
      baseX:       o.x,
      halfW:       o.w / 2,
      top:         o.y,
      bottom:      o.y + P.THICK,
      move:        o.move || null,
      solidBottom: !!o.solidBottom,
      alive:       true,
      solid:       true,
      crumble:     o.crumble ? { left: P.CRUMBLE_TIME, on: false } : null,
      pairGroup:   null,     // у лёгкой платформы из пары — сложная, которая исчезнет
      group:       null,     // у сложной — её группа (платформа, стены, монеты)
      coins:       [],
      pickup:      null,
      visited:     false,
      sprite:      null,
      overlay:     null,
      gone:        false,
      fallY:       0,
    };

    if (o.kind !== "ground") {
      const slot = o.slot || "platform";
      const info = Art.get(slot);
      const scale = (o.w / P.SURFACE) / info.ref;
      const s = Art.sprite(this.scene, slot, o.x, o.y, true).setScale(scale).setDepth(10);
      p.sprite = s;
      p.scale = scale;
      p.sinkY = P.SINK_PX * scale;

      // Пока нет отдельного арта — отличаем виды платформ цветом и трещинами
      if (o.crumble && !Art.has("platform_crumble")) {
        s.setTint(0xffb49e);
        p.overlay = this.scene.add.image(o.x, o.y, "ph_cracks")
          .setOrigin(0.5, 0).setScale(scale).setDepth(10.5).setAlpha(0.9);
      } else if (o.move && !Art.has("platform_moving")) {
        s.setTint(0xbfe9ff);
      } else if (o.hard && slot === "platform_small" && !Art.has("platform_small")) {
        s.setTint(0xfff0c8);
      }
    }

    this.platforms.push(p);
    return p;
  }

  /** Мини-стена у сложной платформы (прямоугольник в мировых координатах). */
  addWall(x1, y1, x2, y2) {
    const w = { x1, y1, x2, y2, alive: true, gone: false };
    const g = this.scene.add.graphics().setDepth(9);
    const W = x2 - x1;
    const H = y2 - y1;
    g.fillStyle(0x151528, 1);
    g.fillRoundedRect(x1 - 2, y1 - 2, W + 4, H + 4, 7);
    g.fillStyle(0x3a3862, 1);
    g.fillRoundedRect(x1, y1, W, H, 6);
    g.fillStyle(0x57548a, 1);
    g.fillRect(x1 + 2, y1 + 6, 3, H - 12);
    // Шапка
    g.fillStyle(0x7d79c2, 1);
    g.fillRoundedRect(x1, y1, W, 12, { tl: 6, tr: 6, bl: 0, br: 0 });
    w.gfx = g;
    // Энергетическая полоса — пульсирует, чтобы стена читалась как отбойник
    w.glow = this.scene.add.rectangle((x1 + x2) / 2, y1 + 16, 4, H - 26, 0x46dcff, 1)
      .setOrigin(0.5, 0).setDepth(9.2).setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({ targets: w.glow, alpha: { from: 1, to: 0.35 }, duration: 700, yoyo: true, repeat: -1 });
    this.walls.push(w);
    return w;
  }

  /**
   * Монета (или алмаз) над платформой. dx, dy — смещение от центра настила.
   * @param {"coin"|"diamond"} kind
   */
  addCoin(p, dx, dy, kind = "coin") {
    const diamond = kind === "diamond";
    const s = Art.sprite(this.scene, kind, 0, 0, true);
    const info = Art.get(kind);
    const scale = (diamond ? DIAMOND_D : COIN_D) / info.ref;
    s.setScale(scale).setDepth(diamond ? 15.5 : 15);
    const c = {
      platform: p, kind, dx, dy, x: 0, y: 0, alive: true, sprite: s, scale,
      spin: !diamond && !info.anim, phase: Math.random() * 6,
    };
    p.coins.push(c);
    this.coins.push(c);
    return c;
  }

  /** Бустер, лежащий на платформе. */
  addPickup(p, type) {
    const slot = "pickup_" + type;
    const s = Art.sprite(this.scene, slot, 0, 0, true);
    const scale = PICKUP_D / Art.get(slot).ref;
    s.setScale(scale).setDepth(16);
    const k = { platform: p, type, dx: 0, dy: -38, x: 0, y: 0, alive: true, sprite: s, scale, phase: Math.random() * 6 };
    p.pickup = k;
    this.pickups.push(k);
    return k;
  }

  addHole(x, y) {
    const C = HZ.HOLE;
    const h = { x, y, range: C.RANGE, core: C.CORE, strength: C.STRENGTH, maxAcc: C.MAX_ACC, alive: true, warned: false, parts: [] };
    const add = this.scene.add;

    h.field = add.graphics().setDepth(3);
    h.field.lineStyle(3, 0xb46bff, 0.22);
    for (let i = 0; i < 36; i += 2) {
      const a0 = (i / 36) * Math.PI * 2;
      const a1 = ((i + 1) / 36) * Math.PI * 2;
      h.field.beginPath();
      h.field.arc(x, y, C.RANGE, a0, a1);
      h.field.strokePath();
    }
    h.parts.push(h.field);

    if (Art.has("blackhole")) {
      const info = Art.get("blackhole");
      h.sprite = Art.sprite(this.scene, "blackhole", x, y).setScale((C.CORE * 7) / info.ref).setDepth(4);
      h.parts.push(h.sprite);
    } else {
      h.disk = add.image(x, y, "ph_hole_disk").setScale(0.86).setDepth(4).setBlendMode(Phaser.BlendModes.ADD);
      h.disk2 = add.image(x, y, "ph_hole_disk").setScale(0.55).setDepth(4.1).setAlpha(0.7).setBlendMode(Phaser.BlendModes.ADD);
      h.coreImg = add.image(x, y, "ph_hole_core").setScale(C.CORE / 24).setDepth(4.2);
      h.parts.push(h.disk, h.disk2, h.coreImg);
    }

    // Пылинки с края зоны притяжения стекаются к центру — видно, где тянет
    h.dust = add.particles(x, y, "ph_dot", {
      emitZone: { type: "edge", source: new Phaser.Geom.Circle(0, 0, C.RANGE * 0.85), quantity: 29 },
      moveToX: 0, moveToY: 0, lifespan: 1100, frequency: 70,
      scale: { start: 0.15, end: 0.45 }, alpha: { start: 0, end: 0.9 },
      tint: [0xc9a6ff, 0xffb070, 0x7ff0ff], blendMode: "ADD",
    }).setDepth(3.5);
    h.parts.push(h.dust);

    this.holes.push(h);
    return h;
  }

  /** Турель на боковой стене. side: -1 — левая, 1 — правая. */
  addTurret(side, y) {
    const x = side < 0 ? 0 : FIELD_W;
    const base = Art.sprite(this.scene, "turret", x, y);
    base.setScale(54 / Art.get("turret").ref).setDepth(11);
    if (side < 0) base.setOrigin(0, 0.5);
    else base.setOrigin(1, 0.5).setFlipX(true);

    const muzzleX = x - side * 30;    // точка вращения ствола — чуть внутрь поля
    const gun = Art.sprite(this.scene, "turret_gun", muzzleX, y);
    gun.setScale(58 / Art.get("turret_gun").ref).setOrigin(0.18, 0.5).setDepth(11.5);
    gun.rotation = side < 0 ? 0 : Math.PI;

    const laser = this.scene.add.graphics().setDepth(44);
    const t = { side, x, y, px: muzzleX, py: y, state: "idle", timer: 0, alive: true, base, gun, laser, told: false, angle: gun.rotation };
    this.turrets.push(t);
    return t;
  }

  /* ═══════════════════════════════════════
     СОБЫТИЯ УРОВНЯ
  ═══════════════════════════════════════ */

  /** Игрок выбрал лёгкую платформу — сложная вместе с монетами и стенами исчезает. */
  vanishGroup(group) {
    if (group.gone) return;
    group.gone = true;
    const p = group.platform;
    p.alive = false;
    p.solid = false;
    this.fx.burst("magic", platformX(p, this.scene.simTime), p.top - 10, 14);
    Audio.play("vanish");
    const targets = [p.sprite, p.overlay].filter(Boolean);
    this.scene.tweens.add({
      targets, alpha: 0, scaleX: p.scale * 1.15, scaleY: p.scale * 0.6, duration: P.VANISH_TIME * 1000, ease: "Cubic.easeIn",
      onComplete: () => { p.gone = true; },
    });
    for (const c of p.coins) this._fadeOut(c);
    if (p.pickup) this._fadeOut(p.pickup);
    for (const w of group.walls) this.destroyWall(w, true);
  }

  /** Ломающаяся платформа рассыпалась. */
  breakPlatform(p) {
    if (!p.alive) return;
    p.alive = false;
    p.solid = false;
    const x = platformX(p, this.scene.simTime);
    this.fx.burst("debris", x, p.top + 8, 10);
    this.fx.burst("dust", x, p.top, 6);
    Audio.play("break");
    const targets = [p.sprite, p.overlay].filter(Boolean);
    this.scene.tweens.add({
      targets, alpha: 0, angle: (Math.random() - 0.5) * 24, duration: 650, ease: "Quad.easeIn",
      onUpdate: tw => { p.fallY = tw.progress * tw.progress * 180; },
      onComplete: () => { p.gone = true; },
    });
    for (const c of p.coins) this._fadeOut(c);
    if (p.pickup) this._fadeOut(p.pickup);
  }

  destroyWall(w, quiet = false) {
    if (!w.alive) return;
    w.alive = false;
    const cx = (w.x1 + w.x2) / 2;
    if (!quiet) {
      for (let y = w.y1; y < w.y2; y += 40) this.fx.burst("debris", cx, y, 3);
      this.fx.burst("blast", cx, (w.y1 + w.y2) / 2, 10);
      Audio.play("explode");
    }
    this.scene.tweens.add({
      targets: [w.gfx, w.glow], alpha: 0, duration: quiet ? P.VANISH_TIME * 1000 : 250,
      onComplete: () => { w.gone = true; },
    });
  }

  collectCoin(c) {
    if (!c.alive) return false;
    c.alive = false;
    this.fx.burst("gold", c.x, c.y, 10);
    if (c.kind === "diamond") this.fx.burst("magic", c.x, c.y, 16);
    this.scene.tweens.add({
      targets: c.sprite, y: c.y - 50, alpha: 0, scale: c.scale * 1.6, duration: 380, ease: "Cubic.easeOut",
      onComplete: () => { c.sprite.destroy(); c.gone = true; },
    });
    return true;
  }

  collectPickup(k) {
    if (!k.alive) return false;
    k.alive = false;
    this.fx.burst("magic", k.x, k.y, 12);
    this.scene.tweens.add({
      targets: k.sprite, alpha: 0, scale: k.scale * 1.8, duration: 350, ease: "Cubic.easeOut",
      onComplete: () => { k.sprite.destroy(); k.gone = true; },
    });
    return true;
  }

  _fadeOut(item) {
    if (!item.alive) return;
    item.alive = false;
    this.scene.tweens.add({
      targets: item.sprite, alpha: 0, duration: 300,
      onComplete: () => { item.sprite.destroy(); item.gone = true; },
    });
  }

  /* ═══════════════════════════════════════
     ШАГ ЛОГИКИ
  ═══════════════════════════════════════ */

  /**
   * @param ctx { hazards: bool, hero: {b, state}, view, diff, onHit(kind, x, y, vx, vy), say(group, chance) }
   */
  step(t, dt, ctx) {
    // Ломающиеся платформы
    for (const p of this.platforms) {
      if (!p.alive || !p.crumble || !p.crumble.on) continue;
      p.crumble.left -= dt;
      if (p.crumble.left <= 0) this.breakPlatform(p);
    }

    if (!ctx.hazards) return;
    this._stepTurrets(dt, ctx);
    this._stepRockets(dt, ctx);
    this._stepMeteors(dt, ctx);
  }

  _heroTargetable(ctx) {
    const s = ctx.hero.state;
    return s === "stand" || s === "air";
  }

  _stepTurrets(dt, ctx) {
    const C = HZ.TURRET;
    const b = ctx.hero.b;
    const hx = b.x;
    const hy = b.y - HERO_H / 2;
    const { top, height } = ctx.view;

    for (const t of this.turrets) {
      if (!t.alive) continue;
      const onScreen = t.y > top - 40 && t.y < top + height + 40;
      const inRange = onScreen && Math.abs(hy - t.y) < C.RANGE && this._heroTargetable(ctx);
      const want = Math.atan2(hy - t.py, hx - t.px);

      if (t.state === "idle") {
        if (inRange) {
          t.state = "aim";
          t.timer = C.AIM;
          Audio.play("lock");
          if (!t.told) { t.told = true; ctx.say("turret", 0.8); }
        }
      } else if (t.state === "aim") {
        t.angle = want;
        t.timer -= dt;
        if (!inRange) {
          t.state = "idle";
        } else if (t.timer <= 0) {
          this._fireRocket(t, t.angle);
          t.state = "cool";
          t.timer = C.COOLDOWN[0] + (C.COOLDOWN[1] - C.COOLDOWN[0]) * ctx.diff;
        }
      } else if (t.state === "cool") {
        t.timer -= dt;
        if (t.timer <= 0) t.state = "idle";
      }
    }
  }

  _fireRocket(t, angle) {
    const C = HZ.TURRET;
    const x = t.px + Math.cos(angle) * 40;
    const y = t.py + Math.sin(angle) * 40;
    const s = Art.sprite(this.scene, "rocket", x, y).setDepth(24);
    s.setScale(40 / Art.get("rocket").ref).setRotation(angle);
    this.rockets.push({ x, y, vx: Math.cos(angle) * C.SPEED, vy: Math.sin(angle) * C.SPEED, life: C.LIFE, alive: true, sprite: s });
    this.fx.burst("smoke", x, y, 5);
    Audio.play("launch");
  }

  _stepRockets(dt, ctx) {
    const b = ctx.hero.b;
    for (const r of this.rockets) {
      if (!r.alive) continue;
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      r.life -= dt;
      if (Math.random() < 0.5) this.fx.trail("smoke", r.x - r.vx * 0.04, r.y - r.vy * 0.04, 1);

      let boom = r.life <= 0 || r.x < 0 || r.x > FIELD_W;
      if (!boom && this._heroTargetable(ctx) && circleHitsHero(r.x, r.y, 12, b)) boom = true;
      if (!boom) {
        for (const w of this.walls) {
          if (w.alive && r.x > w.x1 && r.x < w.x2 && r.y > w.y1 && r.y < w.y2) { boom = true; break; }
        }
      }
      if (boom) this._explode(r, ctx);
    }
  }

  _explode(r, ctx) {
    r.alive = false;
    r.sprite.destroy();
    this.fx.burst("blast", r.x, r.y, 16);
    this.fx.burst("smoke", r.x, r.y, 6);
    Audio.play("explode");
    const b = ctx.hero.b;
    const dx = b.x - r.x;
    const dy = b.y - HERO_H / 2 - r.y;
    if (this._heroTargetable(ctx) && dx * dx + dy * dy < HZ.TURRET.BLAST_R * HZ.TURRET.BLAST_R) {
      const d = Math.hypot(dx, dy) || 1;
      ctx.onHit("rocket", r.x, r.y, dx / d, dy / d);
    }
  }

  _stepMeteors(dt, ctx) {
    const C = HZ.METEOR;
    const b = ctx.hero.b;
    const { top, height, left, width } = ctx.view;

    // Появление по таймеру — только выше стартовой высоты
    if (-b.y >= C.FROM) {
      this.meteorTimer -= dt;
      if (this.meteorTimer <= 0) {
        this.meteorTimer = C.EVERY[0] + (C.EVERY[1] - C.EVERY[0]) * ctx.diff;
        this._warnMeteor(b, ctx);
      }
    }

    for (const m of this.meteors) {
      if (!m.alive) continue;
      if (m.phase === "warn") {
        m.timer -= dt;
        if (m.timer <= 0) this._launchMeteor(m, b, top);
        continue;
      }
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.rot += dt * 4;
      this.fx.trail("fire", m.x - m.vx * 0.03, m.y - m.vy * 0.03, 1);
      if (!m.hit && this._heroTargetable(ctx) && circleHitsHero(m.x, m.y, C.R, b)) {
        m.hit = true;
        ctx.onHit("meteor", m.x, m.y, m.vx, m.vy);
      }
      if (m.y > top + height + 200 || m.x < left - 300 || m.x > left + width + 300) {
        m.alive = false;
        m.sprite?.destroy();
      }
    }
  }

  _warnMeteor(b, ctx) {
    // Вход сверху, со стороны, противоположной герою, — летит наискосок
    const fromLeft = b.x > FIELD_W / 2 ? Math.random() < 0.75 : Math.random() < 0.25;
    const entryX = fromLeft ? 40 + Math.random() * 150 : FIELD_W - 40 - Math.random() * 150;
    const warn = this.scene.add.image(entryX, 0, "ph_warning").setScale(0.75).setDepth(55);
    this.scene.tweens.add({ targets: warn, alpha: { from: 1, to: 0.3 }, duration: 160, yoyo: true, repeat: -1 });
    const line = this.scene.add.graphics().setDepth(2);
    this.meteors.push({ phase: "warn", timer: HZ.METEOR.WARN, entryX, x: entryX, y: 0, vx: 0, vy: 0, rot: 0, alive: true, hit: false, warn, line });
    Audio.play("warn");
    ctx.say("meteor", 0.55);
  }

  _launchMeteor(m, b, top) {
    const C = HZ.METEOR;
    m.phase = "fly";
    m.x = m.entryX;
    m.y = top - 80;
    const tx = b.x + (Math.random() - 0.5) * 60;
    const ty = b.y - HERO_H / 2 + (Math.random() - 0.5) * 60;
    const d = Math.hypot(tx - m.x, ty - m.y) || 1;
    const sp = C.SPEED[0] + Math.random() * (C.SPEED[1] - C.SPEED[0]);
    m.vx = ((tx - m.x) / d) * sp;
    m.vy = ((ty - m.y) / d) * sp;
    m.warn.destroy();
    m.line.destroy();
    m.warn = m.line = null;
    const info = Art.get("meteor");
    m.sprite = Art.sprite(this.scene, "meteor", m.x, m.y).setScale((C.R * 2.6) / info.ref).setDepth(24);
  }

  /** Снять все активные угрозы рядом с героем (после возрождения). */
  clearThreats() {
    for (const r of this.rockets) if (r.alive) { r.alive = false; r.sprite.destroy(); }
    for (const m of this.meteors) {
      if (!m.alive) continue;
      m.alive = false;
      m.sprite?.destroy();
      m.warn?.destroy();
      m.line?.destroy();
    }
    for (const t of this.turrets) { t.state = "cool"; t.timer = 2.5; }
    this.meteorTimer = Math.max(this.meteorTimer, 5);
  }

  /* ═══════════════════════════════════════
     ОТРИСОВКА
  ═══════════════════════════════════════ */

  render(t, view, dt, heroB) {
    const now = this.scene.time.now / 1000;

    for (const p of this.platforms) {
      if (!p.sprite || p.gone) continue;
      let x = platformX(p, t);
      if (p.crumble?.on && p.alive) {
        const k = 1 - p.crumble.left / P.CRUMBLE_TIME;
        x += Math.sin(now * 55) * (1 + k * 3.5);
      }
      const y = p.top - p.sinkY + p.fallY;
      p.sprite.setPosition(x, y);
      p.overlay?.setPosition(x, y);
    }

    for (const c of this.coins) {
      if (c.gone || !c.alive) continue;
      const p = c.platform;
      c.x = platformX(p, t) + c.dx;
      c.y = p.top + c.dy + Math.sin(now * 3 + c.phase) * 3;
      c.sprite.setPosition(c.x, c.y);
      if (c.spin) c.sprite.scaleX = c.scale * Math.abs(Math.cos(now * 2.6 + c.phase)) + 0.02;
      if (c.kind === "diamond") {
        // Алмаз покачивается и искрит — его видно издалека
        c.sprite.rotation = Math.sin(now * 2 + c.phase) * 0.1;
        if (Math.random() < dt * 3) this.fx.trail("magic", c.x + (Math.random() - 0.5) * 30, c.y + (Math.random() - 0.5) * 30, 1);
      }
    }

    for (const k of this.pickups) {
      if (k.gone || !k.alive) continue;
      const p = k.platform;
      k.x = platformX(p, t) + k.dx;
      k.y = p.top + k.dy + Math.sin(now * 2.4 + k.phase) * 5;
      k.sprite.setPosition(k.x, k.y);
      k.sprite.rotation = Math.sin(now * 1.7 + k.phase) * 0.12;
    }

    for (const h of this.holes) {
      if (h.disk) {
        h.disk.rotation += dt * 1.1;
        h.disk2.rotation -= dt * 2.2;
        h.coreImg.setScale((HZ.HOLE.CORE / 24) * (1 + Math.sin(now * 4) * 0.04));
      }
    }

    for (const tr of this.turrets) {
      tr.gun.rotation = tr.angle;
      tr.gun.setFlipY(Math.cos(tr.angle) < 0);
      tr.laser.clear();
      if (tr.state === "aim") {
        const k = 1 - tr.timer / HZ.TURRET.AIM;
        const len = 900;
        tr.laser.lineStyle(2 + k * 3, 0xff3b50, 0.25 + k * 0.55);
        tr.laser.lineBetween(tr.px, tr.py, tr.px + Math.cos(tr.angle) * len, tr.py + Math.sin(tr.angle) * len);
      }
    }

    for (const r of this.rockets) {
      if (r.alive) r.sprite.setPosition(r.x, r.y);
    }

    for (const m of this.meteors) {
      if (!m.alive) continue;
      if (m.phase === "warn") {
        // Предупреждение держится у верхнего края экрана и показывает, куда полетит метеорит
        const wx = Math.max(view.left + 36, Math.min(m.entryX, view.left + view.width - 36));
        m.warn.setPosition(wx, view.top + 44);
        const tx = heroB.x;
        const ty = heroB.y - HERO_H / 2;
        m.line.clear();
        m.line.lineStyle(3, 0xff4d5e, 0.35);
        const sx = m.entryX, sy = view.top;
        const d = Math.hypot(tx - sx, ty - sy) || 1;
        for (let s = 0; s < view.height * 1.4; s += 36) {
          const x0 = sx + ((tx - sx) / d) * s;
          const y0 = sy + ((ty - sy) / d) * s;
          const x1 = sx + ((tx - sx) / d) * (s + 18);
          const y1 = sy + ((ty - sy) / d) * (s + 18);
          m.line.lineBetween(x0, y0, x1, y1);
        }
      } else if (m.sprite) {
        m.sprite.setPosition(m.x, m.y).setRotation(m.rot);
      }
    }
  }

  /* ═══════════════════════════════════════
     УБОРКА
  ═══════════════════════════════════════ */

  /** Удалить всё, что ушло ниже limitY, и то, что уже исчезло. */
  cull(limitY) {
    const drop = (list, isBelow, kill) => {
      for (let i = list.length - 1; i >= 0; i--) {
        const o = list[i];
        if (o.gone || isBelow(o)) {
          kill(o);
          list.splice(i, 1);
        }
      }
    };

    drop(this.platforms, p => p.kind !== "ground" && p.top > limitY, p => {
      p.alive = false;
      p.sprite?.destroy();
      p.overlay?.destroy();
    });
    drop(this.coins, c => c.platform.top > limitY, c => { if (!c.gone) c.sprite.destroy(); });
    drop(this.pickups, k => k.platform.top > limitY, k => { if (!k.gone) k.sprite.destroy(); });
    drop(this.walls, w => w.y1 > limitY, w => {
      w.alive = false;
      this.scene.tweens.killTweensOf(w.glow);
      w.gfx.destroy();
      w.glow.destroy();
    });
    drop(this.holes, h => h.y - h.range > limitY, h => { h.alive = false; h.parts.forEach(o => o.destroy()); });
    drop(this.turrets, t => t.y > limitY, t => { t.alive = false; t.base.destroy(); t.gun.destroy(); t.laser.destroy(); });

    for (let i = this.rockets.length - 1; i >= 0; i--) if (!this.rockets[i].alive) this.rockets.splice(i, 1);
    for (let i = this.meteors.length - 1; i >= 0; i--) if (!this.meteors[i].alive) this.meteors.splice(i, 1);
  }
}
