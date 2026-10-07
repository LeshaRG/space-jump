# -*- coding: utf-8 -*-
"""
make_icons.py — иконки Android-версии из арта игры (та же сцена, что store/icon.png).

    python rustore/scripts/make_icons.py

  • mipmap-*/ic_launcher_foreground.png — адаптивная иконка Android 8+: сцена на всю
    площадь 108 dp, герой, платформа и монета — в центральном круге 66 dp, который не
    обрезает ни одна маска лаунчера (круг, капля, квадрат). Её же показывает заставка;
  • mipmap-*/ic_launcher.png и ic_launcher_round.png — для Android 7 (скруглённый
    квадрат и круг);
  • rustore/store/icon.png — иконка для карточки RuStore: 512×512, без прозрачности;
  • rustore/store/_preview_icons.png — как иконка выглядит под разными масками (для проверки).

Нужны Python, Pillow и numpy — как для store/tools/make_media.py.
"""
import os
import sys

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
RU = os.path.dirname(HERE)
ROOT = os.path.dirname(RU)
sys.path.insert(0, os.path.join(ROOT, "store", "tools"))
import make_media as mm  # noqa: E402  (арт и сцена иконки — общие с карточкой Яндекса)

RES = os.path.join(RU, "android", "app", "src", "main", "res")
STORE = os.path.join(RU, "store")
DENSITY = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
BIG = 1024
SAFE = 66 / 108            # доля безопасного круга адаптивной иконки


def mask(size, shape, radius=0.18):
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    if shape == "circle":
        d.ellipse((0, 0, size - 1, size - 1), fill=255)
    else:
        d.rounded_rectangle((0, 0, size - 1, size - 1), radius=int(size * radius), fill=255)
    return m


def clipped(img, shape, margin=0.04):
    """Иконка Android 7: сцена в скруглённом квадрате или круге с небольшим полем."""
    s = img.width
    inner = int(s * (1 - margin * 2))
    tile = img.resize((inner, inner), Image.LANCZOS).convert("RGBA")
    tile.putalpha(mask(inner, shape))
    out = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    out.alpha_composite(tile, ((s - inner) // 2, (s - inner) // 2))
    return out


def save(img, path, size):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.resize((size, size), Image.LANCZOS).save(path, optimize=True)


def preview(fg):
    """Иконка под масками лаунчеров: круг, скруглённый квадрат, «капля»."""
    s = 216
    visible = fg.resize((int(s * 108 / 72),) * 2, Image.LANCZOS)   # видно 72 dp из 108
    off = (visible.width - s) // 2
    visible = visible.crop((off, off, off + s, off + s))
    sheet = Image.new("RGB", (s * 3 + 80, s + 40), (30, 30, 40))
    for i, shape in enumerate(["circle", "rounded", "squircle"]):
        m = mask(s, "circle" if shape == "circle" else "rounded", 0.42 if shape == "squircle" else 0.2)
        sheet.paste(visible, (20 + i * (s + 20), 20), m)
    return sheet


def main():
    pad = (1 - SAFE) / 2 * 0.92                      # чуть шире круга: углы сцены — фон
    fg = mm.icon_scene(BIG, pad=pad).convert("RGB")
    full = mm.icon_scene(BIG).convert("RGB")
    square = clipped(full, "rounded")
    round_ = clipped(full, "circle", margin=0.02)

    for name, k in DENSITY.items():
        d = os.path.join(RES, f"mipmap-{name}")
        save(fg, os.path.join(d, "ic_launcher_foreground.png"), round(108 * k))
        save(square, os.path.join(d, "ic_launcher.png"), round(48 * k))
        save(round_, os.path.join(d, "ic_launcher_round.png"), round(48 * k))

    os.makedirs(STORE, exist_ok=True)
    full.resize((512, 512), Image.LANCZOS).save(os.path.join(STORE, "icon.png"), optimize=True)
    preview(fg).save(os.path.join(STORE, "_preview_icons.png"))
    print("иконки: mipmap-* (адаптивная + Android 7), store/icon.png 512x512")


if __name__ == "__main__":
    main()
