/**
 * GameScene — единственная игровая сцена: мир, герой, камера, забег,
 * бустеры, опасности и реплики героя.
 *
 * Меню, пауза и экран конца полёта — HTML поверх канваса, а мир под меню
 * продолжает жить: космонавт дышит на поверхности планеты. Новый забег —
 * перезапуск сцены: чистое состояние без ручной уборки.
 *
 * Время: логика идёт фиксированным шагом (physics.js), отрисовка — каждый
 * кадр с интерполяцией. Так прицел совпадает с прыжком, а движение плавное
 * на 60, 90 и 144 Гц.
 */
import CONFIG    from "../config.js";
import YSDK      from "../ysdk.js";
import GameState from "../GameState.js";
import Audio     from "../audio.js";
import Art       from "../art.js";
import { t }     from "../i18n.js";
import { line }  from "../i18n.js";
import { icon }  from "../icons.js";
import { stepAir, stepStand, platformX, EV_LAND, EV_SWALLOW, HERO_H } from "../physics.js";
import World, { circleHitsHero } from "../world/World.js";
import Generator, { makeRng } from "../world/Generator.js";
import Background from "../world/Background.js";
import Effects   from "../world/Effects.js";
import Hero      from "../Hero.js";
import Aim       from "../Aim.js";
import Hud       from "../ui/Hud.js";
import Bubble    from "../ui/Bubble.js";
import Tutorial  from "../ui/Tutorial.js";
import UI        from "../ui/screens.js";

const V   = CONFIG.VIEW;
const PH  = CONFIG.PHYS;
const J   = CONFIG.JUMP;
const SC  = CONFIG.SCORE;
const B   = CONFIG.BOOSTERS;
const SP  = CONFIG.SPEECH;
const ADS = CONFIG.ADS;
const HZ  = CONFIG.HAZARDS;
const CO  = CONFIG.COINS;
const HOT = CONFIG.HOT;
const PAY = SC.PAYOUT;
const HOT_MAX = HOT.WINDOW.length - 1;   // уровень ×3
const STEP = PH.STEP;
const FIELD_W = V.FIELD_W;

/** Реплики, которые важнее паузы между репликами. */
const URGENT = new Set(["hit", "falling", "hole", "record", "revive", "milestone", "crumble", "start"]);

/** Время последней полноэкранной рекламы — живёт между перезапусками сцены. */
let lastFullscreenAt = 0;

export default class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: "GameScene" });
  }

  init(data) {
    this.autostart = !!data?.autostart;
    // Phaser не очищает settings.data при scene.restart() без данных
    this.sys.settings.data = {};
  }

  /* ═══════════════════════════════════════
     СОЗДАНИЕ
  ═══════════════════════════════════════ */

  create() {
    this.mode = "menu";          // menu | play | dead | over
    this.paused = false;         // пауза игрока (меню паузы, окно бустера)
    this.sysPaused = !!this.game.registry.get("sysPaused");
    this.adBusy = false;
    this.simTime = 0;
    this.acc = 0;
    this.pendingLaunch = null;

    this.layout();
    this.bg = new Background(this);
    this.bg.resize(this.viewW, this.viewH);
    this.fx = new Effects(this);
    this.world = new World(this, this.fx);
    this.gen = new Generator(this.world, makeRng((Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0));
    this.hero = new Hero(this, FIELD_W / 2, 0, this.world.ground);
    this.aim = new Aim(this);
    this.bubble = new Bubble();
    this.tutorial = new Tutorial();
    this.hud = new Hud({ onPause: () => this.openPause(), onBooster: k => this.onBoosterButton(k) });

    this.groundCamTop = -V.STAND_Y * this.viewH;
    this.camTop = this.camTarget = this.camTopMin = this.autostart ? this.groundCamTop : -V.MENU_Y * this.viewH;
    this.view = { left: 0, top: this.camTop, width: this.viewW, height: this.viewH };
    this.gen.fill(this.camTop - this.viewH * 1.5);

    this.run = {
      score: 0, pts: 0,           // очки: pts копит дробные доли с множителем
      coins: 0,                   // монет собрано (алмаз = 10)
      earned: 0,                  // монет выплачено за очки
      maxH: 0, milestone: 0, recordSaid: false, revived: false, doubled: false,
      bestAtStart: GameState.best,
      payIdx: 0,                  // сколько выплат за очки уже было
    };
    // «Жар»: level 0/1/2 = ×1/×2/×3; left — сколько секунд осталось на прыжок
    // (null — окно не идёт); from/fromY — откуда прыгнули; quick — прыгнули вовремя
    this.hot = { level: 0, energy: 0, left: null, leftAtLaunch: null, quick: false, from: null, fromY: 0 };
    this.x2 = 0;                  // сколько секунд ещё действуют монеты ×2
    this.jetGain = null;          // счёт в начале полёта на джетпаке — для счётчика «+N»
    this.fxT = 0;                 // таймер шлейфов
    this.dotT = 0;                // таймер «очков, летящих в счёт»
    this.skinFx = CONFIG.SKINS[GameState.skin]?.PREMIUM ? "ember" : null;
    this.aimJumps = 0;
    this.targeting = null;
    this.jet = null;
    this.tele = null;
    this.idleT = 0;
    this.nextIdle = SP.IDLE_FIRST;
    this.speechCd = 0;
    this.stepOut = { ev: 0, platform: null, hole: null, hitCount: 0, hits: [] };

    this.worldCtx = {
      hazards: false,
      hero:    this.hero,
      view:    this.view,
      diff:    0,
      onHit:   (kind, x, y, vx, vy) => this.onHazardHit(kind, x, y, vx, vy),
      say:     (group, chance) => this.say(group, chance),
    };

    this.input.on("pointerdown", this.onPointerDown, this);
    this.input.on("pointermove", this.onPointerMove, this);
    this.input.on("pointerup", this.onPointerUp, this);
    this.input.on("pointerupoutside", this.onPointerUp, this);
    this.input.keyboard?.on("keydown-ESC", () => (this.paused ? this.closePause() : this.openPause()));
    this.input.keyboard?.on("keydown-P", () => this.openPause());
    this.scale.on("resize", this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);

    this.updateCamera(0, this.hero.b.y);
    this.updateHud();
    // Фоновая музыка — с меню и без пауз между забегами (перезапуск сцены её не трогает)
    Audio.music(true);

    if (this.autostart) this.startRun();
    else this.showMenu();

    // Меню на экране, загрузки нет — игра готова к взаимодействию (п. 1.19.2)
    document.getElementById("preloader")?.remove();
    YSDK.loadingReady();
  }

  /** Масштаб: поле 540 ед. влезает по ширине, а на широком экране — по высоте. */
  layout() {
    const dpr = this.game.registry.get("dpr") || 1;
    this.dpr = dpr;
    this.cssW = this.scale.width / dpr;
    this.cssH = this.scale.height / dpr;
    this.ws = Math.min(this.cssW / V.MIN_W, this.cssH / V.MIN_H);   // CSS px на единицу мира
    this.viewW = this.cssW / this.ws;
    this.viewH = this.cssH / this.ws;
    const cam = this.cameras.main;
    cam.setSize(this.scale.width, this.scale.height);
    cam.setZoom(this.ws * dpr);
  }

  onResize() {
    this.layout();
    this.bg.resize(this.viewW, this.viewH);
    this.groundCamTop = -V.STAND_Y * this.viewH;
    const b = this.hero.b;
    if (this.mode === "menu") this.camTarget = this.camTop = -V.MENU_Y * this.viewH;
    else if (this.hero.state === "stand" && b.platform) this.camTarget = b.platform.top - V.STAND_Y * this.viewH;
    this.camTop = Math.min(this.camTop, this.groundCamTop);
    this.gen.fill(this.camTop - this.viewH * 1.5);
    this.updateCamera(0, b.y);
  }

  /* ═══════════════════════════════════════
     ЦИКЛ
  ═══════════════════════════════════════ */

  update(time, delta) {
    const rdt = Math.min(delta, 50) / 1000;
    const frozen = this.paused || this.sysPaused;
    if (!frozen) {
      this.acc += rdt;
      let n = 0;
      while (this.acc >= STEP && n < 10) {
        this.fixedStep(STEP);
        this.acc -= STEP;
        n++;
      }
      if (n >= 10) this.acc = 0;
      this.logicFrame(rdt);
    }
    this.renderFrame(frozen ? 0 : rdt, frozen);
  }

  fixedStep(dt) {
    const t = this.simTime;
    const h = this.hero;
    const b = h.b;
    h.px = b.x;
    h.py = b.y;

    const ctx = this.worldCtx;
    ctx.hazards = this.mode === "play";
    ctx.diff = this.gen.diff(-b.y);
    this.world.step(t, dt, ctx);

    // Прыжок применяется в начале шага — ровно из того состояния, из которого
    // рисовался прицел, поэтому траектория совпадает с предсказанием
    if (this.pendingLaunch) {
      const L = this.pendingLaunch;
      this.pendingLaunch = null;
      if (h.state === "stand" && this.mode === "play") this.doLaunch(L);
    }

    switch (h.state) {
      case "stand": this.stepStanding(t, dt); break;
      case "air":   if (this.targeting) this.stepHover(dt); else this.stepFlying(t, dt); break;
      case "jet":   this.stepJet(t, dt); break;
      case "tele":  this.stepTele(t, dt); break;
      case "dead":  this.stepDead(dt); break;
    }

    if (this.mode === "play") {
      if (h.state !== "dead" && h.state !== "tele") this.checkItems();
      this.stepHot(dt);
      if (this.x2 > 0) this.x2 = Math.max(0, this.x2 - dt);
    }
    h.invuln = Math.max(0, h.invuln - dt);
    this.simTime = t + dt;
  }

  /** То, что идёт в реальном времени, а не в игровом (реплики, таймауты). */
  logicFrame(rdt) {
    this.speechCd = Math.max(0, this.speechCd - rdt);
    const h = this.hero;

    if (this.mode === "play" && h.state === "stand" && !this.aim.active && !this.targeting) {
      this.idleT += rdt;
      if (this.idleT >= this.nextIdle) {
        this.say("idle", 1);
        this.nextIdle = this.idleT + SP.IDLE_REPEAT[0] + Math.random() * (SP.IDLE_REPEAT[1] - SP.IDLE_REPEAT[0]);
      }
    } else {
      this.idleT = 0;
      this.nextIdle = SP.IDLE_FIRST;
    }

    if (this.aim.active) {
      this.aim.holdTime += rdt;
      if (this.aim.holdTime > SP.AIM_LONG && !this.aim.saidLong) {
        this.aim.saidLong = true;
        this.say("aimLong", 0.8);
      }
    }

    if (this.targeting) {
      this.targeting.time -= rdt;
      if (this.targeting.time <= 0) this.stopTargeting();
    }

    this.world.cull(this.camTopMin + this.viewH * 2.6);
    this.gen.fill(this.camTop - this.viewH * 1.5);
  }

  renderFrame(rdt, frozen) {
    const alpha = frozen ? 1 : this.acc / STEP;
    const tR = this.simTime - STEP * (1 - alpha);
    const h = this.hero;

    this.updateCamera(rdt, h.py + (h.b.y - h.py) * alpha);
    this.bg.update(this.view, this.groundCamTop - this.camTop);
    this.world.render(tR, this.view, rdt, h.b);
    h.render(alpha, rdt);
    if (this.jet) this.fx.jet.followOffset.set(-h.facing * 22, 30);   // сопла — за спиной
    this.renderAim(rdt);
    this.renderTargets(tR);
    if (!frozen) this.renderTrails(rdt);
    // Пока тянем рогатку, кнопки HUD пропускают палец/мышь сквозь себя к игре
    this.hud.setAiming(this.aim.active && this.mode === "play");
    this.renderHud(rdt);

    const head = this.worldToCss(h.sprite.x, h.sprite.y - HERO_H * 0.62);
    this.bubble.update(rdt, head.x, head.y, this.cssW);
    this.tutorial.update(this.worldToCss(h.sprite.x, h.b.y));
  }

  /** Шлейф «жара» за героем и угольки премиум-скина. */
  renderTrails(rdt) {
    const h = this.hero;
    const s = h.state;
    this.fxT -= rdt;
    if (this.fxT > 0 || s === "dead" || s === "tele") return;
    this.fxT = 0.035;
    const x = h.sprite.x + (Math.random() - 0.5) * 26;
    const y = h.sprite.y + (Math.random() - 0.5) * 50;
    const moving = s === "air" || s === "jet";
    if (this.mode === "play" && this.hot.level > 0 && moving) this.fx.trail(this.hot.level >= HOT_MAX ? "hot2" : "hot1", x, y, 1);
    if (this.skinFx && (moving || Math.random() < 0.25)) this.fx.trail(this.skinFx, x, y, 1);
  }

  /** Всё, что HUD показывает непрерывно: жар, ×2, счётчик джетпака. */
  renderHud(rdt) {
    const H = this.hot;
    const win = H.left === null ? 0 : Math.max(0, H.left) / HOT.WINDOW[H.level];
    this.hud.setHot(H.level, H.energy, win);
    this.hud.setX2(this.x2);
    if (this.jetGain) {
      this.hud.gainSet(this.run.score - this.jetGain.from, this.mult);
      // Очки «слетаются» от героя в счёт
      this.dotT -= rdt;
      if (this.dotT <= 0) {
        this.dotT = 0.06;
        const p = this.worldToCss(this.hero.sprite.x, this.hero.sprite.y);
        this.hud.flyDot(p.x + (Math.random() - 0.5) * 30, p.y + (Math.random() - 0.5) * 30);
      }
    }
    this.hud.tick(rdt);
  }

  /* ═══════════════════════════════════════
     КАМЕРА
  ═══════════════════════════════════════ */

  updateCamera(rdt, heroY) {
    const h = this.hero;
    const head = heroY - HERO_H;
    if (h.state === "air") {
      // Вверх — сразу, без запаздывания; вниз в полёте камера не едет
      const need = head - V.FOLLOW_Y * this.viewH;
      if (need < this.camTop) this.camTop = this.camTarget = need;
    } else if (h.state === "jet") {
      this.camTop = this.camTarget = heroY - HERO_H / 2 - V.JET_Y * this.viewH;
    } else if (h.state !== "dead") {
      this.camTop += (this.camTarget - this.camTop) * (1 - Math.exp(-V.CAM_SPEED * rdt));
    }
    // Не ниже поверхности планеты и не дальше MAX_DROP экранов от рекорда
    const lowest = Math.min(this.groundCamTop, this.camTopMin + V.MAX_DROP * this.viewH);
    if (this.camTop > lowest) this.camTop = lowest;
    this.camTopMin = Math.min(this.camTopMin, this.camTop);

    this.cameras.main.centerOn(FIELD_W / 2, this.camTop + this.viewH / 2);
    const v = this.view;
    v.left = FIELD_W / 2 - this.viewW / 2;
    v.top = this.camTop;
    v.width = this.viewW;
    v.height = this.viewH;
  }

  screenToWorld(cssX, cssY) {
    return { x: this.view.left + cssX / this.ws, y: this.view.top + cssY / this.ws };
  }

  worldToCss(x, y) {
    return { x: (x - this.view.left) * this.ws, y: (y - this.view.top) * this.ws };
  }

  /* ═══════════════════════════════════════
     ГЕРОЙ: СОСТОЯНИЯ
  ═══════════════════════════════════════ */

  stepStanding(t, dt) {
    const h = this.hero;
    const b = h.b;
    const p = b.platform;
    if (!p || !p.alive || !p.solid) {
      h.toAir(0, 0);         // платформа рассыпалась или исчезла из-под ног
      return;
    }
    const slide = b.slide;
    if (stepStand(b, this.world.phys, t, dt)) {
      h.toAir(slide, 0);
      this.say("slip", 0.7);
    }
  }

  stepFlying(t, dt) {
    const h = this.hero;
    const b = h.b;
    const out = this.stepOut;
    out.hits.length = 0;
    stepAir(b, this.world.phys, t, dt, out);
    for (const hit of out.hits) this.onWallHit(hit);

    if (out.ev === EV_LAND) return this.onLand(out.platform, t + dt);
    if (out.ev === EV_SWALLOW) return this.die("hole", out.hole);
    if (this.mode !== "play") return;

    if (b.y - HERO_H > this.camTop + this.viewH + 30) return this.die("fall");

    if (!h.fallSaid && b.vy > 700 && b.y > h.launchY + 260) {
      h.fallSaid = true;
      this.say("falling", 0.8);
    }
    for (const hole of this.world.holes) {
      if (hole.warned || !hole.alive) continue;
      const dx = hole.x - b.x;
      const dy = hole.y - (b.y - HERO_H / 2);
      if (dx * dx + dy * dy < hole.range * hole.range * 0.6) {
        hole.warned = true;
        this.say("hole", 0.9);
      }
    }
  }

  doLaunch(L) {
    const h = this.hero;
    const b = h.b;
    this.hotLaunch();
    h.launchFrom = b.platform;
    h.launchY = b.y;
    h.bounces = 0;
    h.fallSaid = false;
    b.vx = L.vx;
    b.vy = L.vy;
    b.platform = null;
    b.slide = 0;
    h.state = "air";
    if (L.vx !== 0) h.facing = L.vx > 0 ? 1 : -1;
    h.onLaunch();
    if (this.aimJumps > 0) this.aimJumps--;
    Audio.play("jump");
    this.fx.burst("dust", b.x, b.y, 5);
    if (!GameState.tutorial) {
      GameState.tutorial = true;
      GameState.save();
      this.tutorial.hide();
      this.bubble.hide();
    }
    this.updateHud();
  }

  onWallHit(hit) {
    Audio.play("bounce");
    if (hit.side === 0) return;             // отскок от шапки мини-стены
    this.hero.bounces++;
    this.fx.burst("spark", hit.x, hit.y, 10);
  }

  onLand(p, tNow) {
    const h = this.hero;
    const b = h.b;
    const impact = b.vy;
    b.platform = p;
    b.localX = b.x - platformX(p, tNow);
    b.slide = b.vx * PH.LAND_KEEP_VX;       // настил скользкий — немного проезжаем
    b.vx = 0;
    b.vy = 0;
    b.y = p.top;
    h.state = "stand";
    h.onLanded(impact > 1300);
    h.lastPlatform = p;
    this.fx.burst("dust", b.x, b.y, impact > 900 ? 8 : 5);
    Audio.play("land");
    if (impact > 1500) this.cameras.main.shake(90, 0.004);
    this.camTarget = p.top - V.STAND_Y * this.viewH;
    this.idleT = 0;

    if (this.mode !== "play") return;

    let said = false;
    const sayOnce = (group, chance) => { if (!said && this.say(group, chance)) said = true; };

    // Правило пар: встал на лёгкую — сложная с монетками исчезает
    if (p.pairGroup && !p.pairGroup.gone) {
      this.world.vanishGroup(p.pairGroup);
      sayOnce("vanish", 0.35);
    }
    if (p.crumble && !p.crumble.on) {
      p.crumble.on = true;
      Audio.play("crack");
      sayOnce("crumble", 0.9);
    }
    for (const c of p.coins) if (c.alive) this.takeCoin(c);
    if (p.pickup?.alive) this.takePickup(p.pickup);

    if (p.hard && !p.visited) {
      this.addBonus(SC.HARD_BONUS, t("bonusHard"), b.x, b.y - HERO_H - 34, "#ffd166");
      sayOnce("hard", 0.45);
    }
    const higher = h.launchFrom && p !== h.launchFrom && p.top < h.launchFrom.top - 20;
    if (h.bounces > 0 && higher) {
      const n = h.bounces;
      this.addBonus(SC.RICOCHET_BONUS * n, t("bonusRico") + (n > 1 ? ` ×${n}` : ""), b.x, b.y - HERO_H - 74, "#ffb347");
      sayOnce("ricochet", 0.5);
    }
    p.visited = true;
    h.bounces = 0;

    if (p.kind !== "ground" && Math.abs(b.localX) > p.halfW - 2) sayOnce("edge", 0.8);
    this.reachHeight(-p.top);
    this.hotLand(p);            // после очков: бонусы прыжка идут по множителю, с которым прыгнули
    this.updateHud();
  }

  stepDead(dt) {
    const h = this.hero;
    const b = h.b;
    if (h.suck) {
      const k = Math.min(1, dt * 5);
      b.x += (h.suck.x - b.x) * k;
      b.y += (h.suck.y + HERO_H / 2 - b.y) * k;
    } else {
      b.vy = Math.min(b.vy + PH.GRAVITY * dt, PH.MAX_FALL);
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }
  }

  /* ═══════════════════════════════════════
     ВВОД: РОГАТКА
  ═══════════════════════════════════════ */

  fullPull() {
    return Math.max(J.FULL_PULL_MIN, Math.min(J.FULL_PULL_MAX, J.FULL_PULL * Math.min(this.cssW, this.cssH)));
  }

  onPointerDown(p) {
    if (this.mode !== "play" || this.paused || this.sysPaused) return;
    const x = p.x / this.dpr;
    const y = p.y / this.dpr;
    if (this.targeting) return this.pickTarget(x, y);
    if (this.aim.active) return;
    const s = this.hero.state;
    if (s === "dead" || s === "jet" || s === "tele") return;
    // Целиться можно и в полёте — прицел появится, как только герой приземлится
    this.aim.begin(p.id, x, y);
    this.hud.setAiming(true);   // сразу, не дожидаясь кадра: палец уже может ехать к кнопкам
    this.idleT = 0;
  }

  onPointerMove(p) {
    if (this.aim.pointerId === p.id) this.aim.move(p.x / this.dpr, p.y / this.dpr);
  }

  onPointerUp(p) {
    if (this.aim.pointerId !== p.id) return;
    this.aim.move(p.x / this.dpr, p.y / this.dpr);
    const L = this.aim.end(this.fullPull());
    this.hero.aiming = false;
    if (L && L.valid && this.hero.state === "stand" && this.mode === "play" && !this.paused) {
      this.pendingLaunch = L;
      this.aim.fadeOut();
    } else {
      this.aim.cancel();
    }
  }

  renderAim(rdt) {
    const h = this.hero;
    if (this.aim.active && this.mode === "play" && !this.paused) {
      const L = this.aim.compute(this.fullPull());
      const standing = h.state === "stand";
      h.aiming = standing && !!L && L.valid;
      if (h.aiming) {
        if (L.vx !== 0) h.facing = L.vx > 0 ? 1 : -1;
        this.aim.drawPreview(h.b, L, this.world.phys, this.simTime, this.aimJumps > 0, this.camTop + this.viewH + 40);
      } else {
        this.aim.clearPreview();
      }
      this.aim.drawPull((x, y) => this.screenToWorld(x, y), L, 1 / this.ws);
    } else {
      h.aiming = false;
      this.aim.update(rdt);
    }
  }

  /* ═══════════════════════════════════════
     МОНЕТЫ, БУСТЕРЫ НА ПЛАТФОРМАХ, ОЧКИ
  ═══════════════════════════════════════ */

  checkItems() {
    const b = this.hero.b;
    for (const c of this.world.coins) if (c.alive && circleHitsHero(c.x, c.y, 17, b)) this.takeCoin(c);
    for (const k of this.world.pickups) if (k.alive && circleHitsHero(k.x, k.y, 24, b)) this.takePickup(k);
  }

  takeCoin(c) {
    if (!this.world.collectCoin(c)) return;
    const diamond = c.kind === "diamond";
    const n = (diamond ? CO.DIAMOND : 1) * (this.x2 > 0 ? 2 : 1);
    this.run.coins += n;
    GameState.addCoins(n);
    Audio.play(diamond ? "diamond" : "coin");
    this.fx.text(c.x, c.y - 24, `+${n}`, diamond ? "#8ff3ff" : "#ffd84a", diamond ? 30 : 24);
    this.hud.bumpCoins();
    if (diamond) this.say("diamond", 0.7);
    else this.say("coin", 0.25);
    this.addPoints(diamond ? SC.DIAMOND_SCORE : SC.COIN_SCORE);
  }

  takePickup(k) {
    if (!this.world.collectPickup(k)) return;
    if (k.type === "x2") {
      // «Монеты ×2» не идёт в запас — действует сразу; второй продлевает
      const was = this.x2;
      this.x2 = Math.min(CO.X2_MAX, this.x2 + CO.X2_TIME);
      Audio.play("x2");
      this.fx.text(k.x, k.y - 34, t("b_x2"), "#ffd84a", 26);
      this.hud.toast(was > 0 ? t("x2More", Math.ceil(this.x2)) : t("x2On"), 2200);
      this.say("x2", 0.8);
      this.updateHud();
      return;
    }
    GameState.addBooster(k.type);
    Audio.play("pickup");
    this.fx.text(k.x, k.y - 34, t("b_" + k.type), "#7ff0ff", 22);
    this.hud.flash(k.type);
    this.say("pickup", 0.6);
    this.updateHud();
  }

  /** Множитель очков от «жара»: ×1, ×2, ×3. */
  get mult() {
    return this.hot.level + 1;
  }

  addPoints(n) {
    this.run.pts += n * this.mult;
    this.recalcScore();
  }

  addBonus(n, label, x, y, color) {
    const v = n * this.mult;
    this.run.pts += v;
    this.fx.text(x, y, `${label} +${v}`, color, 22);
    this.recalcScore();
  }

  /** Очки за высоту — за каждый новый метр, с текущим множителем. */
  reachHeight(hUnits) {
    const r = this.run;
    if (hUnits <= r.maxH) return;
    r.pts += ((hUnits - r.maxH) / SC.PER_UNITS) * this.mult;
    r.maxH = hUnits;
    const meters = Math.floor(hUnits / SC.METER);
    const ms = Math.floor(meters / SC.MILESTONE_M);
    if (ms > r.milestone) {
      r.milestone = ms;
      this.say("milestone", 1, ms * SC.MILESTONE_M);
    }
    this.recalcScore();
  }

  recalcScore() {
    const r = this.run;
    r.score = Math.floor(r.pts + 1e-6);
    if (!r.recordSaid && r.bestAtStart > 0 && r.score > r.bestAtStart) {
      r.recordSaid = true;
      Audio.play("record");
      this.hud.recordFlash();
      this.hud.toast(t("recordZone"), 2600);
      this.say("record", 1);
    }
    this.checkPayout();
    this.updateHud();
  }

  /* ─── Монеты за очки ─── */

  /** Выплата с номером idx: сколько монет и идёт ли она «выше рекорда». */
  payoutFor(idx) {
    const at = (idx + 1) * PAY.EVERY;
    const rec = this.run.bestAtStart > 0 && at > this.run.bestAtStart;
    const n = Math.min(PAY.MAX, PAY.BASE + PAY.STEP * idx) * (rec ? PAY.RECORD_MULT : 1) * (this.x2 > 0 ? 2 : 1);
    return { n, rec, at };
  }

  /** Каждые PAY.EVERY очков — монеты, и каждая следующая выплата больше. */
  checkPayout() {
    const r = this.run;
    for (let guard = 0; guard < 50; guard++) {
      const p = this.payoutFor(r.payIdx);
      if (r.score < p.at) break;
      r.payIdx++;
      r.earned += p.n;
      GameState.addCoins(p.n);
      this.hud.payout(p.n, p.rec);
      Audio.play("cash");
      if (r.payIdx === 1 && GameState.hintOnce("pay")) this.hud.toast(t("payHint"), 2800);
    }
  }

  updateHud() {
    const r = this.run;
    this.hud.setScore(r.score, Math.max(r.bestAtStart, r.score), r.recordSaid);
    this.hud.setCoins(GameState.wallet);
    this.hud.setBoosters(GameState.boosters, { aim: this.aimJumps, targeting: !!this.targeting, jet: !!this.jet });
    const next = this.payoutFor(r.payIdx);
    this.hud.setPay((r.score - (next.at - PAY.EVERY)) / PAY.EVERY, next.n, next.rec);
  }

  /* ═══════════════════════════════════════
     ЖАР: быстрые прыжки → множитель очков
  ═══════════════════════════════════════ */

  /** Прыжок с платформы (или джетпак, телепорт): успели ли в окно. */
  hotLaunch() {
    const H = this.hot;
    const b = this.hero.b;
    H.quick = H.left !== null && H.left > 0;
    H.leftAtLaunch = H.left;
    H.from = b.platform;
    H.fromY = b.y;
    H.left = null;
  }

  hotLand(p) {
    const H = this.hot;
    if (p === H.from && H.leftAtLaunch !== null) {
      // Подпрыгнул на месте — окно не обновляется, часики тикают дальше
      H.left = H.leftAtLaunch;
      H.quick = false;
      H.from = null;
      return;
    }
    if (H.quick && p.top < H.fromY - 20) this.hotGain();
    H.quick = false;
    H.from = null;
    H.left = HOT.WINDOW[H.level];
  }

  hotGain() {
    const H = this.hot;
    if (H.level >= HOT_MAX) return;
    H.energy = Math.min(1, H.energy + HOT.GAIN[H.level]);
    if (H.energy < 1 - 1e-6) {
      Audio.play("energy");
      if (GameState.hintOnce("hot")) this.hud.toast(t("hotHint"), 3600);
      return;
    }
    H.level++;
    H.energy = H.level >= HOT_MAX ? 1 : 0;
    const b = this.hero.b;
    Audio.play("hotUp");
    this.hud.hotUp();
    this.hud.toast(t("hotUp", H.level + 1), 1800);
    this.fx.burst(H.level >= HOT_MAX ? "hot2" : "hot1", b.x, b.y - HERO_H / 2, 26);
    this.say("hotUp", 0.9);
  }

  /** Жар сгорел: опоздал с прыжком или сбили. */
  hotBreak(quiet = false) {
    const H = this.hot;
    const had = H.level > 0 || H.energy > 0;
    const lvl = H.level;
    H.level = 0;
    H.energy = 0;
    H.left = null;
    H.leftAtLaunch = null;
    H.quick = false;
    H.from = null;
    if (!had || quiet) return;
    Audio.play("hotLost");
    this.hud.hotLost();
    if (lvl > 0) this.say("hotLost", 0.7);
  }

  /** Окно на прыжок тикает, только пока герой стоит (и не выбирает цель телепорта). */
  stepHot(dt) {
    const H = this.hot;
    if (H.left === null || this.hero.state !== "stand" || this.targeting) return;
    H.left -= dt;
    if (H.left <= 0) this.hotBreak();
  }

  /* ═══════════════════════════════════════
     БУСТЕРЫ
  ═══════════════════════════════════════ */

  onBoosterButton(k) {
    if (this.mode !== "play" || this.paused || this.sysPaused) return;
    const s = this.hero.state;
    if (k === "teleport" && this.targeting) return this.stopTargeting();
    if (s === "dead" || s === "tele" || (s === "jet" && k !== "aim")) return;
    if (GameState.count(k) <= 0) return this.openBoosterPopup(k);
    this.useBooster(k);
  }

  useBooster(k) {
    switch (k) {
      case "jetpack":  return this.useJetpack();
      case "teleport": return this.startTargeting();
      case "aim":      return this.useAim();
      case "breaker":  return this.useBreaker();
    }
    return false;
  }

  /* ─── Джетпак: уносит вверх и сажает на надёжную платформу ─── */

  useJetpack() {
    const h = this.hero;
    const b = h.b;
    const goal = b.y - B.jetpack.DIST;
    this.gen.fill(goal - this.viewH * 2);

    // Ближайшая к цели надёжная платформа выше неё (не сложная и не ломающаяся)
    let target = null;
    for (const p of this.world.platforms) {
      if (!p.alive || !p.solid || p.hard || p.crumble || p.kind === "ground" || p.top > goal) continue;
      if (!target || p.top > target.top) target = p;
    }
    if (!target) target = this.world.addPlatform({ kind: "normal", x: FIELD_W / 2, y: Math.round(goal), w: 150 });
    if (!GameState.useBooster("jetpack")) return false;

    this.stopTargeting();
    this.aim.cancel();
    this.pendingLaunch = null;
    if (h.state === "stand") this.hotLaunch();   // взлёт с платформы — как прыжок
    b.platform = null;
    b.slide = 0;
    h.state = "jet";
    h.invuln = Math.max(h.invuln, 0.5);
    this.jet = { target, phase: "rise", vy: Math.min(b.vy, 0), t: 0, x0: 0, y0: 0 };
    // Очки за высоту в полёте начисляются сразу — HUD показывает счётчик «+N»
    this.jetGain = { from: this.run.score };
    this.hud.gainStart();
    Audio.loop("jet", true);
    this.fx.jetOn(h.sprite, -h.facing * 22, 30);
    this.say("jetpack", 0.9);
    this.updateHud();
    return true;
  }

  stepJet(t, dt) {
    const J2 = this.jet;
    const h = this.hero;
    const b = h.b;
    const p = J2.target;
    const cfg = B.jetpack;
    const tx = platformX(p, t + dt);

    if (J2.phase === "rise") {
      J2.vy = Math.max(J2.vy - cfg.ACC * dt, -cfg.SPEED);
      b.y += J2.vy * dt;
      b.x += (tx - b.x) * (1 - Math.exp(-2.2 * dt));
      if (b.y <= p.top - 150) {
        J2.phase = "settle";
        J2.t = 0;
        J2.x0 = b.x;
        J2.y0 = b.y;
      }
    } else {
      // Мягкая посадка сверху на платформу-цель
      J2.t = Math.min(1, J2.t + dt / 0.55);
      const k = J2.t * J2.t * (3 - 2 * J2.t);
      b.x = J2.x0 + (tx - J2.x0) * k;
      b.y = J2.y0 + (p.top - J2.y0) * k;
      J2.vy = 0;
      if (J2.t >= 1) {
        this.endJet();
        h.launchFrom = null;
        h.bounces = 0;
        b.vx = 0;
        b.vy = 0;
        if (p.alive && p.solid) this.onLand(p, t + dt);
        else h.toAir(0, 0);
        return;
      }
    }
    if (Math.abs(tx - b.x) > 6) h.facing = tx > b.x ? 1 : -1;
    b.vx = 0;
    b.vy = J2.vy;
    if (this.mode === "play") this.reachHeight(-b.y);
  }

  endJet() {
    if (!this.jet) return;
    this.jet = null;
    Audio.loop("jet", false);
    this.fx.jetOff();
    if (this.jetGain) {
      this.hud.gainEnd(this.run.score - this.jetGain.from);
      this.jetGain = null;
    }
    this.updateHud();
  }

  /* ─── Телепорт: выбрать платформу на экране ─── */

  startTargeting() {
    const b = this.hero.b;
    const v = this.view;
    const targets = this.world.platforms.filter(p =>
      p.alive && p.solid && p.kind !== "ground" && p !== b.platform &&
      p.top < b.y - 40 && p.top > v.top + 60 && p.top < v.top + v.height - 40);
    if (!targets.length) {
      this.hud.toast(t("noTargets"));
      return false;
    }
    this.aim.cancel();
    this.pendingLaunch = null;
    const rings = targets.map(p => {
      const r = this.add.image(0, 0, "ph_ring").setDepth(49)
        .setTint(p.hard ? 0xffd166 : 0x7ff0ff)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDisplaySize(p.halfW * 2 + 56, 44);
      this.tweens.add({ targets: r, alpha: { from: 1, to: 0.4 }, duration: 360, yoyo: true, repeat: -1 });
      return { p, r };
    });
    // Время не замедляется: метеориты и платформы живут в обычном темпе.
    // В полёте герой зависает, пока игрок выбирает, — иначе упадёт раньше
    const hover = this.hero.state === "air" ? { vx: b.vx, vy: b.vy } : null;
    if (hover) b.vx = b.vy = 0;
    this.targeting = { rings, time: B.teleport.TIMEOUT, hover };
    this.hud.toast(t("pickTarget"), 2500);
    this.updateHud();
    return true;
  }

  stopTargeting() {
    const T = this.targeting;
    if (!T) return;
    for (const { r } of T.rings) {
      this.tweens.killTweensOf(r);
      r.destroy();
    }
    this.targeting = null;
    // Передумал — полёт продолжается с той же скоростью
    const h = this.hero;
    if (T.hover && h.state === "air") {
      h.b.vx = T.hover.vx;
      h.b.vy = T.hover.vy;
    }
    this.updateHud();
  }

  /** Выбор цели телепорта в полёте: герой висит на месте в искрах. */
  stepHover(dt) {
    const b = this.hero.b;
    b.vx = b.vy = 0;
    if (Math.random() < dt * 14) this.fx.trail("magic", b.x + (Math.random() - 0.5) * 50, b.y - HERO_H / 2 + (Math.random() - 0.5) * 80, 1);
  }

  renderTargets(tR) {
    if (!this.targeting) return;
    for (const { p, r } of this.targeting.rings) {
      r.setVisible(p.alive);
      r.setPosition(platformX(p, tR), p.top + 2);
    }
  }

  pickTarget(cssX, cssY) {
    const w = this.screenToWorld(cssX, cssY);
    let best = null;
    let bestD = Infinity;
    for (const { p } of this.targeting.rings) {
      if (!p.alive) continue;
      const dx = Math.max(0, Math.abs(w.x - platformX(p, this.simTime)) - p.halfW);
      const dy = w.y < p.top - 130 ? p.top - 130 - w.y : (w.y > p.top + 70 ? w.y - p.top - 70 : 0);
      const d = Math.hypot(dx, dy);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (best && bestD < 50) this.teleportTo(best);
    else this.hud.toast(t("pickTarget"), 1500);
  }

  teleportTo(p) {
    if (!GameState.useBooster("teleport")) return this.stopTargeting();
    this.stopTargeting();
    const h = this.hero;
    const b = h.b;
    if (h.state === "stand") this.hotLaunch();   // с платформы — как прыжок; из полёта жар прыжка сохраняется
    b.platform = null;
    b.vx = b.vy = 0;
    b.slide = 0;
    h.state = "tele";
    this.tele = { phase: "out", t: 0, target: p };
    Audio.play("teleport");
    this.fx.burst("magic", b.x, b.y - HERO_H / 2, 18);
    this.say("teleport", 0.8);
    this.updateHud();
  }

  stepTele(t, dt) {
    const h = this.hero;
    const b = h.b;
    const T = this.tele;
    const p = T.target;
    const D = 0.22;
    T.t += dt;

    if (T.phase === "out") {
      h.fade = Math.max(0, 1 - T.t / D);
      if (T.t < D) return;
      if (!p.alive || !p.solid) {
        h.fade = 1;
        this.tele = null;
        h.toAir(0, 0);
        return;
      }
      b.x = platformX(p, t + dt);
      b.y = p.top;
      h.px = b.x;              // без «размазывания» интерполяцией через весь экран
      h.py = b.y;
      T.phase = "in";
      T.t = 0;
      this.fx.burst("magic", b.x, b.y - HERO_H / 2, 18);
      this.camTarget = p.top - V.STAND_Y * this.viewH;
      return;
    }

    b.x = platformX(p, t + dt);
    b.y = p.top;
    h.fade = Math.min(1, T.t / D);
    if (T.t < D) return;
    h.fade = 1;
    this.tele = null;
    h.launchFrom = null;
    h.bounces = 0;
    if (p.alive && p.solid) this.onLand(p, t + dt);
    else h.toAir(0, 0);
  }

  /* ─── Точный прицел и разрушитель стен ─── */

  useAim() {
    if (!GameState.useBooster("aim")) return false;
    this.aimJumps += B.aim.JUMPS;
    this.hud.toast(t("aimOn", this.aimJumps));
    this.say("aimOn", 0.7);
    this.updateHud();
    return true;
  }

  useBreaker() {
    const v = this.view;
    const walls = this.world.walls.filter(w => w.alive && w.y2 > v.top - v.height * 0.3 && w.y1 < v.top + v.height);
    if (!walls.length) {
      this.hud.toast(t("noWalls"));
      return false;
    }
    if (!GameState.useBooster("breaker")) return false;
    for (const w of walls) this.world.destroyWall(w);
    this.cameras.main.shake(160, 0.006);
    this.say("breaker", 0.8);
    this.updateHud();
    return true;
  }

  /** Бустер закончился — купить за монеты или получить за рекламу. */
  openBoosterPopup(k) {
    this.paused = true;
    this.aim.cancel();
    this.stopTargeting();
    this.pendingLaunch = null;
    this.syncGameplay();

    const done = got => {
      UI.close();
      this.paused = false;
      this.syncGameplay();
      this.updateHud();
      if (got) this.useBooster(k);
    };
    UI.boosterPopup(k, {
      onBuy: (n = 1) => {
        if (GameState.buyBooster(k, n)) {
          Audio.play("buy");
          done(true);
        } else {
          UI.status(GameState.count(k) + n > B.MAX ? t("maxReached") : t("notEnough"));
        }
      },
      onAd: async () => {
        const ok = await this.rewarded();
        if (ok) {
          GameState.addBooster(k);
          done(true);
        } else {
          UI.status(t("adFailed"));
        }
        return ok;
      },
      onClose: () => done(false),
    });
  }

  /* ═══════════════════════════════════════
     ОПАСНОСТИ
  ═══════════════════════════════════════ */

  onHazardHit(kind, x, y, dx, dy) {
    const h = this.hero;
    if (this.mode !== "play" || h.invuln > 0 || h.state === "jet" || h.state === "tele" || h.state === "dead") return;

    let vx, vy;
    if (kind === "meteor") {
      // Метеорит сбивает вбок по ходу своего полёта и подбрасывает
      vx = (Math.sign(dx) || 1) * HZ.METEOR.KNOCK[0];
      vy = -HZ.METEOR.KNOCK[1];
    } else {
      // Взрыв ракеты отбрасывает от эпицентра
      vx = dx * HZ.TURRET.KNOCK;
      vy = Math.min(-220, dy * HZ.TURRET.KNOCK);
    }
    if (this.hero.state === "stand" && this.aim.active) this.aim.cancel();
    this.pendingLaunch = null;
    this.stopTargeting();       // сбили, пока выбирал платформу, — выбор отменяется, бустер цел
    this.hotBreak();            // удар метеорита или ракеты гасит жар
    h.toAir(vx, vy);
    h.onHit();
    h.invuln = HZ.INVULN;
    h.bounces = 0;
    h.fallSaid = false;
    this.fx.burst(kind === "meteor" ? "fire" : "spark", h.b.x, h.b.y - HERO_H / 2, 14);
    Audio.play("hit");
    this.cameras.main.shake(140, 0.007);
    this.say("hit", 1);
  }

  /* ═══════════════════════════════════════
     РЕПЛИКИ
  ═══════════════════════════════════════ */

  /** @returns {boolean} прозвучала ли реплика */
  say(group, chance = 1, arg) {
    if (this.mode !== "play") return false;
    if (Math.random() > chance) return false;
    if (this.speechCd > 0 && !URGENT.has(group)) return false;
    if (!GameState.tutorial && group !== "start") return false;   // не перебиваем обучение
    const text = line(group, arg);
    if (!text) return false;
    this.bubble.say(text);
    this.speechCd = SP.COOLDOWN;
    return true;
  }

  /* ═══════════════════════════════════════
     ЗАБЕГ
  ═══════════════════════════════════════ */

  showMenu() {
    this.mode = "menu";
    this.hud.hide();
    UI.menu({
      onPlay:    () => this.startRun(),
      onShop:    tab => UI.shop(this.shopHandlers(() => this.showMenu()), tab),
      onLeaders: () => UI.leaders({ onBack: () => this.showMenu() }),
      onLogin:   async () => {
        if (await YSDK.openAuthDialog()) {
          await GameState.load();
          await this.applySkin(GameState.skin);
          this.showMenu();
        }
      },
      onSound:   () => this.toggleSound(),
    });
    this.syncGameplay();
  }

  startRun() {
    UI.close();
    this.mode = "play";
    this.hud.show();
    if (this.hero.b.platform === this.world.ground) this.camTarget = this.groundCamTop;   // камера плавно опускается из «меню»
    GameState.runs++;
    GameState.save();
    this.updateHud();
    if (!GameState.tutorial) {
      this.tutorial.show();
      this.bubble.say(t("tutorial"), 8);
    } else {
      this.say("start", 1);
    }
    this.syncGameplay();
  }

  die(cause, hole) {
    if (this.mode !== "play") return;
    this.mode = "dead";
    const h = this.hero;
    h.state = "dead";
    this.aim.cancel();
    this.stopTargeting();
    this.endJet();
    this.pendingLaunch = null;
    this.tutorial.hide();
    Audio.stopLoops();

    if (cause === "hole") {
      h.suck = hole;
      Audio.play("swallow");
      this.tweens.add({ targets: h, fade: 0, duration: 900, ease: "Cubic.easeIn" });
    } else {
      Audio.play("fall");
    }
    this.cameras.main.shake(180, 0.006);
    GameState.deaths++;
    this.syncGameplay();
    this.time.delayedCall(cause === "hole" ? 1100 : 750, () => this.gameOver());
  }

  gameOver() {
    this.mode = "over";
    const heightM = Math.floor(this.run.maxH / SC.METER);
    const record = GameState.recordScore(this.run.score, heightM);
    YSDK.submitScore(CONFIG.LEADERBOARD, GameState.best);
    this.hud.hide();
    this.bubble.hide();
    this.showGameOver(record);
    this.maybeFullscreen();
  }

  showGameOver(record) {
    const r = this.run;
    const total = r.coins + r.earned;
    UI.gameOver({
      score:     r.score,
      best:      GameState.best,
      heightM:   Math.floor(r.maxH / SC.METER),
      runCoins:  total * (r.doubled ? 2 : 1),
      picked:    r.coins,
      earned:    r.earned,
      doubled:   r.doubled,
      canDouble: ADS.DOUBLE_COINS && !r.doubled && total > 0,
      record,
      canRevive: !r.revived,
    }, {
      onRevive:  btn => this.revive(btn),
      onDouble:  btn => this.doubleCoins(btn, record),
      onAgain:   () => this.restart(true),
      onMenu:    () => this.restart(false),
      onShop:    tab => UI.shop(this.shopHandlers(() => this.showGameOver(record)), tab),
      onLeaders: () => UI.leaders({ onBack: () => this.showGameOver(record) }),
    });
  }

  /** Удвоить монеты забега за рекламу — один раз за забег. */
  async doubleCoins(btn, record) {
    if (this.adBusy || this.run.doubled) return;
    btn.disabled = true;
    const ok = await this.rewarded();
    if (!ok) {
      if (UI.el) {
        btn.disabled = false;
        UI.status(t("adFailed"));
      }
      return;
    }
    const r = this.run;
    r.doubled = true;
    GameState.addCoins(r.coins + r.earned);
    Audio.play("cash");
    if (this.mode === "over") {
      this.showGameOver(record);
      UI.status(t("doubled"), true);
    }
  }

  /** Продолжить за рекламу: космонавт возвращается на последнюю надёжную платформу. */
  async revive(btn) {
    if (this.adBusy) return;
    btn.disabled = true;
    btn.innerHTML = t("adLoading");
    const ok = await this.rewarded();
    if (!ok) {
      if (UI.el) {
        btn.disabled = false;
        btn.innerHTML = icon("play") + t("continueAd");
        UI.status(t("adFailed"));
      }
      return;
    }
    UI.close();
    this.run.revived = true;

    const h = this.hero;
    const b = h.b;
    let p = h.lastPlatform;
    if (!p || !p.alive || !p.solid || p.crumble) {
      const src = p || this.world.ground;
      const w = Math.max(110, src.halfW * 2);
      const x = Math.max(w / 2, Math.min(FIELD_W - w / 2, src.baseX));
      p = this.world.addPlatform({ kind: "normal", x, y: src.top, w });
    }
    this.tweens.killTweensOf(h);
    h.suck = null;
    h.fade = 1;
    h.sprite.rotation = 0;
    b.platform = p;
    b.localX = 0;
    b.slide = 0;
    b.vx = b.vy = 0;
    b.x = platformX(p, this.simTime);
    b.y = p.top;
    h.px = b.x;
    h.py = b.y;
    h.state = "stand";
    h.invuln = ADS.REVIVE_INVULN;
    this.hotBreak(true);
    this.world.clearThreats();
    this.camTarget = p.top - V.STAND_Y * this.viewH;
    this.camTop = this.camTarget;
    this.mode = "play";
    this.hud.show();
    this.updateHud();
    this.say("revive", 1);
    this.syncGameplay();
  }

  restart(autostart) {
    // Рекорд досрочно прерванного забега тоже засчитываем
    if (this.mode === "play" && this.run.score > 0) {
      GameState.recordScore(this.run.score, Math.floor(this.run.maxH / SC.METER));
    }
    UI.close();
    this.scene.restart({ autostart });
  }

  async maybeFullscreen() {
    if (GameState.deaths % ADS.FULLSCREEN_EVERY !== 0) return;
    if (Date.now() - lastFullscreenAt < ADS.FULLSCREEN_MIN_GAP * 1000) return;
    lastFullscreenAt = Date.now();
    this.adBusy = true;
    Audio.pause();
    await YSDK.showFullscreen();
    Audio.resume();
    this.adBusy = false;
  }

  /** Реклама за вознаграждение со звуком на паузе. */
  async rewarded() {
    this.adBusy = true;
    Audio.pause();
    const ok = await YSDK.showRewarded();
    Audio.resume();
    this.adBusy = false;
    return ok;
  }

  shopHandlers(onBack) {
    const bought = ok => {
      if (ok) {
        Audio.play("buy");
        this.updateHud();
      }
      return ok;
    };
    return {
      onBack,
      /** Только на тестовых хостах (кнопка видна лишь там — см. src/testing.js). */
      onTestCoins: () => {
        GameState.addCoins(CONFIG.TEST.COINS);
        Audio.play("cash");
        this.updateHud();
      },
      /** Купить n штук бустера (n > 1 — пачка со скидкой). */
      onBuy: (k, n = 1) => {
        if (bought(GameState.buyBooster(k, n))) return true;
        UI.status(GameState.count(k) + n > B.MAX ? t("maxReached") : t("notEnough"));
        return false;
      },
      onBuySet: set => {
        if (bought(GameState.buySet(set))) return true;
        UI.status(B.ORDER.some(k => GameState.count(k) + set.EACH > B.MAX) ? t("maxReached") : t("notEnough"));
        return false;
      },
      onAd: async k => {
        const ok = await this.rewarded();
        if (ok) {
          if (k === "coins") GameState.addCoins(ADS.REWARD_COINS);
          else GameState.addBooster(k);
          this.updateHud();
        } else {
          UI.status(t("adFailed"));
        }
        return ok;
      },
      /** Скин: купить (если ещё нет) и надеть. @returns {Promise<boolean>} */
      onSkin: async id => {
        if (!GameState.hasSkin(id)) {
          if (!GameState.buySkin(id)) {
            UI.status(t("notEnough"));
            return false;
          }
          Audio.play("buy");
        } else {
          GameState.equipSkin(id);
        }
        await this.applySkin(id);
        this.updateHud();
        return true;
      },
    };
  }

  /** Подгрузить атлас скина (если ещё не загружен) и переодеть героя. */
  async applySkin(id) {
    await Art.loadSkin(this, id);
    if (!this.sys.isActive()) return;
    Art.setSkin(id);
    this.hero.refreshSkin();
    this.skinFx = CONFIG.SKINS[id]?.PREMIUM ? "ember" : null;
    this.fx.burst("magic", this.hero.b.x, this.hero.b.y - HERO_H / 2, 16);
  }

  /* ═══════════════════════════════════════
     ПАУЗА И РАЗМЕТКА ГЕЙМПЛЕЯ
  ═══════════════════════════════════════ */

  openPause() {
    if (this.mode !== "play" || this.paused) return;
    this.paused = true;
    this.aim.cancel();
    this.stopTargeting();
    this.pendingLaunch = null;
    UI.pause({
      onResume:  () => this.closePause(),
      onRestart: () => this.restart(true),
      onMenu:    () => this.restart(false),
      onSound:   () => this.toggleSound(),
    });
    this.syncGameplay();
  }

  closePause() {
    if (!this.paused || UI.el?.classList.contains("popup")) return;
    UI.close();
    this.paused = false;
    this.syncGameplay();
  }

  toggleSound() {
    GameState.muted = !GameState.muted;
    Audio.setMuted(GameState.muted);
    GameState.save();
  }

  /**
   * Пауза платформы (game_api_pause / resume) или скрытая вкладка.
   * Во время забега сразу открываем меню паузы — игрок вернётся к паузе,
   * а не к падению в пропасть.
   */
  onSystemPause(on) {
    this.sysPaused = on;
    if (on) {
      Audio.pause();
      this.aim.cancel();
      if (this.mode === "play" && !this.paused && !this.adBusy) this.openPause();
    } else if (!this.adBusy) {
      Audio.resume();
    }
    this.syncGameplay();
  }

  /** GameplayAPI.start/stop строго по факту: забег идёт и ничто его не держит. */
  syncGameplay() {
    YSDK.setGameplay(this.mode === "play" && !this.paused && !this.sysPaused && !document.hidden);
  }

  onShutdown() {
    this.input.off("pointerdown", this.onPointerDown, this);
    this.input.off("pointermove", this.onPointerMove, this);
    this.input.off("pointerup", this.onPointerUp, this);
    this.input.off("pointerupoutside", this.onPointerUp, this);
    this.input.keyboard?.off("keydown-ESC");
    this.input.keyboard?.off("keydown-P");
    this.scale.off("resize", this.onResize, this);
    this.hud.destroy();
    this.bubble.destroy();
    this.tutorial.destroy();
    this.bg.destroy();
    Audio.stopLoops();
    YSDK.setGameplay(false);
  }
}
