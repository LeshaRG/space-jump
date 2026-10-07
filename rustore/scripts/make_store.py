# -*- coding: utf-8 -*-
"""
make_store.py — материалы для карточки RuStore: тексты с проверкой лимитов и скриншоты.

    python rustore/scripts/make_store.py

Пишет rustore/store/texts.md и копирует скриншоты телефона из store/ru/screenshots
(их снимает store/tools/capture.mjs — настоящий забег, 1080×1920) с проверкой
требований RuStore. Иконку делает scripts/make_icons.py.
"""
import os
import shutil

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
RU = os.path.dirname(HERE)
ROOT = os.path.dirname(RU)
OUT = os.path.join(RU, "store")

# Лимиты консоли RuStore
LIMITS = {"name": 30, "short": 80, "full": 4000, "news": 500}

T = {
    "ru": {
        "name": "Space Jump: прыжки к звёздам",
        "short": "Прыгай рогаткой по космическим платформам и бей свой рекорд",
        "full": """Космонавт стоит на планете, а над ним — бесконечная лестница из летающих платформ. Зажмите экран, оттяните назад и отпустите: герой прыгнет, как из рогатки, а гаснущий пунктир подскажет, куда он полетит.

ЧТО ВАС ЖДЁТ
• Прыжки рогаткой: сила и направление — одним движением пальца.
• Рикошеты от стен — так проще попасть в узкие «карманы» с монетами.
• Жар: прыгайте без пауз, и множитель очков вырастет до ×3.
• Монеты и алмазы лежат на сложных платформах — маленьких, ломающихся или спрятанных за стенкой.
• Опасности: метеориты, ракетные турели и чёрные дыры, которые затягивают траекторию.
• Бустеры: джетпак, телепорт на любую платформу, точный прицел и разрушитель стен.
• Каждые 200 очков приносят монеты, а выше личного рекорда выплаты удваиваются.
• Скафандры на любой вкус — от классического белого до премиального демона с рогами.

КАК ИГРАТЬ
Зажмите экран, оттяните палец назад и отпустите — космонавт прыгнет в противоположную сторону. Чем сильнее натяжение, тем дальше прыжок. Упали за нижний край экрана или угодили в центр чёрной дыры — забег окончен. Попробуйте забраться выше, чем в прошлый раз!

ВАЖНО
• Игра работает без интернета.
• Покупок за реальные деньги нет: монеты зарабатываются в игре.
• Реклама — между забегами, а видео за награду — только по вашей кнопке.
• Управление одной рукой, вертикальный экран.""",
        "news": "Первая версия Space Jump для Android: прыжки рогаткой, жар ×3, бустеры, шесть скафандров и личные рекорды. Игра работает без интернета.",
    },
    "en": {
        "name": "Space Jump",
        "short": "Slingshot up space platforms and beat your own record",
        "full": """An astronaut stands on a planet, and above him rises an endless ladder of floating platforms. Hold the screen, pull back and release: the hero leaps like a stone from a slingshot, and a fading dotted line shows where he will fly.

FEATURES
• Slingshot jumps: power and direction in one finger move.
• Bounce off the walls to reach narrow pockets with coins.
• Heat: jump without pauses and your score multiplier grows up to ×3.
• Coins and diamonds lie on tricky platforms — tiny, crumbling or hidden behind a wall.
• Hazards: meteors, rocket turrets and black holes that bend your path.
• Boosters: a jetpack, a teleport to any platform, a precise aim and a wall breaker.
• Every 200 points pays out coins, and above your personal best the payouts are doubled.
• Space suits for every taste — from the classic white one to the premium horned demon.

HOW TO PLAY
Hold the screen, pull your finger back and release — the astronaut jumps the opposite way. The harder you pull, the farther he flies. Fall below the screen or into the core of a black hole and the run is over. Try to climb higher than last time!

GOOD TO KNOW
• Works offline.
• No real-money purchases: coins are earned in the game.
• Ads appear between runs; rewarded videos only when you tap the button.
• One-hand controls, portrait screen.""",
        "news": "The first Android version of Space Jump: slingshot jumps, heat ×3, boosters, six suits and personal records. Works offline.",
    },
}


def check_texts():
    bad = []
    for lang, d in T.items():
        for k, lim in LIMITS.items():
            if len(d[k]) > lim:
                bad.append(f"{lang}.{k}: {len(d[k])} > {lim}")
    if bad:
        raise SystemExit("Тексты не влезают в лимиты RuStore:\n" + "\n".join(bad))


def copy_screens():
    src = os.path.join(ROOT, "store", "ru", "screenshots")
    dst = os.path.join(OUT, "screenshots")
    os.makedirs(dst, exist_ok=True)
    names = sorted(f for f in os.listdir(src) if f.startswith("mobile_") and f.endswith(".png"))
    rows = []
    for n in names:
        im = Image.open(os.path.join(src, n))
        w, h = im.size
        size = os.path.getsize(os.path.join(src, n))
        if (w, h) != (1080, 1920) or im.mode != "RGB" or size > 3 * 1024 * 1024:
            raise SystemExit(f"{n}: {w}x{h} {im.mode} {size} байт — нужен 9:16 RGB до 3 МБ")
        shutil.copyfile(os.path.join(src, n), os.path.join(dst, n))
        rows.append((n, w, h, size))
    if not 3 <= len(rows) <= 10:
        raise SystemExit(f"скриншотов {len(rows)}, RuStore просит от 3 до 10")
    return rows


def write_md(shots):
    L = ["# Карточка RuStore — Space Jump\n",
         "RuStore Консоль → Приложения → Space Jump → «Карточка приложения». Рядом с полем — "
         "лимит RuStore и фактическая длина. Тексты проверяет `scripts/make_store.py`.\n",
         "Русское название с переводом — по рекомендации RuStore: с 1 марта 2026 года "
         "информация для покупателя (карточка, описание, скриншоты) должна быть на русском, "
         "а оригинальное название без зарегистрированного товарного знака лучше продублировать "
         "по-русски.\n"]
    for lang, title in (("ru", "Русский"), ("en", "English (если добавите перевод карточки)")):
        d = T[lang]
        L.append(f"---\n\n## {title}\n")
        for k, label in (("name", "Название"), ("short", "Краткое описание"),
                         ("full", "Полное описание"), ("news", "Что нового (версия 1.0.0)")):
            L.append(f"### {label} — {len(d[k])} / {LIMITS[k]}\n")
            L.append("```\n" + d[k] + "\n```\n")
    L.append("---\n\n## Остальные поля\n")
    L.append("| Поле | Что указать |\n|---|---|")
    L.append("| Тип / категория | Игра → **Аркады** (запасной вариант — Казуальные) |")
    L.append("| Возрастной рейтинг | **0+** — насилия, крови и прочего нет. При 0+ и 6+ реклама только "
             "неперсонализированная (п. 9.7 правил) — так и настроено (`ageRestricted: true`) |")
    L.append("| Иконка | `store/icon.png` — 512×512, PNG без прозрачности |")
    L.append("| Скриншоты (телефон) | `store/screenshots/mobile_1…5.png` — см. ниже |")
    L.append("| Видео | только ссылкой на VK Видео: можно загрузить `../store/ru/video_vertical.mp4` |")
    L.append("| Политика конфиденциальности | `https://lesharg.github.io/space-jump/rustore/privacy/` "
             "(откроется после пуша в GitHub; в игре — Меню → «Политика конфиденциальности») |")
    L.append("| Почта для связи | revork.coconut@gmail.com — та же, что в `privacy/index.html` |")
    L.append("| Сайт разработчика | `https://lesharg.github.io` — понадобится для app-ads.txt (см. README) |")
    L.append("| Платные функции / покупки | нет |")
    L.append("| Реклама | да — если в `app.config.json` указаны блоки РСЯ |")
    L.append("")
    L.append("## Скриншоты\n")
    L.append("Настоящие кадры забега из `store/ru/screenshots` (их снимает `store/tools/capture.mjs`). "
             "Требования RuStore: от 3 до 10, 9:16 или 16:9, до 3 МБ, без панелей Android.\n")
    L.append("| Файл | Размер | Вес |\n|---|---|---|")
    for n, w, h, size in shots:
        L.append(f"| `screenshots/{n}` | {w}×{h} | {size / 1024:.0f} КБ |")
    L.append("")
    with open(os.path.join(OUT, "texts.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(L))


def main():
    check_texts()
    shots = copy_screens()
    write_md(shots)
    for lang, d in T.items():
        print(lang, {k: len(d[k]) for k in LIMITS})
    print(f"скриншотов: {len(shots)} → rustore/store/screenshots, тексты → rustore/store/texts.md")


if __name__ == "__main__":
    main()
