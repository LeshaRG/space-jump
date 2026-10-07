# -*- coding: utf-8 -*-
"""
make_media.py — картинки для карточки Space Jump в консоли Яндекс Игр.

    python store/tools/make_media.py

Иконка и обложки собраны из арта игры (герой, скины, платформы) на космосе,
нарисованном в стиле игры: скриншоты в иконке и обложке запрещены (п. 5.6).
Скриншоты — настоящие кадры забега из store/_raw/<язык>/ (их снимает
capture.mjs). Для компьютера кадр ставится по центру, а по бокам — та же
игровая сцена (размытая), персонаж и подписи: так правила разрешают, если
игровая картинка занимает меньше 70 % (п. 5.1.1.2).

Требования к размерам и форматам — в store/README.md.
"""
import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
STORE = os.path.join(ROOT, "store")
RAW = os.path.join(STORE, "_raw")
FONT = "C:/Windows/Fonts/trebucbd.ttf"      # Trebuchet MS Bold — как в интерфейсе игры

INK = (27, 23, 69)
CYAN = (70, 220, 255)
CYAN2 = (127, 240, 255)
BLUE = (58, 168, 255)
GOLD = (255, 210, 63)
WHITE = (255, 255, 255)

SHOTS = ["aim", "hot", "jet", "hole", "tele"]      # порядок скриншотов в карточке

TEXT = {
    "ru": {
        "tagline": "Оттяни — и прыгай к звёздам!",
        "d1": ["Зажми, оттяни, отпусти —", "прыжок рогаткой", "", "Рикошеты от стен", "", "Прыгай без пауз —", "жар умножает очки ×3"],
        "d1_cap": "Классика",
        "d2": ["Джетпак, телепорт", "и точный прицел", "", "Чёрные дыры, метеориты", "и ракеты", "", "Монеты за очки —", "выше рекорда вдвое больше"],
        "d2_cap": "Скины скафандра",
        "show": "Шесть скафандров — от классики до демона",
    },
    "en": {
        "tagline": "Pull back and leap to the stars!",
        "d1": ["Hold, pull back, release —", "slingshot jumps", "", "Bounce off the walls", "", "Jump without pauses —", "heat multiplies score ×3"],
        "d1_cap": "Classic",
        "d2": ["Jetpack, teleport", "and precise aim", "", "Black holes, meteors", "and rockets", "", "Coins for your score —", "double above your record"],
        "d2_cap": "Suit skins",
        "show": "Six suits — from classic to demon",
    },
}


def font(size):
    return ImageFont.truetype(FONT, size)


# ─── Арт игры ─────────────────────────────────────────────

def load_art(rel):
    """PNG из проекта, обрезанный по непрозрачному содержимому."""
    im = Image.open(os.path.join(ROOT, rel)).convert("RGBA")
    a = np.asarray(im)[..., 3]
    ys, xs = np.nonzero(a > 8)
    return im.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))


def resize(im, w=None, h=None):
    """Уменьшение с премультипликацией альфы — без тёмной каймы по краям."""
    if w is None:
        w = round(im.width * h / im.height)
    if h is None:
        h = round(im.height * w / im.width)
    return im.convert("RGBa").resize((max(1, w), max(1, h)), Image.LANCZOS).convert("RGBA")


HERO_SRC = {
    "jump": "GG/прыжок.png",
    "idle": "GG/стоит.png",
    "crouch": "GG/присед перед прыжком.png",
    "jet": "GG/jetpackanim/3.png",
}


def hero(pose="jump", skin="white", height=400, flip=False):
    if skin == "white":
        src = HERO_SRC[pose]
    else:
        slot = {"jump": "hero_jump", "idle": "hero_idle", "crouch": "hero_crouch", "jet": "hero_jetpack"}[pose]
        src = f"art/skins/{skin}/{slot}/{3 if pose == 'jet' else 1}.png"
    im = resize(load_art(src), h=height)
    return im.transpose(Image.FLIP_LEFT_RIGHT) if flip else im


def platform(width):
    return resize(load_art("platformAnim1/1.png"), w=width)


def shadow(im, blur=14, alpha=150, offset=(0, 10)):
    """Мягкая тень под объектом (возвращает слой и смещение)."""
    pad = blur * 3
    sh = Image.new("RGBA", (im.width + pad * 2, im.height + pad * 2), (0, 0, 0, 0))
    sil = Image.new("RGBA", im.size, (5, 3, 20, 0))
    sil.putalpha(im.getchannel("A").point(lambda v: v * alpha // 255))
    sh.alpha_composite(sil, (pad + offset[0], pad + offset[1]))
    return sh.filter(ImageFilter.GaussianBlur(blur)), pad


def put(canvas, im, x, y, shade=True):
    """Положить объект с тенью: (x, y) — левый верхний угол объекта."""
    if shade:
        sh, pad = shadow(im)
        canvas.alpha_composite(sh, (int(x - pad), int(y - pad)))
    canvas.alpha_composite(im, (int(x), int(y)))


# ─── Космос в стиле игры ──────────────────────────────────

def glow(size, color, alpha=255):
    """Круглое свечение (радиальный градиент)."""
    r = size / 2
    y, x = np.ogrid[:size, :size]
    d = np.sqrt((x - r + 0.5) ** 2 + (y - r + 0.5) ** 2) / r
    a = np.clip(1 - d, 0, 1) ** 2 * alpha
    out = np.zeros((size, size, 4), np.uint8)
    out[..., :3] = color
    out[..., 3] = a.astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def space(w, h, seed=7, nebula=1.0):
    rng = np.random.default_rng(seed)
    t = np.linspace(0, 1, h)[:, None, None]
    top, bottom = np.array([7, 7, 24]), np.array([30, 20, 78])
    base = (top + (bottom - top) * t ** 1.3) * np.ones((1, w, 1))
    img = Image.fromarray(base.astype(np.uint8), "RGB").convert("RGBA")

    # Туманности — те же цвета, что у фона игры
    neb = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    palette = [(123, 63, 228), (45, 108, 223), (208, 70, 154), (31, 181, 168)]
    for i in range(7):
        s = int(max(w, h) * rng.uniform(0.35, 0.7))
        g = glow(s, palette[i % 4], int(120 * nebula))
        neb.alpha_composite(g, (int(rng.uniform(-0.2, 1.0) * w - s / 2 + s / 2 * 0.3), int(rng.uniform(-0.2, 1.0) * h - s / 2 + s / 2 * 0.3)))
    img.alpha_composite(neb)

    # Звёзды: мелкие точки и редкие крупные со свечением
    stars = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(stars)
    colors = [(255, 255, 255), (190, 220, 255), (255, 236, 200), (210, 190, 255)]
    n = int(w * h / 2600)
    for _ in range(n):
        x, y = rng.uniform(0, w), rng.uniform(0, h)
        r = rng.uniform(0.5, 1.6) * max(1, w / 900)
        c = colors[rng.integers(4)]
        a = int(rng.uniform(90, 255))
        d.ellipse((x - r, y - r, x + r, y + r), fill=c + (a,))
    for _ in range(max(3, n // 40)):
        x, y = rng.uniform(0, w), rng.uniform(0, h)
        s = int(rng.uniform(14, 30) * max(1, w / 900))
        stars.alpha_composite(glow(s, (220, 230, 255), 170), (int(x - s / 2), int(y - s / 2)))
    img.alpha_composite(stars)
    return img


def planet(size, base=(255, 179, 138), dark=(140, 59, 92), ring=True, seed=51):
    """Планета с кольцом — как планеты на фоне игры."""
    S = size * 2
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    c = S / 2
    R = size * 0.6

    def ring_arc(front):
        lay = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        dd = ImageDraw.Draw(lay)
        box = (c - R * 1.65, c - R * 0.42, c + R * 1.65, c + R * 0.42)
        dd.arc(box, 0 if front else 180, 180 if front else 360, fill=(230, 210, 255, 150), width=max(3, int(size * 0.035)))
        return lay.rotate(20, resample=Image.BICUBIC, center=(c, c))

    if ring:
        im.alpha_composite(ring_arc(False))
    y, x = np.ogrid[:S, :S]
    dx, dy = x - c, y - c
    dist = np.sqrt(dx ** 2 + dy ** 2)
    inside = dist <= R
    # освещение из левого верхнего угла
    k = np.clip(np.sqrt((dx + R * 0.4) ** 2 + (dy + R * 0.4) ** 2) / (R * 1.6), 0, 1)
    col = np.array(base)[None, None, :] * (1 - k[..., None]) + np.array(dark)[None, None, :] * k[..., None]
    rng = np.random.default_rng(seed)
    for _ in range(5):                                     # полосы
        yy = rng.uniform(-R, R)
        band = np.abs(dy - yy) < rng.uniform(4, 12) * size / 256
        col = np.where(band[..., None], col * 0.9 + 25, col)
    body = np.zeros((S, S, 4), np.uint8)
    body[..., :3] = np.clip(col, 0, 255).astype(np.uint8)
    body[..., 3] = (np.clip(R + 0.8 - dist, 0, 1) * 255).astype(np.uint8)
    b = Image.fromarray(body, "RGBA")
    outline = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(outline).ellipse((c - R, c - R, c + R, c + R), outline=INK + (255,), width=max(3, int(size * 0.02)))
    halo = glow(int(R * 2.8), (140, 120, 255), 70)
    im.alpha_composite(halo, (int(c - R * 1.4), int(c - R * 1.4)))
    im.alpha_composite(b)
    im.alpha_composite(outline)
    _ = inside
    if ring:
        im.alpha_composite(ring_arc(True))
    return im


def coin(size):
    S = size * 4
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = S / 2
    R = S / 2 - 6
    d.ellipse((c - R, c - R, c + R, c + R), fill=(21, 21, 40, 255))
    g = glow(int(R * 2 - 16), (255, 203, 46), 255)
    base = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(base).ellipse((c - R + 14, c - R + 14, c + R - 14, c + R - 14), fill=(255, 190, 30, 255))
    im.alpha_composite(base)
    im.alpha_composite(g, (int(c - R + 8), int(c - R + 8)))
    pts = []
    for i in range(10):
        a = -math.pi / 2 + i * math.pi / 5
        rr = R * (0.22 if i % 2 else 0.5)
        pts.append((c + math.cos(a) * rr, c + math.sin(a) * rr))
    d.polygon(pts, fill=(255, 246, 196, 255), outline=(184, 106, 0, 255), width=6)
    return im.resize((size, size), Image.LANCZOS)


def trail(canvas, p0, p1, bend, dots=14, color=(255, 255, 255), rmax=7):
    """Гаснущий пунктир траектории — как «исчезающий вектор» прицела."""
    d = ImageDraw.Draw(canvas)
    (x0, y0), (x1, y1) = p0, p1
    cx, cy = (x0 + x1) / 2 + bend[0], (y0 + y1) / 2 + bend[1]
    for i in range(1, dots + 1):
        t = i / (dots + 1)
        x = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t * t * x1
        y = (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy + t * t * y1
        k = t ** 0.8                                         # к герою ярче
        r = 2 + (rmax - 2) * k
        d.ellipse((x - r, y - r, x + r, y + r), fill=color + (int(60 + 190 * k),))


def vignette(img, strength=120):
    w, h = img.size
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).ellipse((-w * 0.2, -h * 0.2, w * 1.2, h * 1.2), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(min(w, h) * 0.12))
    shade = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    shade.putalpha(mask.point(lambda v: (255 - v) * strength // 255))
    out = img.copy()
    out.alpha_composite(shade)
    return out


# ─── Логотип (как в меню игры) ────────────────────────────

def spaced(text, fnt, spacing, fill):
    """Строка с межбуквенным интервалом (как letter-spacing в CSS)."""
    widths = [fnt.getbbox(ch)[2] - fnt.getbbox(ch)[0] if ch != " " else fnt.getbbox("n")[2] for ch in text]
    asc, desc = fnt.getmetrics()
    W = int(sum(widths) + spacing * (len(text) - 1) + 8)
    im = Image.new("RGBA", (W, asc + desc + 8), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    x = 4
    for ch, w in zip(text, widths):
        d.text((x - fnt.getbbox(ch)[0], 4), ch, font=fnt, fill=fill)
        x += w + spacing
    return im


def gradient_fill(mask_im, top, bottom):
    h = mask_im.height
    t = np.linspace(0, 1, h)[:, None, None]
    col = (np.array(top) + (np.array(bottom) - np.array(top)) * t) * np.ones((1, mask_im.width, 1))
    out = np.zeros((h, mask_im.width, 4), np.uint8)
    out[..., :3] = col.astype(np.uint8)
    out[..., 3] = np.asarray(mask_im.getchannel("A"))
    return Image.fromarray(out, "RGBA")


def styled(im_text, shadow_px, glow_color, glow_r):
    """Тень-обводка снизу (цвет чернил) и мягкое свечение, как у логотипа в меню."""
    pad = glow_r * 2 + shadow_px + 4
    W, H = im_text.width + pad * 2, im_text.height + pad * 2
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    a = im_text.getchannel("A")
    g = Image.new("RGBA", im_text.size, glow_color + (0,))
    g.putalpha(a.point(lambda v: v * 150 // 255))
    gl = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gl.alpha_composite(g, (pad, pad))
    out.alpha_composite(gl.filter(ImageFilter.GaussianBlur(glow_r)))
    ink = Image.new("RGBA", im_text.size, INK + (0,))
    ink.putalpha(a)
    out.alpha_composite(ink, (pad, pad + shadow_px))
    out.alpha_composite(im_text, (pad, pad))
    return out


def tight(im, thr=10):
    """Обрезать прозрачные поля (по видимым пикселям)."""
    a = np.asarray(im)[..., 3]
    ys, xs = np.nonzero(a > thr)
    return im.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))


def logo(scale=1.0):
    """«SPACE» белым и «JUMP» голубым градиентом, плотно друг под другом — как в меню игры."""
    f1, f2 = font(int(84 * scale)), font(int(108 * scale))
    a = tight(spaced("SPACE", f1, int(84 * scale * 0.08), WHITE), 128)
    b = tight(gradient_fill(spaced("JUMP", f2, int(108 * scale * 0.16), WHITE), CYAN2, BLUE), 128)
    gap = int(16 * scale)
    W = max(a.width, b.width)
    text = Image.new("RGBA", (W, a.height + gap + b.height), (0, 0, 0, 0))
    text.alpha_composite(a, ((W - a.width) // 2, 0))
    text.alpha_composite(b, ((W - b.width) // 2, a.height + gap))
    return tight(styled(text, max(2, int(6 * scale)), CYAN, max(4, int(16 * scale))), 6)


def text_block(lines, size, color=WHITE, line_gap=1.28, bullet=True):
    """Строки с голубыми маркерами; пустая строка — отступ."""
    f = font(size)
    lh = int(size * line_gap)
    H = lh * len(lines) + 10
    W = int(max((f.getlength(l) for l in lines if l), default=0) + size * 1.2 + 20)
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    y = 0
    first = True
    for line in lines:
        if not line:
            y += lh // 2
            first = True
            continue
        x = int(size * 1.1) if bullet else 0
        if bullet and first:
            r = size * 0.22
            cy = y + size * 0.62
            d.ellipse((size * 0.35 - r, cy - r, size * 0.35 + r, cy + r), fill=CYAN + (255,))
        d.text((x + 2, y + 3), line, font=f, fill=INK + (230,))
        d.text((x, y), line, font=f, fill=color + (255,))
        y += lh
        first = False
    return im.crop((0, 0, W, y + 10))


# ─── Иконка ───────────────────────────────────────────────

def icon_scene(S, pad=0.0):
    """Космос, планета, платформа и герой в прыжке с пунктиром траектории."""
    img = space(S, S, seed=11, nebula=1.25)
    k = 1 - pad * 2                                        # доля «безопасного» центра
    off = S * pad
    pl = planet(int(S * 0.34 * k), seed=52)
    img.alpha_composite(pl, (int(off + S * 0.62 * k - pl.width / 2 + S * 0.12 * k), int(off - pl.height * 0.18)))
    p = platform(int(S * 0.5 * k))
    px, py = off - S * 0.04 * k, off + S * 0.78 * k
    h = hero("jump", "white", int(S * 0.58 * k))
    hx, hy = off + S * 0.44 * k, off + S * 0.08 * k
    # Пунктир прыжка: от платформы дугой к ногам героя
    trail(img, (px + p.width * 0.45, py - S * 0.01), (hx + h.width * 0.3, hy + h.height * 0.93),
          (-S * 0.1 * k, -S * 0.2 * k), dots=11, rmax=max(4, int(S * 0.014)))
    put(img, p, px, py)
    put(img, h, hx, hy)
    c = coin(int(S * 0.13 * k))
    img.alpha_composite(c, (int(off + S * 0.10 * k), int(off + S * 0.26 * k)))
    img = vignette(img, 110)
    img = ImageEnhance.Color(img).enhance(1.15)
    return ImageEnhance.Contrast(img).enhance(1.05)


def build_icons():
    out = os.path.join(STORE, "icon.png")
    icon_scene(512).convert("RGB").save(out, optimize=True)
    # Maskable: всё важное — в центральном круге, фон до краёв
    icon_scene(512, pad=0.1).convert("RGB").save(os.path.join(STORE, "icon_maskable.png"), optimize=True)
    print("icon.png, icon_maskable.png   512x512")


# ─── Обложки ──────────────────────────────────────────────

def build_cover(lang):
    W, H = 800, 470
    img = space(W, H, seed=21)
    # Планеты по углам — не под логотипом
    img.alpha_composite(planet(200, seed=53), (W - 240, H - 210))
    img.alpha_composite(planet(110, base=(138, 216, 255), dark=(39, 64, 125), ring=False, seed=55), (W - 130, -40))
    p1 = platform(250)
    put(img, p1, 20, 350)
    p2 = platform(170)
    put(img, p2, 262, 170)
    h = hero("jump", "white", 250)
    trail(img, (150, 345), (190, 205), (-60, -40), dots=10, rmax=6)
    put(img, h, 150, 60)
    img.alpha_composite(coin(38), (307, 118))
    lg = logo(0.7)
    lx = 575 - lg.width // 2
    img.alpha_composite(lg, (lx, 110))
    f = font(24)
    tag = TEXT[lang]["tagline"]
    d = ImageDraw.Draw(img)
    tw = f.getlength(tag)
    ty = 110 + lg.height + 16
    d.text((575 - tw / 2 + 2, ty + 3), tag, font=f, fill=INK + (255,))
    d.text((575 - tw / 2, ty), tag, font=f, fill=(238, 240, 255, 255))
    img = vignette(img, 90)
    img.convert("RGB").save(os.path.join(STORE, lang, "cover.png"), optimize=True)


def build_showcase(lang):
    """Обложка на витрину 1560×520: логотип и все скафандры на платформах."""
    W, H = 1560, 520
    img = space(W, H, seed=31)
    img.alpha_composite(planet(300, seed=54), (W - 360, -170))
    img.alpha_composite(planet(160, base=(138, 216, 255), dark=(39, 64, 125), ring=False, seed=55), (560, 330))
    lg = logo(0.9)
    img.alpha_composite(lg, (70, 120))
    f = font(30)
    d = ImageDraw.Draw(img)
    tag = TEXT[lang]["tagline"]
    d.text((72 + 2, 120 + lg.height + 30 + 3), tag, font=f, fill=INK + (255,))
    d.text((72, 120 + lg.height + 30), tag, font=f, fill=(238, 240, 255, 255))
    sub = TEXT[lang]["show"]
    fs = font(24)
    d.text((72, 120 + lg.height + 80), sub, font=fs, fill=CYAN2 + (255,))
    skins = ["white", "red", "daisy", "biker", "black", "demon"]
    x0 = 700
    for i, sk in enumerate(skins):
        x = x0 + i * 140
        base_y = 450 - i * 42
        p = platform(150)
        put(img, p, x - 12, base_y)
        pose = "jump" if i % 2 else "idle"
        hh = hero(pose, sk, 190 if sk != "demon" else 215)
        put(img, hh, x + 62 - hh.width / 2, base_y - hh.height + 18 - (30 if pose == "jump" else 0))
    img = vignette(img, 80)
    img.convert("RGB").save(os.path.join(STORE, lang, "cover_showcase.png"), optimize=True)


# ─── Скриншоты ────────────────────────────────────────────

def cover_crop(img, w, h):
    k = max(w / img.width, h / img.height)
    im = img.resize((round(img.width * k), round(img.height * k)), Image.LANCZOS)
    x, y = (im.width - w) // 2, (im.height - h) // 2
    return im.crop((x, y, x + w, y + h))


def desktop(shot_path, lines, skin, pose, caption, out):
    """1920×1080: настоящий кадр по центру, по бокам — та же сцена, персонаж и подписи."""
    W, H = 1920, 1080
    shot = Image.open(shot_path).convert("RGB")
    bg = cover_crop(shot, W, H).filter(ImageFilter.GaussianBlur(26))
    bg = ImageEnhance.Brightness(bg).enhance(0.5)
    img = bg.convert("RGBA")
    fg = shot.resize((608, 1080), Image.LANCZOS).convert("RGBA")
    fx = (W - fg.width) // 2
    halo = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(halo).rectangle((fx - 6, -10, fx + fg.width + 6, H + 10), fill=CYAN + (120,))
    img.alpha_composite(halo.filter(ImageFilter.GaussianBlur(18)))
    img.alpha_composite(fg, (fx, 0))
    ImageDraw.Draw(img).rectangle((fx - 2, 0, fx + fg.width + 1, H), outline=CYAN + (170,), width=2)

    # Левая панель: логотип и особенности
    lg = logo(0.85)
    img.alpha_composite(lg, ((fx - lg.width) // 2, 120))
    tb = text_block(lines, 40)
    img.alpha_composite(tb, (max(40, (fx - tb.width) // 2), 120 + lg.height + 90))

    # Правая панель: герой на платформе
    rx = fx + fg.width
    p = platform(420)
    py = 800
    put(img, p, rx + (W - rx - p.width) // 2, py)
    hh = hero(pose, skin, 560)
    put(img, hh, rx + (W - rx - hh.width) // 2, py - hh.height + 30)
    f = font(44)
    d = ImageDraw.Draw(img)
    tw = f.getlength(caption)
    cx = rx + (W - rx) / 2
    d.text((cx - tw / 2 + 3, 150 + 4), caption, font=f, fill=INK + (255,))
    d.text((cx - tw / 2, 150), caption, font=f, fill=CYAN2 + (255,))
    img.convert("RGB").save(out, optimize=True)


def build_screenshots(lang):
    out = os.path.join(STORE, lang, "screenshots")
    os.makedirs(out, exist_ok=True)
    for old in os.listdir(out):
        os.remove(os.path.join(out, old))
    for i, name in enumerate(SHOTS, 1):
        src = os.path.join(RAW, lang, f"{name}.png")
        im = Image.open(src).convert("RGB")
        if im.size != (1080, 1920):
            raise SystemExit(f"{src}: ожидалось 1080x1920, получено {im.size}")
        im.save(os.path.join(out, f"mobile_{i}.png"), optimize=True)
    T = TEXT[lang]
    desktop(os.path.join(RAW, lang, "aim.png"), T["d1"], "white", "idle", T["d1_cap"], os.path.join(out, "desktop_1.png"))
    desktop(os.path.join(RAW, lang, "jet.png"), T["d2"], "demon", "idle", T["d2_cap"], os.path.join(out, "desktop_2.png"))


def check():
    """Проверка размеров и форматов по требованиям консоли."""
    rules = [("icon.png", (512, 512)), ("icon_maskable.png", (512, 512))]
    for lang in TEXT:
        rules += [(f"{lang}/cover.png", (800, 470)), (f"{lang}/cover_showcase.png", (1560, 520))]
        rules += [(f"{lang}/screenshots/mobile_{i}.png", (1080, 1920)) for i in range(1, len(SHOTS) + 1)]
        rules += [(f"{lang}/screenshots/desktop_{i}.png", (1920, 1080)) for i in (1, 2)]
    bad = 0
    for rel, size in rules:
        im = Image.open(os.path.join(STORE, rel))
        ok = im.size == size and im.mode == "RGB"
        bad += not ok
        kb = os.path.getsize(os.path.join(STORE, rel)) / 1024
        print(f"  {'ok ' if ok else 'BAD'} {rel:<36} {im.size[0]}x{im.size[1]} {im.mode} {kb:5.0f} КБ")
    if bad:
        raise SystemExit(f"не по требованиям: {bad}")


if __name__ == "__main__":
    build_icons()
    for lang in TEXT:
        os.makedirs(os.path.join(STORE, lang), exist_ok=True)
        build_cover(lang)
        build_showcase(lang)
        build_screenshots(lang)
    check()
