#!/usr/bin/env python3
"""
build_sprites.py — сборка графики Space Jump.

Берёт исходные PNG (любого размера, с прозрачностью — как их экспортирует
Photoshop) и собирает из них то, что реально грузит игра:

  assets/art/atlas0.png ...  страницы атласа (обрезанные и уменьшенные кадры)
  assets/art/atlas.json      описание атласа в формате multiatlas Phaser
  assets/art/sprites.json    манифест: спрайты, кадры, fps, точка опоры,
                             масштаб; плюс список звуков из assets/sounds

Что из чего собирается, описано в art.config.json. Анимация — папка с
кадрами 1.png, 2.png, ... (проигрываются по порядку и по кругу) или список
файлов. Слоты без записи в конфиге можно положить в art/<слот>/ или
art/<слот>.png — они подхватятся автоматически.

Чего нет в манифесте, игра рисует процедурной заглушкой, поэтому неудачная
сборка одного спрайта никогда не ломает запуск игры.

Скины героя: art/skins/<скин>/<слот>/1.png, ... (их делает
tools/make_skins.py или художник) собираются в отдельные маленькие атласы
assets/art/skins/<скин>N.png + <скин>.json — в том же масштабе и с той же
опорой, что и основной герой. Плюс картинка для магазина <скин>_icon.png.

Запуск:  python tools/build_sprites.py [--force]
"""
import hashlib
import json
import math
import os
import re
import sys
from datetime import datetime

try:
    import numpy as np
    from PIL import Image
except ImportError:
    print("Нужны Pillow и numpy:  pip install pillow numpy")
    sys.exit(2)

ROOT      = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG    = os.path.join(ROOT, "art.config.json")
ART_DIR   = os.path.join(ROOT, "art")
SKIN_SRC  = os.path.join(ART_DIR, "skins")
OUT_DIR   = os.path.join(ROOT, "assets", "art")
SKIN_OUT  = os.path.join(OUT_DIR, "skins")
SOUND_DIR = os.path.join(ROOT, "assets", "sounds")
STAMP     = os.path.join(OUT_DIR, ".stamp")

ALPHA_MIN = 16     # пиксели прозрачнее считаются пустыми (обрезка краёв)
SOLID     = 128    # «плотный» пиксель — для поиска ног и поверхности
PAGE_MAX  = 2048   # предельный размер страницы атласа (безопасно для мобильных GPU)
PAD       = 2      # отступ между кадрами в атласе
SOUND_EXT = (".mp3", ".ogg", ".wav", ".m4a")


def default_settings(slot):
    """Настройки для слотов, найденных автоматически в папке art/."""
    if slot.startswith("hero_"):
        return {"group": "hero", "fps": 10}
    if slot.startswith("platform"):
        return {"width": 340, "anchor": "surface", "fps": 7}
    return {"size": 192, "anchor": "center", "fps": 10}


# ─── Кадры ────────────────────────────────────────────────

def natural_key(name):
    """1.png, 2.png, ..., 10.png — по числу, а не по алфавиту."""
    base = os.path.splitext(name)[0]
    m = re.search(r"\d+", base)
    return (0, int(m.group()), base) if m else (1, 0, base)


def list_frames(src):
    """src (строка или список путей относительно корня) → пути кадров по порядку."""
    out = []
    for item in (src if isinstance(src, list) else [src]):
        path = os.path.join(ROOT, item)
        if os.path.isdir(path):
            files = sorted((f for f in os.listdir(path) if f.lower().endswith(".png")), key=natural_key)
            out += [os.path.join(path, f) for f in files]
        elif os.path.isfile(path):
            out.append(path)
        else:
            raise FileNotFoundError(item)
    if not out:
        raise FileNotFoundError(f"{src}: нет PNG-кадров")
    return out


def discover(config_sprites):
    """Слоты из папки art/, которых нет в конфиге."""
    found = {}
    if not os.path.isdir(ART_DIR):
        return found
    for name in sorted(os.listdir(ART_DIR)):
        slot, ext = os.path.splitext(name)
        full = os.path.join(ART_DIR, name)
        if slot in config_sprites or slot == "skins" or not re.fullmatch(r"[a-z0-9_]+", slot):
            continue
        if os.path.isdir(full) or ext.lower() == ".png":
            rel = os.path.relpath(full, ROOT).replace("\\", "/")
            found[slot] = dict(default_settings(slot), src=rel)
    return found


# ─── Точка опоры ──────────────────────────────────────────

def content_bbox(alpha):
    ys, xs = np.nonzero(alpha > ALPHA_MIN)
    if not len(xs):
        raise ValueError("пустой кадр")
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def anchor_feet(alpha, bbox):
    """Середина подошв: низ силуэта и центр пикселей в нижней полоске."""
    solid = alpha > SOLID
    rows = np.nonzero(solid.sum(axis=1) >= 3)[0]
    bottom = int(rows.max())
    band = max(4, int((bottom - rows.min()) * 0.035))
    _, xs = np.nonzero(solid[bottom - band: bottom + 1])
    lo, hi = np.percentile(xs, 10), np.percentile(xs, 90)
    return (lo + hi) / 2.0, float(bottom + 1)


def anchor_surface(alpha, bbox):
    """Верх настила платформы: медиана верхних точек центральной трети."""
    x0, _, x1, _ = bbox
    solid = alpha > SOLID
    width = x1 - x0
    tops = []
    for x in range(int(x0 + width * 0.35), int(x0 + width * 0.65)):
        col = np.nonzero(solid[:, x])[0]
        if len(col):
            tops.append(col.min())
    return (x0 + x1) / 2.0, float(np.median(tops))


def anchor_center(alpha, bbox):
    x0, y0, x1, y1 = bbox
    return (x0 + x1) / 2.0, (y0 + y1) / 2.0


ANCHORS = {"feet": anchor_feet, "surface": anchor_surface, "center": anchor_center}


def find_anchor(kind, alpha, bbox):
    if isinstance(kind, list):   # [доля по X, доля по Y] от рамки содержимого
        x0, y0, x1, y1 = bbox
        return x0 + (x1 - x0) * kind[0], y0 + (y1 - y0) * kind[1]
    return ANCHORS[kind](alpha, bbox)


# ─── Группа спрайтов с общим масштабом и холстом ──────────

def build_group(name, settings, members, force_scale=None):
    """
    members: [(slot, cfg, paths)]. Все спрайты группы получают один масштаб
    и один холст с точкой опоры в одном и том же пикселе — поэтому смена
    анимации (стоит → присед → прыжок → джетпак) не сдвигает персонажа.
    force_scale — масштаб основного героя для скинов: рога не должны
    уменьшать космонавта.
    """
    frames_by_slot = {}
    for slot, cfg, paths in members:
        frames = []
        for p in paths:
            img = Image.open(p).convert("RGBA")
            alpha = np.asarray(img.getchannel("A"))
            frames.append({"path": p, "img": img, "alpha": alpha, "bbox": content_bbox(alpha)})

        kind = cfg.get("anchor", settings.get("anchor", "center"))
        if cfg.get("align") == "each":
            # Кадры нарисованы со сдвигом — каждый выравниваем по своей опоре
            for f in frames:
                f["anchor"] = find_anchor(kind, f["alpha"], f["bbox"])
        else:
            # Кадры согласованы между собой — сохраняем их взаимное положение
            a = find_anchor(kind, frames[0]["alpha"], frames[0]["bbox"])
            for f in frames:
                f["anchor"] = a
        frames_by_slot[slot] = frames

    ref_slot = settings.get("ref") if settings.get("ref") in frames_by_slot else members[0][0]
    rx0, ry0, rx1, ry1 = frames_by_slot[ref_slot][0]["bbox"]
    if "height" in settings:
        scale, ref = settings["height"] / (ry1 - ry0), settings["height"]
    elif "width" in settings:
        scale, ref = settings["width"] / (rx1 - rx0), settings["width"]
    else:
        size = settings.get("size", 192)
        scale, ref = size / max(rx1 - rx0, ry1 - ry0), size
    if force_scale:
        scale = force_scale

    # Габариты кадров относительно опоры (в пикселях результата)
    half_w = top = bottom = 0.0
    for frames in frames_by_slot.values():
        for f in frames:
            ax, ay = f["anchor"]
            x0, y0, x1, y1 = f["bbox"]
            f["rel"] = ((x0 - ax) * scale, (y0 - ay) * scale, (x1 - ax) * scale, (y1 - ay) * scale)
            half_w = max(half_w, -f["rel"][0], f["rel"][2])
            top = min(top, f["rel"][1])
            bottom = max(bottom, f["rel"][3])

    # Холст симметричен по X относительно опоры — отражение (flipX) не сдвигает героя
    cw = int(math.ceil(half_w)) * 2 + 2
    ch = int(math.ceil(bottom - top)) + 2
    ax_px, ay_px = cw / 2.0, -top + 1

    sprites = {}
    for slot, cfg, _ in members:
        out_frames = []
        for f in frames_by_slot[slot]:
            x0, y0, x1, y1 = f["bbox"]
            w = max(1, int(round((x1 - x0) * scale)))
            h = max(1, int(round((y1 - y0) * scale)))
            # Премультиплицированная альфа: без неё прозрачные пиксели (часто
            # чёрные в RGB) дают тёмную кайму по краям после уменьшения
            small = f["img"].crop((x0, y0, x1, y1)).convert("RGBa").resize((w, h), Image.LANCZOS).convert("RGBA")
            ox = int(round(ax_px + f["rel"][0]))
            oy = int(round(ay_px + f["rel"][1]))
            ox = min(max(ox, 0), cw - w)
            oy = min(max(oy, 0), ch - h)
            out_frames.append({"img": small, "ox": ox, "oy": oy})
        sprites[slot] = {
            "frames": out_frames,
            "fps": cfg.get("fps", settings.get("fps", 10)),
            "size": [cw, ch],
            "pivot": [round(ax_px / cw, 5), round(ay_px / ch, 5)],
            "ref": ref,
            "group": name,
            "scale": scale,
            "sources": [os.path.relpath(f["path"], ROOT).replace("\\", "/") for f in frames_by_slot[slot]],
        }
    return sprites


# ─── Упаковка атласа ──────────────────────────────────────

def shelf_pack(items, page_w):
    """Полочная упаковка. items: [(key, w, h)] по убыванию высоты → страницы."""
    pages, cur = [], {"places": {}, "h": 0}
    x = y = PAD
    shelf = 0
    for key, w, h in items:
        if w + 2 * PAD > page_w:
            return None
        if x + w + PAD > page_w:
            x, y, shelf = PAD, y + shelf + PAD, 0
        if y + h + PAD > PAGE_MAX:
            pages.append(cur)
            cur = {"places": {}, "h": 0}
            x = y = PAD
            shelf = 0
        cur["places"][key] = (x, y)
        cur["h"] = max(cur["h"], y + h + PAD)
        x += w + PAD
        shelf = max(shelf, h)
    pages.append(cur)
    for p in pages:
        p["w"] = page_w
        p["h"] = int(math.ceil(p["h"] / 8.0)) * 8
    return pages


def pack(items):
    items = sorted(items, key=lambda it: (-it[2], -it[1]))
    best = None
    for page_w in (256, 512, 1024, 2048):
        pages = shelf_pack(items, page_w)
        if pages is None:
            continue
        cost = (len(pages), sum(p["w"] * p["h"] for p in pages))
        if best is None or cost < best[0]:
            best = (cost, pages)
    if best is None:
        raise ValueError("кадр шире страницы атласа")
    return best[1]


def write_atlas(sprites, out_dir, prefix):
    """
    Кадры спрайтов → страницы <prefix>0.png, <prefix>1.png, ... и <prefix>.json
    (multiatlas Phaser). Одинаковые кадры хранятся один раз.
    @returns (textures, frame_names{slot: [имена кадров]})
    """
    unique, frame_names = {}, {}
    for slot, sp in sprites.items():
        names = []
        for i, fr in enumerate(sp["frames"]):
            digest = hashlib.sha1(fr["img"].tobytes() + bytes(f'{fr["img"].size}{fr["ox"]},{fr["oy"]}', "ascii")).hexdigest()
            if digest not in unique:
                unique[digest] = {"name": f"{slot}/{i}", "img": fr["img"], "ox": fr["ox"], "oy": fr["oy"], "size": sp["size"]}
            names.append(unique[digest]["name"])
        frame_names[slot] = names

    os.makedirs(out_dir, exist_ok=True)
    for old in os.listdir(out_dir):
        if re.fullmatch(re.escape(prefix) + r"\d*\.png", old):
            os.remove(os.path.join(out_dir, old))

    textures = []
    if unique:
        by_name = {u["name"]: u for u in unique.values()}
        pages = pack([(u["name"], u["img"].size[0], u["img"].size[1]) for u in unique.values()])
        for pi, page in enumerate(pages):
            sheet = Image.new("RGBA", (page["w"], page["h"]), (0, 0, 0, 0))
            frames = []
            for name, (x, y) in page["places"].items():
                u = by_name[name]
                w, h = u["img"].size
                sheet.paste(u["img"], (x, y))
                frames.append({
                    "filename": name,
                    "rotated": False,
                    "trimmed": True,
                    "sourceSize": {"w": u["size"][0], "h": u["size"][1]},
                    "spriteSourceSize": {"x": u["ox"], "y": u["oy"], "w": w, "h": h},
                    "frame": {"x": x, "y": y, "w": w, "h": h},
                })
            image_name = f"{prefix}{pi}.png"
            sheet.save(os.path.join(out_dir, image_name), optimize=True)
            textures.append({"image": image_name, "format": "RGBA8888",
                             "size": {"w": page["w"], "h": page["h"]}, "scale": 1, "frames": frames})

    with open(os.path.join(out_dir, f"{prefix}.json"), "w", encoding="utf-8") as fh:
        json.dump({"textures": textures, "meta": {"app": "tools/build_sprites.py", "version": "1"}}, fh, indent=1)
    return textures, frame_names


def manifest_sprites(sprites, frame_names):
    return {
        slot: {k: sp[k] for k in ("fps", "size", "pivot", "ref", "group")} | {"frames": frame_names[slot]}
        for slot, sp in sorted(sprites.items())
    }


# ─── Скины героя ──────────────────────────────────────────

def skin_sources():
    """{скин: {слот: папка}} из art/skins/."""
    out = {}
    if not os.path.isdir(SKIN_SRC):
        return out
    for skin in sorted(os.listdir(SKIN_SRC)):
        d = os.path.join(SKIN_SRC, skin)
        if not os.path.isdir(d) or not re.fullmatch(r"[a-z0-9_]+", skin):
            continue
        slots = {s: os.path.join(d, s) for s in sorted(os.listdir(d)) if os.path.isdir(os.path.join(d, s))}
        if slots:
            out[skin] = slots
    return out


def build_skins(groups, sprite_defs, base, warnings):
    """
    Скины: те же позы героя, тот же масштаб (force_scale) и та же опора по
    ногам. Атлас у каждого свой — игра грузит только надетый.
    @returns описание скинов для манифеста
    """
    os.makedirs(SKIN_OUT, exist_ok=True)
    for old in os.listdir(SKIN_OUT):
        if old.endswith((".png", ".json")):
            os.remove(os.path.join(SKIN_OUT, old))

    out = {}
    idle = base.get("hero_idle")
    if not idle:
        return out
    # «Классика» — картинка для магазина из основного арта
    idle["frames"][0]["img"].save(os.path.join(SKIN_OUT, "white_icon.png"), optimize=True)
    out["white"] = {"icon": "assets/art/skins/white_icon.png"}

    hero_slots = [s for s, sp in base.items() if sp.get("group") == "hero"]
    for skin, slots in skin_sources().items():
        members = []
        for slot in hero_slots:
            if slot not in slots:
                continue
            try:
                paths = list_frames(os.path.relpath(slots[slot], ROOT))
            except FileNotFoundError:
                continue
            cfg = {k: v for k, v in sprite_defs.get(slot, {}).items() if k != "src"}
            members.append((slot, cfg, paths))
        if not members:
            continue
        try:
            sprites = build_group("hero", groups.get("hero", {}), members, force_scale=idle["scale"])
        except Exception as e:
            warnings.append(f"скин {skin}: {e}")
            continue
        _, names = write_atlas(sprites, SKIN_OUT, skin)
        out[skin] = {
            "atlas": {"key": f"skin_{skin}", "json": f"assets/art/skins/{skin}.json", "path": "assets/art/skins/"},
            "sprites": manifest_sprites(sprites, names),
        }
        if "hero_idle" in sprites:
            sprites["hero_idle"]["frames"][0]["img"].save(os.path.join(SKIN_OUT, f"{skin}_icon.png"), optimize=True)
            out[skin]["icon"] = f"assets/art/skins/{skin}_icon.png"
    return out


# ─── Сборка ───────────────────────────────────────────────

def input_fingerprint(config_text, sprite_defs):
    h = hashlib.sha1(config_text.encode("utf-8"))
    h.update(open(__file__, "rb").read())
    for slot in sorted(sprite_defs):
        try:
            for p in list_frames(sprite_defs[slot]["src"]):
                st = os.stat(p)
                h.update(f"{p}|{st.st_size}|{st.st_mtime_ns}".encode("utf-8"))
        except (FileNotFoundError, KeyError):
            h.update(f"{slot}|missing".encode("utf-8"))
    for skin, slots in skin_sources().items():
        for slot, d in slots.items():
            for f in sorted(os.listdir(d)):
                st = os.stat(os.path.join(d, f))
                h.update(f"{skin}/{slot}/{f}|{st.st_size}|{st.st_mtime_ns}".encode("utf-8"))
    if os.path.isdir(SOUND_DIR):
        for name in sorted(os.listdir(SOUND_DIR)):
            h.update(name.encode("utf-8"))
    return h.hexdigest()


def collect_sounds():
    sounds = {}
    if not os.path.isdir(SOUND_DIR):
        return sounds
    for name in sorted(os.listdir(SOUND_DIR)):
        key, ext = os.path.splitext(name)
        if ext.lower() in SOUND_EXT and re.fullmatch(r"[a-z0-9_]+", key):
            sounds.setdefault(key, []).append(f"assets/sounds/{name}")
    return sounds


def main():
    force = "--force" in sys.argv
    if not os.path.isfile(CONFIG):
        print("Нет art.config.json")
        return 1

    config_text = open(CONFIG, encoding="utf-8").read()
    config = json.loads(config_text)
    groups = config.get("groups", {})
    sprite_defs = dict(config.get("sprites", {}))
    sprite_defs.update(discover(sprite_defs))

    fingerprint = input_fingerprint(config_text, sprite_defs)
    manifest_path = os.path.join(OUT_DIR, "sprites.json")
    if not force and os.path.isfile(STAMP) and os.path.isfile(manifest_path):
        if open(STAMP, encoding="utf-8").read().strip() == fingerprint:
            print("Графика актуальна, пересборка не нужна (--force — собрать заново).")
            return 0

    # Раскладываем спрайты по группам; спрайт без группы — группа из одного
    members_by_group, warnings = {}, []
    for slot, cfg in sprite_defs.items():
        try:
            paths = list_frames(cfg["src"])
        except (FileNotFoundError, KeyError) as e:
            warnings.append(f"{slot}: не найден источник {e}")
            continue
        gname = cfg.get("group") or f"_{slot}"
        members_by_group.setdefault(gname, []).append((slot, cfg, paths))

    sprites = {}
    for gname, members in members_by_group.items():
        settings = groups.get(gname, members[0][1])
        try:
            sprites.update(build_group(gname, settings, members))
        except Exception as e:  # один битый файл не должен ронять всю сборку
            warnings.append(f"группа {gname}: {e}")

    textures, frame_names = write_atlas(sprites, OUT_DIR, "atlas")
    skins = build_skins(groups, sprite_defs, sprites, warnings)

    manifest = {
        "generated": datetime.now().isoformat(timespec="seconds"),
        "atlas": {"key": "art", "json": "assets/art/atlas.json", "path": "assets/art/"} if textures else None,
        "sprites": manifest_sprites(sprites, frame_names),
        "skins": skins,
        "sounds": collect_sounds(),
    }
    with open(manifest_path, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=1)

    # ── Отчёт ──
    total_px = sum(t["size"]["w"] * t["size"]["h"] for t in textures)
    uniq = len({n for names in frame_names.values() for n in names})
    print(f"Собрано спрайтов: {len(sprites)}, уникальных кадров: {uniq}, "
          f"страниц атласа: {len(textures)} ({total_px / 1e6:.2f} Мпикс)")
    for slot, sp in sorted(sprites.items()):
        print(f"  {slot:<16} кадров {len(sp['frames']):>2}  fps {sp['fps']:<4}  холст {sp['size'][0]}x{sp['size'][1]}"
              f"  опора ({sp['pivot'][0]:.3f}, {sp['pivot'][1]:.3f})")
    real_skins = [s for s, d in skins.items() if d.get("atlas")]
    if real_skins:
        kb = sum(os.path.getsize(os.path.join(SKIN_OUT, f)) for f in os.listdir(SKIN_OUT)) / 1024
        print(f"  скины: {', '.join(real_skins)} ({kb:.0f} КБ вместе с картинками для магазина)")
    if manifest["sounds"]:
        print("  звуки:", ", ".join(sorted(manifest["sounds"])))
    for w in warnings:
        print("  ВНИМАНИЕ:", w)

    with open(STAMP, "w", encoding="utf-8") as fh:
        fh.write(fingerprint)
    return 0


if __name__ == "__main__":
    sys.exit(main())
