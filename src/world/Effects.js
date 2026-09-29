/**
 * Effects — частицы и всплывающие надписи.
 * Все эмиттеры общие и работают в режиме explode / emitParticleAt: так на
 * сцене не копятся объекты, сколько бы метеоритов и ракет ни пролетело.
 */
const FONT = '"Trebuchet MS", "Segoe UI", Roboto, Arial, sans-serif';

export default class Effects {
  constructor(scene) {
    this.scene = scene;
    const P = (tex, depth, cfg) => scene.add.particles(0, 0, tex, { emitting: false, ...cfg }).setDepth(depth);

    this.dust = P("ph_smoke", 26, {
      lifespan: 480, speed: { min: 30, max: 150 }, angle: { min: 195, max: 345 },
      scale: { start: 0.3, end: 0.75 }, alpha: { start: 0.55, end: 0 }, tint: 0xc9c6ee,
    });
    this.spark = P("ph_dot", 41, {
      lifespan: 360, speed: { min: 160, max: 420 }, scale: { start: 0.5, end: 0 },
      alpha: { start: 1, end: 0 }, tint: [0x9ff3ff, 0xffffff, 0x6fe6ff], blendMode: "ADD",
    });
    this.gold = P("ph_star", 41, {
      lifespan: 560, speed: { min: 60, max: 220 }, scale: { start: 0.75, end: 0 },
      alpha: { start: 1, end: 0 }, tint: [0xffe070, 0xfff4b0], blendMode: "ADD", rotate: { min: 0, max: 360 },
    });
    this.magic = P("ph_star", 41, {
      lifespan: 620, speed: { min: 50, max: 240 }, scale: { start: 0.8, end: 0 },
      alpha: { start: 1, end: 0 }, tint: [0x7ff0ff, 0xc9a6ff, 0xffffff], blendMode: "ADD",
    });
    this.debris = P("ph_debris", 27, {
      lifespan: 900, speed: { min: 60, max: 280 }, angle: { min: 200, max: 340 }, gravityY: 1500,
      scale: { min: 0.45, max: 1.1 }, rotate: { min: 0, max: 360 }, alpha: { start: 1, end: 0.3 },
    });
    this.smoke = P("ph_smoke", 22, {
      lifespan: 700, speed: { min: 10, max: 60 }, scale: { start: 0.35, end: 1.2 },
      alpha: { start: 0.4, end: 0 }, tint: 0x9a96c0,
    });
    this.fire = P("ph_dot", 23, {
      lifespan: 380, speed: { min: 20, max: 110 }, scale: { start: 0.9, end: 0 },
      alpha: { start: 1, end: 0 }, tint: [0xfff1a0, 0xffa640, 0xff6a3c], blendMode: "ADD",
    });
    this.blast = P("ph_dot", 42, {
      lifespan: 520, speed: { min: 120, max: 520 }, scale: { start: 1.3, end: 0 },
      alpha: { start: 1, end: 0 }, tint: [0xfff1a0, 0xffa640, 0xff5a3c, 0xffffff], blendMode: "ADD",
    });
    // Шлейф «жара» за героем: ×2 — пламя, ×3 — голубой огонь
    this.hot1 = P("ph_dot", 28, {
      lifespan: 420, speed: { min: 10, max: 60 }, scale: { start: 0.8, end: 0 },
      alpha: { start: 0.9, end: 0 }, tint: [0xfff1a0, 0xffa640, 0xff6a3c], blendMode: "ADD",
    });
    this.hot2 = P("ph_dot", 28, {
      lifespan: 460, speed: { min: 10, max: 70 }, scale: { start: 0.95, end: 0 },
      alpha: { start: 1, end: 0 }, tint: [0xffffff, 0x9ff3ff, 0x6f8bff], blendMode: "ADD",
    });
    // Угольки премиум-скина
    this.ember = P("ph_dot", 28, {
      lifespan: 700, speed: { min: 10, max: 40 }, angle: { min: 240, max: 300 }, gravityY: -60,
      scale: { start: 0.45, end: 0 }, alpha: { start: 1, end: 0 }, tint: [0xff3b2f, 0xff8a3c, 0xffd060], blendMode: "ADD",
    });
    // Пламя джетпака — следует за героем, включается на время полёта
    this.jet = scene.add.particles(0, 0, "ph_dot", {
      emitting: false, frequency: 14, quantity: 2, lifespan: 320,
      speedY: { min: 260, max: 460 }, speedX: { min: -40, max: 40 },
      scale: { start: 0.85, end: 0 }, alpha: { start: 1, end: 0 },
      tint: [0xfff1a0, 0xffa640, 0xff6a3c], blendMode: "ADD",
    }).setDepth(29);
  }

  burst(name, x, y, n = 8) {
    this[name]?.explode(n, x, y);
  }

  /** Одна частица в точке — для шлейфов метеоритов и ракет. */
  trail(name, x, y, n = 1) {
    this[name]?.emitParticleAt(x, y, n);
  }

  jetOn(target, offX, offY) {
    this.jet.startFollow(target, offX, offY);
    this.jet.start();
  }

  jetOff() {
    this.jet.stop();
    this.jet.stopFollow();
  }

  /** Всплывающая надпись в мире («+1», «РИКОШЕТ +20»). */
  text(x, y, str, color = "#ffffff", size = 26) {
    const label = this.scene.add.text(x, y, str, {
      fontFamily: FONT, fontSize: `${size}px`, fontStyle: "bold",
      color, stroke: "#12122a", strokeThickness: 6,
    }).setOrigin(0.5).setDepth(60).setResolution(2);
    this.scene.tweens.add({
      targets: label, y: y - 70, alpha: { from: 1, to: 0 }, scale: { from: 0.7, to: 1.1 },
      duration: 900, ease: "Cubic.easeOut",
      onComplete: () => label.destroy(),
    });
  }
}
