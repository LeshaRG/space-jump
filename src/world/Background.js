/**
 * Background — небо со звёздами в три слоя параллакса, дальние планеты и
 * туманности, свечение атмосферы, поверхность планеты и боковые стены поля.
 *
 * Слои «прибиты» к камере и сдвигают свой тайл пропорционально подъёму:
 * так фон не требует огромных текстур и одинаково выглядит на любой высоте.
 */
import CONFIG from "../config.js";

const V = CONFIG.VIEW;
const FIELD_W = V.FIELD_W;
const WALL_W = V.WALL_W;

// Приглушены: фон не должен спорить с платформами и опасностями
const DECOS = [
  { key: "ph_planet_a", scale: [0.8, 1.2], alpha: 0.75, add: false },
  { key: "ph_nebula_a", scale: [1.6, 2.4], alpha: 0.35, add: true },
  { key: "ph_planet_b", scale: [0.5, 0.9], alpha: 0.7,  add: false },
  { key: "ph_nebula_b", scale: [1.6, 2.4], alpha: 0.35, add: true },
  { key: "ph_planet_c", scale: [0.6, 1.0], alpha: 0.7,  add: false },
];

export default class Background {
  constructor(scene) {
    this.scene = scene;
    const add = scene.add;

    this.stars = [
      { ts: add.tileSprite(0, 0, 64, 64, "ph_stars_a").setOrigin(0).setDepth(-95), f: 0.04 },
      { ts: add.tileSprite(0, 0, 64, 64, "ph_stars_b").setOrigin(0).setDepth(-85), f: 0.10 },
      { ts: add.tileSprite(0, 0, 64, 64, "ph_stars_c").setOrigin(0).setDepth(-75), f: 0.20 },
    ];

    // Дальние декорации: планеты и туманности, у каждой свой коэффициент параллакса
    this.decos = [];
    this.nextDecoAt = 0;          // подъём камеры, после которого появится следующая
    this._decoIndex = 1;          // DECOS[0] — планета, видная прямо со старта

    // Свечение атмосферы у поверхности — уходит вниз вместе с миром
    this.horizon = add.image(FIELD_W / 2, 0, "ph_horizon").setOrigin(0.5, 1).setDepth(-60);

    // Поверхность: линия y = 40 тайла совпадает с уровнем земли y = 0
    this.ground = add.tileSprite(FIELD_W / 2, -40, 64, 256, "ph_ground").setOrigin(0.5, 0).setDepth(8);
    this.groundFill = add.rectangle(FIELD_W / 2, 214, 64, 6000, 0x262340).setOrigin(0.5, 0).setDepth(8);

    // Боковые стены поля (тайл 60 px → 30 ед.)
    this.wallL = add.tileSprite(-WALL_W, 0, WALL_W, 64, "ph_wall_l").setOrigin(0).setDepth(6).setTileScale(0.5);
    this.wallR = add.tileSprite(FIELD_W, 0, WALL_W, 64, "ph_wall_r").setOrigin(0).setDepth(6).setTileScale(0.5);

    // Затемнение за стенами — на широком экране внимание остаётся на поле
    this.shadeL = add.rectangle(0, 0, 10, 10, 0x05050f, 0.45).setOrigin(1, 0).setDepth(-50);
    this.shadeR = add.rectangle(0, 0, 10, 10, 0x05050f, 0.45).setOrigin(0, 0).setDepth(-50);

    this._w = 0;
    this._h = 0;
  }

  /** Размер видимой области изменился (поворот, ресайз окна). */
  resize(viewW, viewH) {
    this._w = viewW;
    this._h = viewH;
    for (const L of this.stars) L.ts.setSize(viewW + 4, viewH + 4);
    this.horizon.setDisplaySize(viewW + 4, 1500);
    this.ground.setSize(viewW + 4, 256);
    this.groundFill.setSize(viewW + 4, 6000);
    this.wallL.setSize(WALL_W, viewH + 8);
    this.wallR.setSize(WALL_W, viewH + 8);
    const side = Math.max(0, (viewW - FIELD_W) / 2 - WALL_W) + 4;
    this.shadeL.setSize(side, viewH + 8);
    this.shadeR.setSize(side, viewH + 8);
  }

  /**
   * @param view { left, top, width, height } — видимая область в единицах мира
   * @param climbed подъём камеры от старта (для декораций)
   */
  update(view, climbed) {
    const { left, top, width, height } = view;

    for (const L of this.stars) {
      L.ts.setPosition(left - 2, top - 2);
      L.ts.tilePositionY = top * L.f;
    }

    this.ground.tilePositionX = left;
    this.groundFill.x = FIELD_W / 2;

    // Стены двигаются вместе с миром: тайл сдвигаем ровно на подъём камеры
    this.wallL.y = this.wallR.y = top - 4;
    this.wallL.tilePositionY = this.wallR.tilePositionY = (top - 4) * 2;

    this.shadeL.setPosition(-WALL_W, top - 4);
    this.shadeR.setPosition(FIELD_W + WALL_W, top - 4);

    this._updateDecos(view, climbed);
  }

  _updateDecos(view, climbed) {
    const { top, height, left, width } = view;

    // Первая планета видна прямо со старта, остальные — по мере подъёма
    while (climbed >= this.nextDecoAt) {
      const first = this.nextDecoAt === 0;
      const def = DECOS[first ? 0 : (this._decoIndex++ % DECOS.length)];
      const f = def.add ? 0.06 + Math.random() * 0.04 : 0.08 + Math.random() * 0.08;
      const scale = def.scale[0] + Math.random() * (def.scale[1] - def.scale[0]);
      const img = this.scene.add.image(0, 0, def.key)
        .setScale(scale)
        .setAlpha(def.alpha)
        .setDepth(def.add ? -92 : -88);
      if (def.add) img.setBlendMode(Phaser.BlendModes.ADD);
      const sx = first ? 0.78 : 0.1 + Math.random() * 0.8;   // доля ширины экрана
      // Экранная позиция s = layerY - top·f; появляется чуть выше верхнего края
      const screenY = first ? height * 0.22 : -img.displayHeight * 0.6;
      this.decos.push({ img, f, sx, layerY: screenY + top * f });
      this.nextDecoAt += first ? 900 : 1100 + Math.random() * 1300;
    }

    for (let i = this.decos.length - 1; i >= 0; i--) {
      const d = this.decos[i];
      const s = d.layerY - top * d.f;
      d.img.setPosition(left + width * d.sx, top + s);
      if (s > height + d.img.displayHeight) {
        d.img.destroy();
        this.decos.splice(i, 1);
      }
    }
  }

  destroy() {
    for (const d of this.decos) d.img.destroy();
    this.decos.length = 0;
  }
}
