#!/usr/bin/env python3
"""
make_skins.py — скины скафандра: перекраска арта героя.

Берёт кадры героя из art.config.json (hero_idle, hero_crouch, hero_jump,
hero_jetpack) и на каждом кадре находит:
  • ткань скафандра — светлые малонасыщенные области (шлем, костюм,
    перчатки, ботинки, ранец);
  • серые детали — средне-серые области (кольца, шланг, пояс, подошвы);
  • стекло шлема — большое тёмно-синее пятно вместе с бликами внутри.

Ткань перекрашивается с сохранением светотени (цвет — по яркости исходного
пикселя) и сглаживания краёв (пиксель на границе с контуром перекрашивается
ровно на ту долю, на которую он «ткань»). Принт ложится поверх ткани и
тоже темнеет в тени. Координаты принта привязаны к ногам героя, поэтому
между кадрами анимации рисунок не «плавает».

Результат — такие же PNG в art/skins/<скин>/<слот>/1.png, 2.png, ...
Их можно открыть и подправить в Photoshop; атласы из них собирает
tools/build_sprites.py (он же вызывается dev-сервером).

Запуск:  python tools/make_skins.py [скин ...]      (без аргументов — все)
"""
import json
import math
import os
import sys

try:
    import numpy as np
    from PIL import Image, ImageDraw, ImageFilter
    from scipy import ndimage as ndi
except ImportError:
    print("Нужны Pillow, numpy и scipy:  pip install pillow numpy scipy")
    sys.exit(2)

ROOT     = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG   = os.path.join(ROOT, "art.config.json")
OUT_DIR  = os.path.join(ROOT, "art", "skins")
SLOTS    = ["hero_idle", "hero_crouch", "hero_jump", "hero_jetpack"]
SS       = 2          # суперсэмплинг рисунков принта (сглаживание краёв)
PAD      = 200        # поля вокруг кадра: рога и хвост выходят за исходный холст
OUTLINE  = (18, 10, 30)


# ─── Цвет ─────────────────────────────────────────────────

def hexrgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], np.float32) / 255.0


def ramp(stops):
    """Градиент по яркости: [(t, "#rrggbb"), ...] → функция t[N] → rgb[N,3]."""
    ts = np.array([s[0] for s in stops], np.float32)
    cs = np.stack([hexrgb(s[1]) for s in stops])

    def f(t):
        t = np.clip(t, ts[0], ts[-1])
        return np.stack([np.interp(t, ts, cs[:, k]) for k in range(3)], -1)
    return f


def lum(rgb):
    return rgb[..., 0] * 0.299 + rgb[..., 1] * 0.587 + rgb[..., 2] * 0.114


def hsv_vs(rgb):
    mx = rgb.max(-1)
    mn = rgb.min(-1)
    return mx, np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)


def hue_deg(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    return (np.degrees(np.arctan2(math.sqrt(3) * (g - b), 2 * r - g - b)) + 360) % 360


# ─── Маски кадра ──────────────────────────────────────────

def disk(r):
    y, x = np.ogrid[-r:r + 1, -r:r + 1]
    return x * x + y * y <= r * r


def largest(mask):
    lab, n = ndi.label(mask)
    if n == 0:
        return mask
    sizes = ndi.sum(mask, lab, range(1, n + 1))
    return lab == (int(np.argmax(sizes)) + 1)


def analyze(img):
    """Маски и геометрия кадра."""
    a = img[..., 3]
    rgb = img[..., :3]
    V, S = hsv_vs(rgb)
    op = a > 0.5

    # Стекло: тёмно-синее и голубая подсветка по краю — насыщенное, синего
    # больше, чем красного. Белые блики внутри — «дырки» в нём: заливаем
    glass = op & (V > 0.07) & (S > 0.3) & (rgb[..., 2] > rgb[..., 0] + 0.05) & (rgb[..., 2] >= rgb[..., 1])
    glass = largest(ndi.binary_opening(glass, structure=disk(4)))
    visor = ndi.binary_fill_holes(ndi.binary_closing(glass, structure=disk(6)))
    visor = ndi.binary_dilation(visor, structure=disk(3))

    # Пламя джетпака: оранжево-жёлтое; белая сердцевина внутри него — не ткань
    hue = hue_deg(rgb)
    flame = op & (S > 0.45) & (V > 0.5) & (hue > 14) & (hue < 66)
    flame = ndi.binary_dilation(ndi.binary_fill_holes(ndi.binary_closing(flame, structure=disk(3))), structure=disk(3))

    fabric = op & (V > 0.66) & (S < 0.24) & ~visor & ~flame
    fabric = ndi.binary_opening(fabric, structure=disk(1))
    gray = op & (V > 0.3) & (V < 0.68) & (S < 0.3) & ~visor
    gray = ndi.binary_opening(gray, structure=disk(3))

    ys, xs = np.nonzero(op)
    bbox = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    return {"a": a, "rgb": rgb, "V": V, "S": S, "op": op, "visor": visor, "glass": glass,
            "flame": flame, "fabric": fabric, "gray": gray, "bbox": bbox}


def feet_anchor(m):
    """Середина подошв — как в build_sprites.py (привязка принта к ногам)."""
    solid = m["a"] > 0.5
    rows = np.nonzero(solid.sum(axis=1) >= 3)[0]
    bottom = int(rows.max())
    band = max(4, int((bottom - rows.min()) * 0.035))
    _, xs = np.nonzero(solid[bottom - band: bottom + 1])
    lo, hi = np.percentile(xs, 10), np.percentile(xs, 90)
    return (lo + hi) / 2.0, float(bottom + 1)


def helmet_circle(m):
    """Окружность шлема по верхнему контуру силуэта (МНК-подгонка)."""
    op = m["op"]
    x0, y0, x1, y1 = m["bbox"]
    H = y1 - y0
    pts = []
    for x in range(x0, x1):
        col = np.nonzero(op[:, x])[0]
        if len(col) and col[0] < y0 + 0.33 * H:
            pts.append((x, col[0]))
    p = np.array(pts, np.float64)
    A = np.c_[2 * p[:, 0], 2 * p[:, 1], np.ones(len(p))]
    b = (p ** 2).sum(1)
    cx, cy, c = np.linalg.lstsq(A, b, rcond=None)[0]
    r = math.sqrt(c + cx * cx + cy * cy)
    return cx, cy, r


# ─── Перекраска ───────────────────────────────────────────

def recolor_region(img, m, core, new_color, zone_grow=4, max_sat=0.4, exclude=None):
    """
    Перекрасить область core с краями. new_color(W, t, idx) → rgb:
    W — исходный цвет ближайшего пикселя ядра, t — его освещённость 0..1,
    idx — (ys, xs) пикселей зоны (для принта).
    """
    rgb = img[..., :3]
    zone = ndi.binary_dilation(core, structure=disk(zone_grow)) & (m["a"] > 0.02) & ~m["visor"] & ~m["flame"]
    zone &= m["S"] < max_sat
    if exclude is not None:
        zone &= ~exclude
    zone |= core
    if not zone.any():
        return
    # Ближайший пиксель ядра для каждой точки зоны
    _, (iy, ix) = ndi.distance_transform_edt(~core, return_indices=True)
    ys, xs = np.nonzero(zone)
    W = rgb[iy[ys, xs], ix[ys, xs]]
    P = rgb[ys, xs]
    lw = lum(W)
    lp = lum(P)
    dark = 0.05
    alpha = np.clip((lp - dark) / np.maximum(lw - dark, 1e-3), 0, 1)
    t = np.clip((lw - 0.62) / 0.38, 0, 1)                 # 0 — глубокая тень, 1 — свет
    Wn = new_color(W, t, (ys, xs))
    img[ys, xs, :3] = np.clip(P + alpha[:, None] * (Wn - W), 0, 1)


def ramp_color(f):
    return lambda W, t, idx: f(t)


def print_color(base, pattern, shade_min=0.55):
    """Ткань цвета base + рисунок pattern (RGBA float, в координатах кадра)."""
    def fn(W, t, idx):
        ys, xs = idx
        c = base(t)
        p = pattern[ys, xs]
        shade = (shade_min + (1 - shade_min) * t)[:, None]
        return c * (1 - p[:, 3:4]) + p[:, :3] * shade * p[:, 3:4]
    return fn


# ─── Рисунки (принты) ─────────────────────────────────────

class Canvas:
    """Холст принта с суперсэмплингом; координаты — в пикселях кадра."""
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.im = Image.new("RGBA", (w * SS, h * SS), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.im)

    def poly(self, pts, fill, outline=None, width=0):
        p = [(x * SS, y * SS) for x, y in pts]
        self.d.polygon(p, fill=fill)
        if outline and width:
            self.d.line(p + [p[0]], fill=outline, width=int(width * SS), joint="curve")

    def ellipse(self, cx, cy, rx, ry, fill, outline=None, width=0):
        box = [(cx - rx) * SS, (cy - ry) * SS, (cx + rx) * SS, (cy + ry) * SS]
        self.d.ellipse(box, fill=fill, outline=outline, width=int(width * SS) if outline else 0)

    def result(self):
        small = self.im.resize((self.w, self.h), Image.LANCZOS)
        return np.asarray(small).astype(np.float32) / 255.0


def rot(pts, cx, cy, ang):
    c, s = math.cos(ang), math.sin(ang)
    return [(cx + x * c - y * s, cy + x * s + y * c) for x, y in pts]


def scatter(w, h, ax, ay, step, jitter=0.35):
    """
    Точки шахматной решётки со случайным сдвигом, привязанные к опоре (ax, ay).
    Случайность — от номера клетки, поэтому в каждом кадре рисунок тот же
    и стоит на тех же местах относительно ног.
    """
    dy = step * 0.87
    pts = []
    for k in range(int(math.floor(-ay / dy)) - 1, int(math.ceil((h - ay) / dy)) + 2):
        off = step / 2 if k % 2 else 0
        for c in range(int(math.floor((-ax - off) / step)) - 1, int(math.ceil((w - ax - off) / step)) + 2):
            r = np.random.default_rng(((k * 73856093) ^ (c * 19349663)) & 0xFFFFFFFF)
            x = ax + off + c * step + (r.random() - 0.5) * step * jitter
            y = ay + k * dy + (r.random() - 0.5) * step * jitter
            pts.append((x, y, r))
    return pts


def leaf_pattern(w, h, ax, ay):
    """Лист конопли: семь зубчатых долей веером."""
    cv = Canvas(w, h)
    for (x, y, r) in scatter(w, h, ax, ay, step=235):
        size = 105 + r.random() * 25
        ang = (r.random() - 0.5) * 1.6
        col = (58, 150, 66, 255) if r.random() < 0.6 else (40, 120, 52, 255)
        vein = (24, 80, 34, 255)
        # доли: (угол от оси, длина)
        lobes = [(0, 1.0), (0.42, 0.86), (-0.42, 0.86), (0.85, 0.66), (-0.85, 0.66), (1.28, 0.38), (-1.28, 0.38)]
        for la, ll in lobes:
            L = size * ll
            pts_l, pts_r = [], []
            n = 18
            for i in range(n + 1):
                tt = i / n
                hw = L * 0.16 * math.sin(math.pi * min(1, tt * 1.05)) ** 0.75 * (1 - 0.25 * tt)
                tooth = 1 + 0.22 * ((i % 2) * 2 - 1) if 0.12 < tt < 0.92 else 1
                pts_l.append((-hw * tooth, -L * tt))
                pts_r.append((hw * tooth, -L * tt))
            shape = pts_l + pts_r[::-1]
            cv.poly(rot(shape, x, y, ang + la), fill=col, outline=vein, width=1.6)
            cv.d.line([(p[0] * SS, p[1] * SS) for p in rot([(0, 0), (0, -L * 0.9)], x, y, ang + la)], fill=vein, width=int(1.4 * SS))
        # черешок
        cv.d.line([(p[0] * SS, p[1] * SS) for p in rot([(0, 0), (0, size * 0.35)], x, y, ang)], fill=vein, width=int(3 * SS))
    return cv.result()


def daisy_pattern(w, h, ax, ay):
    """Ромашки: белые лепестки, жёлтая серединка."""
    cv = Canvas(w, h)
    for (x, y, r) in scatter(w, h, ax, ay, step=175, jitter=0.4):
        R = 56 + r.random() * 16
        n = 12 + int(r.random() * 3)
        a0 = r.random() * math.pi
        for i in range(n):
            a = a0 + i * 2 * math.pi / n
            petal = [(math.cos(k / 10 * 2 * math.pi) * R * 0.2, -R * 0.55 + math.sin(k / 10 * 2 * math.pi) * R * 0.5) for k in range(10)]
            cv.poly(rot(petal, x, y, a), fill=(255, 255, 255, 255), outline=(170, 190, 215, 255), width=1.4)
        cv.ellipse(x, y, R * 0.3, R * 0.3, fill=(255, 196, 40, 255), outline=(214, 130, 0, 255), width=2)
        cv.ellipse(x - R * 0.08, y - R * 0.1, R * 0.1, R * 0.08, fill=(255, 238, 150, 255))
    return cv.result()


def flame_pattern(w, h, ax, ay, height):
    """Байкерское пламя: языки огня от ботинок вверх, с тёмной обводкой."""
    # Координата X от опоры — языки стоят на тех же местах в каждом кадре
    u_x = np.arange(w, dtype=np.float32) - ax
    ys = np.arange(h, dtype=np.float32)[:, None]

    def tongues(seed, amp, base):
        rng = np.random.default_rng(seed)
        top = np.full(w, base, np.float32)
        x = -900.0
        while x < 900:
            wd = 55 + rng.random() * 45
            a = amp * (0.55 + rng.random() * 0.45)
            # острый язык: высота спадает к краям
            k = np.clip(1 - np.abs(u_x - x) / wd, 0, 1) ** 1.6
            top = np.maximum(top, base + a * k)
            x += wd * (0.8 + rng.random() * 0.4)
        return top

    outer = tongues(11, height * 0.34, height * 0.2)
    inner = tongues(23, height * 0.2, height * 0.08)

    up = ay - ys                                    # высота над подошвами
    o = np.clip((outer[None, :] - up) / 2.5, 0, 1)  # мягкий край
    i = np.clip((inner[None, :] - up) / 2.5, 0, 1)
    edge = np.clip((outer[None, :] + 7 - up) / 2.5, 0, 1) * (1 - o)

    u = np.clip(up / np.maximum(outer[None, :], 1), 0, 1)
    red = hexrgb("#e3261c")
    orange = hexrgb("#ff8a1a")
    yellow = hexrgb("#ffe45c")
    col = orange[None, None, :] * (1 - u[..., None]) + red[None, None, :] * u[..., None]
    col = col * (1 - i[..., None]) + yellow[None, None, :] * i[..., None]
    out = np.zeros((h, w, 4), np.float32)
    out[..., :3] = col * o[..., None] + np.array(OUTLINE, np.float32) / 255 * edge[..., None]
    out[..., 3] = np.clip(o + edge, 0, 1)
    return out


# ─── Демон: стекло, глаза, рога, хвост ────────────────────

def demon_visor(img, m):
    """Стекло шлема — тёмно-алое, блики розоватые, два горящих глаза."""
    vis = m["visor"] & (m["a"] > 0.02)
    ys, xs = np.nonzero(vis)
    rgb = img[..., :3]
    P = rgb[ys, xs]
    V, S = hsv_vs(P)
    glass = (S > 0.25) & (P[:, 2] >= P[:, 0])          # сине-фиолетовое стекло и контур
    nv = np.stack([V * 1.05, V * 0.12, V * 0.16], -1)
    P2 = P.copy()
    P2[glass] = nv[glass]
    hl = (S < 0.25) & (V > 0.55)                        # блики
    P2[hl] = P[hl] * np.array([1.0, 0.82, 0.84], np.float32)
    rgb[ys, xs] = np.clip(P2, 0, 1)

    # Глаза: по рамке стекла, чуть вправо — герой смотрит вправо
    gy, gx = np.nonzero(m["glass"])
    x0, x1, y0, y1 = gx.min(), gx.max(), gy.min(), gy.max()
    vw = x1 - x0
    cx = x0 + 0.58 * vw
    cy = y0 + 0.52 * (y1 - y0)
    h, w = rgb.shape[:2]
    glow = Image.new("L", (w, h), 0)
    core = Image.new("L", (w, h), 0)
    dg, dc = ImageDraw.Draw(glow), ImageDraw.Draw(core)
    for side in (-1, 1):
        ex = cx + side * 0.16 * vw
        ew, eh = 0.125 * vw, 0.058 * vw
        # Злой прищур: внутренние уголки ниже
        shape = [(-ew, -eh * 0.2), (0, -eh), (ew, -eh * 0.4), (ew * 0.7, eh * 0.6), (-ew * 0.8, eh * 0.7)]
        pts = rot([(x * -side, y) for x, y in shape], ex, cy, side * 0.3)
        dg.polygon(pts, fill=255)
        dc.polygon(rot([(x * 0.55 * -side, y * 0.45) for x, y in shape], ex, cy, side * 0.3), fill=255)
    glow = np.asarray(glow.filter(ImageFilter.GaussianBlur(vw * 0.05))).astype(np.float32) / 255
    core_a = np.asarray(core.filter(ImageFilter.GaussianBlur(1.2))).astype(np.float32) / 255
    clip = ndi.binary_erosion(m["visor"], structure=disk(6)).astype(np.float32)
    g = np.clip(glow * 1.6, 0, 1) * clip
    c = core_a * clip
    rgb[...] = np.clip(rgb + g[..., None] * np.array([1.0, 0.35, 0.05], np.float32), 0, 1)
    rgb[...] = rgb * (1 - c[..., None]) + c[..., None] * np.array([1.0, 0.93, 0.55], np.float32)


def bezier(p0, p1, p2, n):
    out = []
    for i in range(n + 1):
        t = i / n
        out.append(((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
                    (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]))
    return out


def tube(center, w0, w1, taper=1.0):
    """Полигон «трубки» вдоль ломаной с шириной от w0 к w1."""
    left, right = [], []
    n = len(center) - 1
    for i, (x, y) in enumerate(center):
        a = center[max(0, i - 1)]
        b = center[min(n, i + 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        d = math.hypot(dx, dy) or 1
        nx, ny = -dy / d, dx / d
        t = i / n
        hw = w0 + (w1 - w0) * (t ** taper)
        left.append((x + nx * hw, y + ny * hw))
        right.append((x - nx * hw, y - ny * hw))
    return left + right[::-1]


def draw_horns(img, m):
    cx, cy, R = helmet_circle(m)
    h, w = img.shape[:2]
    cv = Canvas(w, h)
    for th, L, flip in ((-0.62, 0.66, -1), (0.28, 0.6, 1)):
        nx, ny = math.sin(th), -math.cos(th)
        base = (cx + nx * R * 0.9, cy + ny * R * 0.9)
        Lh = R * L
        a1 = th * 1.5
        a2 = th * 0.35
        p1 = (base[0] + math.sin(a1) * Lh * 0.62, base[1] - math.cos(a1) * Lh * 0.62)
        p2 = (base[0] + math.sin(a2) * Lh, base[1] - math.cos(a2) * Lh)
        c = bezier(base, p1, p2, 28)
        poly = tube(c, R * 0.15, 0.6, taper=0.9)
        cv.poly(tube(c, R * 0.15 + 7, 3.5, taper=0.9), fill=OUTLINE + (255,))
        cv.poly(poly, fill=(190, 24, 36, 255))
        # Блик вдоль рога и светлый кончик
        hl = tube([(x + flip * 0, y) for x, y in c[3:22]], R * 0.035, 0.5)
        cv.poly(hl, fill=(255, 120, 90, 200))
        tip = tube(c[19:], R * 0.06, 0.5, taper=0.9)
        cv.poly(tip, fill=(255, 205, 150, 255))
    over = cv.result()
    a = over[..., 3:4]
    img[..., :3] = img[..., :3] * (1 - a) + over[..., :3] * a
    img[..., 3] = np.maximum(img[..., 3], over[..., 3])


def draw_tail(img, m, ax, ay, H):
    """Хвост со стрелкой — из-за спины (рисуется под героем)."""
    h, w = img.shape[:2]
    cv = Canvas(w, h)
    p0 = (ax - 0.12 * H, ay - 0.3 * H)
    c = bezier(p0, (ax - 0.42 * H, ay - 0.34 * H), (ax - 0.33 * H, ay - 0.1 * H), 30)
    cv.poly(tube(c, 0.032 * H + 6, 0.02 * H + 6), fill=OUTLINE + (255,))
    cv.poly(tube(c, 0.032 * H, 0.02 * H), fill=(150, 18, 32, 255))
    # Наконечник-«пика»
    tx, ty = c[-1]
    dx, dy = c[-1][0] - c[-4][0], c[-1][1] - c[-4][1]
    ang = math.atan2(dy, dx) + math.pi / 2
    s = 0.07 * H
    spade = [(0, -s * 1.25), (s * 0.75, s * 0.1), (s * 0.3, s * 0.35), (0, s * 0.15), (-s * 0.3, s * 0.35), (-s * 0.75, s * 0.1)]
    cv.poly(rot([(x * 1.18, y * 1.18 - 3) for x, y in spade], tx, ty, ang), fill=OUTLINE + (255,))
    cv.poly(rot(spade, tx, ty, ang), fill=(200, 28, 40, 255))
    under = cv.result()
    # Под героем: видно только там, где героя нет
    a0 = img[..., 3:4]
    ua = under[..., 3:4] * (1 - a0)
    tot = a0 + ua
    img[..., :3] = np.where(tot > 0, (img[..., :3] * a0 + under[..., :3] * ua) / np.maximum(tot, 1e-6), img[..., :3])
    img[..., 3] = np.clip(tot[..., 0], 0, 1)


# ─── Рецепты ──────────────────────────────────────────────

BLACK = ramp([(0, "#0e0e14"), (0.55, "#1e1f29"), (0.8, "#2d2e3b"), (0.95, "#3c3e4f"), (1, "#4c4f64")])
RED   = ramp([(0, "#4a0a10"), (0.55, "#8e1520"), (0.8, "#c21f27"), (0.95, "#e0302f"), (1, "#f0443a")])
SAGE  = ramp([(0, "#6e7866"), (0.55, "#a9b59e"), (0.8, "#d6e0cc"), (1, "#f2f7ea")])
SKY   = ramp([(0, "#1d4a7a"), (0.55, "#3f7fbf"), (0.8, "#62a8e6"), (1, "#86c6ff")])
CRIM  = ramp([(0, "#1a0508"), (0.55, "#3d0a12"), (0.8, "#6e0f1c"), (0.95, "#8e1424"), (1, "#a81a2a")])
DARKG = ramp([(0, "#0c080a"), (0.5, "#1c1216"), (1, "#3a2830")])


def make(skin, img, m, anchor, H):
    ax, ay = anchor
    h, w = img.shape[:2]
    if skin == "black":
        recolor_region(img, m, m["fabric"], ramp_color(BLACK))
    elif skin == "red":
        recolor_region(img, m, m["fabric"], ramp_color(RED))
    elif skin == "hemp":
        recolor_region(img, m, m["fabric"], print_color(SAGE, leaf_pattern(w, h, ax, ay)))
    elif skin == "daisy":
        recolor_region(img, m, m["fabric"], print_color(SKY, daisy_pattern(w, h, ax, ay), shade_min=0.7))
    elif skin == "biker":
        recolor_region(img, m, m["fabric"], print_color(BLACK, flame_pattern(w, h, ax, ay, H), shade_min=0.75))
    elif skin == "demon":
        recolor_region(img, m, m["fabric"], ramp_color(CRIM))
        recolor_region(img, m, m["gray"], ramp_color(DARKG), zone_grow=2, exclude=m["fabric"])
        demon_visor(img, m)
        draw_horns(img, m)
        draw_tail(img, m, ax, ay, H)
    else:
        raise ValueError(f"нет рецепта для скина {skin}")


ALL = ["black", "red", "hemp", "daisy", "biker", "demon"]


# ─── Кадры героя из art.config.json ───────────────────────

def natural_key(name):
    import re
    base = os.path.splitext(name)[0]
    mm = re.search(r"\d+", base)
    return (0, int(mm.group()), base) if mm else (1, 0, base)


def hero_frames():
    cfg = json.load(open(CONFIG, encoding="utf-8"))
    out = {}
    for slot in SLOTS:
        sp = cfg.get("sprites", {}).get(slot)
        if not sp:
            continue
        src = sp["src"] if isinstance(sp["src"], list) else [sp["src"]]
        paths = []
        for item in src:
            p = os.path.join(ROOT, item)
            if os.path.isdir(p):
                paths += [os.path.join(p, f) for f in sorted((f for f in os.listdir(p) if f.lower().endswith(".png")), key=natural_key)]
            else:
                paths.append(p)
        out[slot] = paths
    return out


def load(path):
    img = np.asarray(Image.open(path).convert("RGBA")).astype(np.float32) / 255
    return np.pad(img, ((PAD, PAD), (PAD, PAD), (0, 0)))


def main():
    skins = [s for s in sys.argv[1:] if not s.startswith("-")] or ALL
    unknown = [s for s in skins if s not in ALL]
    if unknown:
        print("Нет таких скинов:", ", ".join(unknown), "— есть:", ", ".join(ALL))
        return 1
    frames = hero_frames()
    # Рост героя — по первому кадру стойки: от него масштаб принта и хвоста
    ref = analyze(load(frames["hero_idle"][0]))
    H = ref["bbox"][3] - ref["bbox"][1]
    cache = {}
    for skin in skins:
        n = 0
        for slot, paths in frames.items():
            d = os.path.join(OUT_DIR, skin, slot)
            os.makedirs(d, exist_ok=True)
            for old in os.listdir(d):
                if old.lower().endswith(".png"):
                    os.remove(os.path.join(d, old))
            for i, p in enumerate(paths):
                if p not in cache:
                    base = load(p)
                    m = analyze(base)
                    cache[p] = (base, m, feet_anchor(m))
                base, m, anchor = cache[p]
                img = base.copy()
                make(skin, img, m, anchor, H)
                Image.fromarray((np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA").save(
                    os.path.join(d, f"{i + 1}.png"), optimize=True)
                n += 1
        print(f"  {skin:<6} кадров: {n}")
    print(f"Готово: {os.path.relpath(OUT_DIR, ROOT)}  (атласы соберёт tools/build_sprites.py)")


if __name__ == "__main__":
    sys.exit(main())
