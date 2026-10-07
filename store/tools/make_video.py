# -*- coding: utf-8 -*-
"""
make_video.py — ролики для карточки Space Jump из записи store/_rec/<язык>/.

    python store/tools/make_video.py

Для каждого языка:
  video_vertical.mp4    — 9:16, 1080×1920: настоящий забег как есть;
  video_horizontal.mp4  — 16:9, 1920×1080: забег по центру в полную высоту,
                          по бокам — тот же кадр, размытый и затемнённый
                          (игра портретная, в 16:9 целиком не влезает);
  ad_vertical.mp4, ad_horizontal.mp4 — «Рекламные видео»: нарезка лучших
                          моментов с подписями, переходами, парадом скинов
                          и финальной карточкой.

Требования консоли (см. store/README.md): MP4, до 28 с, до 100 МБ; рекламные —
не меньше 720×1280 / 1280×720. Звук — музыка самой игры.
"""
import bisect
import json
import os
import shutil
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageEnhance

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_media as mm   # noqa: E402  — логотип, герои, космос, шрифт

ROOT = mm.ROOT
STORE = mm.STORE
MUSIC = os.path.join(ROOT, "assets", "sounds", "music.ogg")
TMP = os.path.join(STORE, "_tmp_video")
FPS = 30
MAX_LEN = 27.5

CAPTIONS = {
    "ru": {
        "aim": "Зажми, оттяни, отпусти!",
        "jet": "Джетпак: очки прямо в полёте",
        "hot": "Прыгай без пауз — очки ×3",
        "meteor": "Уворачивайся от метеоритов",
        "tele": "Телепорт на любую платформу",
        "hole": "Облетай чёрные дыры",
        "skins": "Шесть скафандров",
        "play": "Играй сейчас!",
    },
    "en": {
        "aim": "Hold, pull back, release!",
        "jet": "Jetpack: points mid-flight",
        "hot": "No pauses — score ×3",
        "meteor": "Dodge the meteors",
        "tele": "Teleport to any platform",
        "hole": "Fly around black holes",
        "skins": "Six space suits",
        "play": "Play now!",
    },
}

# Нарезка для рекламного ролика: (отметка записи, сдвиг, длительность, подпись)
AD_CUTS = [("aim", 0.0, 2.8, "aim"), ("jet", 0.0, 2.6, "jet"), ("hot", 0.2, 2.6, "hot"),
           ("meteor", 0.3, 2.3, "meteor"), ("tele", 0.3, 1.9, "tele"), ("hole", 0.1, 2.6, "hole")]
XFADE = 0.25


def run(args):
    r = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode:
        print(r.stderr[-2000:])
        raise SystemExit("ffmpeg завершился с ошибкой")


# ─── Запись → кадры с постоянной частотой ──────────────────

class Take:
    """Кадры записи с метками времени: кадр на любой момент времени."""

    def __init__(self, lang):
        self.dir = os.path.join(STORE, "_rec", lang)
        meta = json.load(open(os.path.join(self.dir, "meta.json"), encoding="utf-8"))
        self.frames = meta["frames"]
        self.t = [f["t"] for f in self.frames]
        self.t0 = self.t[0]
        self.marks = {k: v - self.t0 for k, v in meta["marks"].items()}
        self.length = min(self.marks.get("end", self.t[-1] - self.t0) + 0.4, self.t[-1] - self.t0, MAX_LEN)

    def path_at(self, sec):
        i = max(0, bisect.bisect_right(self.t, self.t0 + sec) - 1)
        return os.path.join(self.dir, "frames", self.frames[i]["f"])

    def frame(self, sec):
        return Image.open(self.path_at(sec)).convert("RGB")

    def concat_list(self, start, length, out):
        """Список для ffmpeg concat: по кадру на каждую 1/30 с."""
        lines = []
        n = int(round(length * FPS))
        for k in range(n):
            p = self.path_at(start + k / FPS).replace("\\", "/")
            lines.append(f"file '{p}'\nduration {1 / FPS:.6f}")
        lines.append(f"file '{self.path_at(start + (n - 1) / FPS)}'".replace("\\", "/"))
        with open(out, "w", encoding="utf-8") as fh:
            fh.write("\n".join(lines))
        return out


def audio_args(length):
    """Музыка игры по кругу, мягкое затухание в конце."""
    if not os.path.isfile(MUSIC):
        return [], []
    fade = max(0.0, length - 1.2)
    return (["-stream_loop", "-1", "-i", MUSIC],
            ["-map", "1:a", "-af", f"afade=t=in:d=0.4,afade=t=out:st={fade:.2f}:d=1.2,volume=0.9",
             "-c:a", "aac", "-b:a", "160k", "-t", f"{length:.3f}"])


def encode(inputs, vf_args, out, length, vmap="0:v"):
    """vmap — какой видеопоток в файл: вход или выход filter_complex («[v]»)."""
    ain, aout = audio_args(length)
    args = ["ffmpeg", "-y", "-v", "error", *inputs, *ain, *vf_args, "-map", vmap,
            *aout, "-c:v", "libx264", "-preset", "slow", "-crf", "19", "-pix_fmt", "yuv420p",
            "-r", str(FPS), "-movflags", "+faststart", "-t", f"{length:.3f}", out]
    run(args)


# ─── Геймплейные ролики ───────────────────────────────────

def gameplay_videos(lang, take):
    lst = take.concat_list(0.0, take.length, os.path.join(TMP, f"{lang}_gameplay.txt"))
    src = ["-f", "concat", "-safe", "0", "-i", lst]
    encode(src, ["-vf", "scale=1080:1920:flags=lanczos,setsar=1"],
           os.path.join(STORE, lang, "video_vertical.mp4"), take.length)
    fg_w = 608
    fx = (1920 - fg_w) // 2
    horizontal = (
        "[0:v]split[a][b];"
        "[a]scale=480:-2,crop=480:270,boxblur=8:2,scale=1920:1080:flags=bicubic,"
        "eq=brightness=-0.28:saturation=0.7[bg];"
        f"[b]scale={fg_w}:1080:flags=lanczos[fg];"
        f"[bg][fg]overlay={fx}:0,"
        f"drawbox=x={fx - 3}:y=0:w={fg_w + 6}:h=1080:color=0x46DCFF@0.55:t=3,setsar=1[v]"
    )
    encode(src, ["-filter_complex", horizontal],
           os.path.join(STORE, lang, "video_horizontal.mp4"), take.length, vmap="[v]")


# ─── Рекламные ролики (кадры собираются в PIL) ─────────────

def ease(t):
    t = max(0.0, min(1.0, t))
    return 1 - (1 - t) ** 3


def fit_lines(text, max_w, size):
    """Текст в одну или две строки так, чтобы плашка влезла в max_w; шрифт уменьшается при нужде."""
    while True:
        f = mm.font(size)
        pad_x = size * 0.8
        if f.getlength(text) + pad_x * 2 <= max_w:
            return [text], f, size
        words = text.split(" ")
        best = None
        for i in range(1, len(words)):
            a, b = " ".join(words[:i]), " ".join(words[i:])
            w = max(f.getlength(a), f.getlength(b))
            if best is None or w < best[0]:
                best = (w, [a, b])
        if best and best[0] + pad_x * 2 <= max_w:
            return best[1], f, size
        size -= 2


def caption_img(text, max_w, size):
    """Плашка с подписью в стиле интерфейса игры: в одну-две строки, всегда влезает."""
    lines, f, size = fit_lines(text, max_w, size)
    pad_x, pad_y = int(size * 0.8), int(size * 0.45)
    lh = int(size * 1.22)
    tw = max(f.getlength(l) for l in lines)
    W = int(tw + pad_x * 2)
    H = int(lh * len(lines) + pad_y * 2)
    r = min(H // 2, int(size * 0.9))
    im = Image.new("RGBA", (W + 20, H + 20), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((10, 14, W + 10, H + 14), radius=r, fill=(5, 5, 18, 150))
    d.rounded_rectangle((10, 10, W + 10, H + 10), radius=r, fill=(20, 18, 56, 235),
                        outline=mm.CYAN + (200,), width=max(2, size // 16))
    for i, line in enumerate(lines):
        lw = f.getlength(line)
        x, y = 10 + (W - lw) / 2, 10 + pad_y + i * lh
        d.text((x + 2, y + 3), line, font=f, fill=mm.INK + (255,))
        d.text((x, y), line, font=f, fill=(255, 255, 255, 255))
    return im


def fade(im, a):
    if a >= 1:
        return im
    out = im.copy()
    out.putalpha(im.getchannel("A").point(lambda v: int(v * a)))
    return out


def side_bg(frame, W, H):
    small = mm.cover_crop(frame, W // 4, H // 4).filter(ImageFilter.GaussianBlur(6))
    bg = small.resize((W, H), Image.BICUBIC)
    return ImageEnhance.Brightness(bg).enhance(0.55)


def compose(frame, W, H):
    """Кадр игры в нужном формате: 9:16 как есть, 16:9 — по центру на размытом фоне."""
    if W < H:
        return frame.resize((W, H), Image.LANCZOS).convert("RGBA")
    img = side_bg(frame, W, H).convert("RGBA")
    fg = frame.resize((H * 1080 // 1920, H), Image.LANCZOS)
    fx = (W - fg.width) // 2
    img.paste(fg, (fx, 0))
    ImageDraw.Draw(img).rectangle((fx - 3, 0, fx + fg.width + 2, H), outline=mm.CYAN + (170,), width=3)
    return img


class AdRenderer:
    def __init__(self, lang, take, W, H):
        self.lang, self.take, self.W, self.H = lang, take, W, H
        self.vertical = W < H
        self.cap = CAPTIONS[lang]
        self.logo = mm.logo(0.9 if self.vertical else 0.75)
        self.logo_big = mm.logo(1.6 if self.vertical else 1.15)   # заставка и финал
        self.space = mm.space(W, H, seed=77).convert("RGBA")
        # Для горизонтального ролика — постоянная правая панель: логотип и герой
        if not self.vertical:
            self.hero_r = mm.hero("idle", "white", 520)
            self.plat_r = mm.platform(380)

    def caption_layer(self, key, t_local, dur):
        """Подпись въезжает и исчезает в конце сегмента."""
        size = 64 if self.vertical else 52
        cap = caption_img(self.cap[key], self.W * (0.9 if self.vertical else 0.3), size)
        a = min(ease(t_local / 0.35), ease((dur - t_local) / 0.25))
        dy = int((1 - ease(t_local / 0.35)) * 40)
        return fade(cap, a), dy

    def gameplay_frame(self, key, t_abs, t_local, dur):
        img = compose(self.take.frame(t_abs), self.W, self.H)
        cap, dy = self.caption_layer(key, t_local, dur)
        if self.vertical:
            img.alpha_composite(cap, ((self.W - cap.width) // 2, 300 + dy))
        else:
            fx = (self.W - self.H * 1080 // 1920) // 2
            cx = (fx - cap.width) // 2
            img.alpha_composite(cap, (max(10, cx), self.H // 2 - cap.height // 2 + dy))
            lg = self.logo
            rx = fx + self.H * 1080 // 1920
            img.alpha_composite(lg, (rx + (self.W - rx - lg.width) // 2, 90))
            mm.put(img, self.plat_r, rx + (self.W - rx - self.plat_r.width) // 2, 820)
            mm.put(img, self.hero_r, rx + (self.W - rx - self.hero_r.width) // 2, 820 - self.hero_r.height + 26)
        return img

    def intro_frame(self, t, dur):
        base = self.take.frame(self.take.marks["aim"])
        img = compose(base, self.W, self.H)
        img = ImageEnhance.Brightness(img.convert("RGB").filter(ImageFilter.GaussianBlur(10))).enhance(0.5).convert("RGBA")
        k = ease(t / 0.6)
        big = self.logo_big
        lg = big.resize((max(1, int(big.width * (0.7 + 0.3 * k))), max(1, int(big.height * (0.7 + 0.3 * k)))), Image.LANCZOS)
        img.alpha_composite(fade(lg, k), ((self.W - lg.width) // 2, int(self.H * 0.36 - lg.height / 2)))
        tag = caption_img(mm.TEXT[self.lang]["tagline"], self.W * 0.9, 56 if self.vertical else 46)
        a = ease((t - 0.5) / 0.4)
        img.alpha_composite(fade(tag, a), ((self.W - tag.width) // 2, int(self.H * 0.36 + big.height * 0.62)))
        return img

    def skins_frame(self, t, dur):
        img = self.space.copy()
        skins = ["white", "black", "red", "daisy", "biker", "demon"]
        if not hasattr(self, "_skin_imgs"):
            hh = 360 if self.vertical else 330
            self._skin_imgs = [mm.hero("jump" if i % 2 else "idle", s, hh + (40 if s == "demon" else 0)) for i, s in enumerate(skins)]
            self._plat = mm.platform(230 if self.vertical else 210)
        cap, dy = self.caption_layer("skins", t, dur)
        img.alpha_composite(cap, ((self.W - cap.width) // 2, (260 if self.vertical else 90) + dy))
        for i, him in enumerate(self._skin_imgs):
            k = ease((t - i * 0.12) / 0.4)
            if self.vertical:
                col, row = i % 2, i // 2
                x = self.W * (0.3 + 0.4 * col) - him.width / 2
                base_y = 820 + row * 400 - col * 60
            else:
                x = self.W * (0.12 + 0.152 * i) - him.width / 2
                base_y = 820 - (i % 2) * 60
            y_off = (1 - k) * 260
            px = x + him.width / 2 - self._plat.width / 2
            layer_p = fade(self._plat, k)
            img.alpha_composite(layer_p, (int(px), int(base_y + y_off)))
            img.alpha_composite(fade(him, k), (int(x), int(base_y - him.height + 24 + y_off)))
        return img

    def outro_frame(self, t, dur):
        img = self.space.copy()
        hero = mm.hero("jump", "white", 520 if self.vertical else 440)
        k = ease(t / 0.5)
        hx = (self.W - hero.width) // 2 if self.vertical else int(self.W * 0.22 - hero.width / 2)
        hy = int(self.H * (0.52 if self.vertical else 0.5) - hero.height / 2 + (1 - k) * 120)
        mm.put(img, fade(hero, k), hx, hy)
        lg = self.logo_big
        lx = (self.W - lg.width) // 2 if self.vertical else int(self.W * 0.62 - lg.width / 2)
        ly = int(self.H * 0.17) if self.vertical else int(self.H * 0.32)
        img.alpha_composite(fade(lg, ease((t - 0.2) / 0.4)), (lx, ly))
        play = caption_img(self.cap["play"], self.W * 0.8, 72 if self.vertical else 60)
        a = ease((t - 0.6) / 0.4)
        px = (self.W - play.width) // 2 if self.vertical else int(self.W * 0.62 - play.width / 2)
        py = int(self.H * 0.8) if self.vertical else int(self.H * 0.32 + lg.height + 60)
        img.alpha_composite(fade(play, a), (px, py))
        return img

    def timeline(self):
        """Сегменты: (длительность, функция(t_local) → кадр)."""
        segs = [(1.8, lambda t: self.intro_frame(t, 1.8))]
        for mark, off, dur, key in AD_CUTS:
            start = self.take.marks[mark] + off
            segs.append((dur, (lambda s, d, k: lambda t: self.gameplay_frame(k, s + t, t, d))(start, dur, key)))
        segs.append((2.4, lambda t: self.skins_frame(t, 2.4)))
        segs.append((2.4, lambda t: self.outro_frame(t, 2.4)))
        return segs

    def render(self, out):
        frames_dir = os.path.join(TMP, f"ad_{self.lang}_{self.W}x{self.H}")
        shutil.rmtree(frames_dir, ignore_errors=True)
        os.makedirs(frames_dir)
        segs = self.timeline()
        # Переходы — наплыв XFADE секунд: сегменты перекрываются
        total = sum(d for d, _ in segs) - XFADE * (len(segs) - 1)
        starts, acc = [], 0.0
        for d, _ in segs:
            starts.append(acc)
            acc += d - XFADE
        n = int(round(total * FPS))
        for k in range(n):
            t = k / FPS
            active = [(i, t - starts[i]) for i in range(len(segs)) if 0 <= t - starts[i] < segs[i][0]]
            i, tl = active[-1]
            img = segs[i][1](tl)
            if len(active) > 1:                                   # наплыв с предыдущим
                j, tj = active[-2]
                prev = segs[j][1](tj)
                a = min(1.0, tl / XFADE)
                img = Image.blend(prev.convert("RGB"), img.convert("RGB"), a)
            img.convert("RGB").save(os.path.join(frames_dir, f"{k:05d}.jpg"), quality=94)
        encode(["-framerate", str(FPS), "-i", os.path.join(frames_dir, "%05d.jpg")], [], out, total)
        return total


def info(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                        "stream=width,height:format=duration,size", "-of", "json", path],
                       capture_output=True, text=True)
    j = json.loads(r.stdout)
    s, f = j["streams"][0], j["format"]
    return f"{s['width']}x{s['height']}, {float(f['duration']):.1f} с, {int(f['size']) / 1024 / 1024:.1f} МБ"


def main():
    langs = [a for a in sys.argv[1:] if a in ("ru", "en")] or ["ru", "en"]
    only_ads = "ads" in sys.argv
    os.makedirs(TMP, exist_ok=True)
    for lang in langs:
        take = Take(lang)
        os.makedirs(os.path.join(STORE, lang), exist_ok=True)
        if not only_ads:
            gameplay_videos(lang, take)
        AdRenderer(lang, take, 1080, 1920).render(os.path.join(STORE, lang, "ad_vertical.mp4"))
        AdRenderer(lang, take, 1920, 1080).render(os.path.join(STORE, lang, "ad_horizontal.mp4"))
        for name in ("video_vertical", "video_horizontal", "ad_vertical", "ad_horizontal"):
            p = os.path.join(STORE, lang, name + ".mp4")
            if os.path.isfile(p):
                print(f"  {lang}/{name}.mp4  {info(p)}")
    shutil.rmtree(TMP, ignore_errors=True)


if __name__ == "__main__":
    main()
