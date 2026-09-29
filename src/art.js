/**
 * art.js — слоты графики.
 *
 * Игра обращается к графике только по имени слота («hero_idle», «coin», ...).
 * Слот берётся из атласа, который собирает tools/build_sprites.py, а если
 * арта для него ещё нет — по цепочке запасных вариантов: другой слот или
 * процедурная заглушка ph_* из placeholders.js. Поэтому новый арт
 * подключается без правок кода: положил кадры → пересобрал → готово.
 *
 * Скины героя — отдельные маленькие атласы (assets/art/skins/), грузятся
 * только когда скин надет. Позы hero_* ищутся сначала в надетом скине.
 */
import { createPlaceholders, TEXTURES } from "./placeholders.js";

/** Слот → что рисовать, если арта нет. */
export const SLOTS = {
  hero_idle:        "ph_hero",
  hero_crouch:      "hero_idle",
  hero_jump:        "hero_idle",
  hero_fall:        "hero_jump",
  hero_land:        "hero_crouch",
  hero_jetpack:     "hero_jump",
  hero_hit:         "hero_fall",

  platform:         "ph_platform",
  platform_small:   "platform",
  platform_crumble: "platform",
  platform_moving:  "platform",

  coin:             "ph_coin",
  diamond:          "ph_diamond",
  pickup_jetpack:   "ph_pickup_jetpack",
  pickup_teleport:  "ph_pickup_teleport",
  pickup_aim:       "ph_pickup_aim",
  pickup_breaker:   "ph_pickup_breaker",
  pickup_x2:        "ph_pickup_x2",

  meteor:           "ph_meteor",
  blackhole:        "ph_hole_disk",
  turret:           "ph_turret_base",
  turret_gun:       "ph_turret_gun",
  rocket:           "ph_rocket",
};

/** Опора и «эталонный размер» заглушек, у которых они не по центру. */
const PH_META = {
  ph_hero:     { pivot: [0.5, 232 / 242], ref: 208 },
  ph_platform: { pivot: [0.5, 10 / 123], ref: 342 },
};

const Art = {
  _slots: {},
  _scene: null,
  _skins: {},             // описания скинов из манифеста
  _loaded: new Set(),     // скины, чьи атласы уже загружены
  _skin: null,            // надетый скин (null — «классика», арт по умолчанию)

  /** Вызывается один раз после загрузки манифеста и атласа. */
  init(scene, manifest) {
    this._scene = scene;
    createPlaceholders(scene);
    this._skins = manifest?.skins ?? {};

    const atlasKey = manifest?.atlas?.key;
    for (const [name, sp] of Object.entries(manifest?.sprites ?? {})) {
      if (!this._register(scene, name, sp, atlasKey)) console.warn(`[art] слот ${name}: кадров нет в атласе, будет заглушка`);
    }

    const real = Object.keys(this._slots);
    const missing = Object.keys(SLOTS).filter(s => !this._slots[s]);
    console.log(`[art] арт: ${real.join(", ") || "нет"}; заглушки: ${missing.join(", ")}; скины: ${Object.keys(this._skins).join(", ") || "нет"}`);
  },

  /** Слот из атласа: кадры, опора, анимация. @returns {boolean} получилось ли */
  _register(scene, name, sp, atlasKey) {
    const atlas = atlasKey && scene.textures.exists(atlasKey) ? scene.textures.get(atlasKey) : null;
    if (!atlas || !sp.frames?.length || !sp.frames.every(f => atlas.has(f))) return false;
    const info = {
      name,
      real:    true,
      texture: atlasKey,
      frames:  sp.frames,
      fps:     sp.fps || 10,
      pivot:   sp.pivot || [0.5, 0.5],
      ref:     sp.ref || sp.size?.[1] || 100,
      size:    sp.size,
      anim:    null,
    };
    if (sp.frames.length > 1) {
      info.anim = "a_" + name;
      if (!scene.anims.exists(info.anim)) {
        scene.anims.create({
          key:       info.anim,
          frames:    sp.frames.map(frame => ({ key: atlasKey, frame })),
          frameRate: info.fps,
          repeat:    -1,
        });
      }
    }
    this._slots[name] = info;
    return true;
  },

  /* ═══════ Скины ═══════ */

  /** Собран ли арт скина (у «классики» — только картинка для магазина). */
  hasSkin(id) {
    return !!this._skins[id]?.atlas;
  },

  /** Картинка скина для магазина или null. */
  skinIcon(id) {
    return this._skins[id]?.icon ?? null;
  },

  /**
   * Загрузить атлас скина, если ещё не загружен. Ошибка загрузки не ломает
   * игру: герой останется в «классике».
   */
  loadSkin(scene, id) {
    const def = this._skins[id];
    if (!def?.atlas || this._loaded.has(id)) return Promise.resolve(this._loaded.has(id));
    return new Promise(resolve => {
      const key = def.atlas.key;
      const finish = () => {
        let ok = scene.textures.exists(key);
        if (ok) {
          for (const [slot, sp] of Object.entries(def.sprites ?? {})) {
            ok = this._register(scene, `${id}:${slot}`, sp, key) && ok;
          }
          this._loaded.add(id);
        } else {
          console.warn(`[art] скин ${id}: атлас не загрузился`);
        }
        resolve(ok);
      };
      if (scene.textures.exists(key)) return finish();
      scene.load.multiatlas(key, def.atlas.json, def.atlas.path);
      scene.load.once(Phaser.Loader.Events.COMPLETE, finish);
      scene.load.start();
    });
  },

  /** Надеть скин (его атлас уже загружен через loadSkin). */
  setSkin(id) {
    this._skin = id && id !== "white" && this._loaded.has(id) ? id : null;
  },

  /** Есть ли настоящий арт для слота (а не заглушка). */
  has(name) {
    return !!this._slots[name];
  },

  /** Описание слота с учётом скина и цепочки запасных вариантов. */
  get(name) {
    // Сначала — поза надетого скина по той же цепочке (hero_fall → hero_jump ...):
    // чтобы у скина без своей позы не мелькнул белый скафандр
    if (this._skin) {
      let key = name;
      for (let guard = 0; guard < 8 && key && !key.startsWith("ph_"); guard++) {
        const s = this._slots[`${this._skin}:${key}`];
        if (s) return s;
        key = SLOTS[key];
      }
    }
    let key = name;
    for (let guard = 0; guard < 8; guard++) {
      if (this._slots[key]) return this._slots[key];
      if (key.startsWith("ph_")) return this._placeholder(key);
      key = SLOTS[key] ?? "ph_dot";
    }
    return this._placeholder("ph_dot");
  },

  _placeholder(key) {
    if (!this._slots[key]) {
      const [w] = TEXTURES[key] ?? [32];
      const meta = PH_META[key] ?? {};
      this._slots[key] = {
        name:    key,
        real:    false,
        texture: key,
        frames:  ["__BASE"],
        fps:     0,
        pivot:   meta.pivot ?? [0.5, 0.5],
        ref:     meta.ref ?? w,
        anim:    null,
      };
    }
    return this._slots[key];
  },

  /**
   * Спрайт слота: опора выставлена, анимация запущена.
   * @param {boolean} [randomStart] начать анимацию со случайного кадра
   */
  sprite(scene, name, x = 0, y = 0, randomStart = false) {
    const info = this.get(name);
    const s = scene.add.sprite(x, y, info.texture, info.frames[0]);
    s.setOrigin(info.pivot[0], info.pivot[1]);
    if (info.anim) {
      s.play({ key: info.anim, startFrame: randomStart ? Math.floor(Math.random() * info.frames.length) : 0 });
    }
    return s;
  },

  /**
   * Переключить уже созданный спрайт на другой слот.
   * @param {boolean} [keepOrigin] не трогать опору (у героя она своя)
   */
  apply(sprite, name, keepOrigin = false) {
    const info = this.get(name);
    if (info.anim) {
      if (sprite.anims.currentAnim?.key !== info.anim || !sprite.anims.isPlaying) sprite.play(info.anim, true);
    } else {
      sprite.anims.stop();
      sprite.setTexture(info.texture, info.frames[0]);
    }
    if (!keepOrigin) sprite.setOrigin(info.pivot[0], info.pivot[1]);
    return info;
  },
};

export default Art;
