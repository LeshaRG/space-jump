# Карточка RuStore — Space Jump

RuStore Консоль → Приложения → Space Jump → «Карточка приложения». Рядом с полем — лимит RuStore и фактическая длина. Тексты проверяет `scripts/make_store.py`.

Русское название с переводом — по рекомендации RuStore: с 1 марта 2026 года информация для покупателя (карточка, описание, скриншоты) должна быть на русском, а оригинальное название без зарегистрированного товарного знака лучше продублировать по-русски.

---

## Русский

### Название — 28 / 30

```
Space Jump: прыжки к звёздам
```

### Краткое описание — 59 / 80

```
Прыгай рогаткой по космическим платформам и бей свой рекорд
```

### Полное описание — 1334 / 4000

```
Космонавт стоит на планете, а над ним — бесконечная лестница из летающих платформ. Зажмите экран, оттяните назад и отпустите: герой прыгнет, как из рогатки, а гаснущий пунктир подскажет, куда он полетит.

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
• Управление одной рукой, вертикальный экран.
```

### Что нового (версия 1.0.0) — 135 / 500

```
Первая версия Space Jump для Android: прыжки рогаткой, жар ×3, бустеры, шесть скафандров и личные рекорды. Игра работает без интернета.
```

---

## English (если добавите перевод карточки)

### Название — 10 / 30

```
Space Jump
```

### Краткое описание — 53 / 80

```
Slingshot up space platforms and beat your own record
```

### Полное описание — 1307 / 4000

```
An astronaut stands on a planet, and above him rises an endless ladder of floating platforms. Hold the screen, pull back and release: the hero leaps like a stone from a slingshot, and a fading dotted line shows where he will fly.

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
• One-hand controls, portrait screen.
```

### Что нового (версия 1.0.0) — 123 / 500

```
The first Android version of Space Jump: slingshot jumps, heat ×3, boosters, six suits and personal records. Works offline.
```

---

## Остальные поля

| Поле | Что указать |
|---|---|
| Тип / категория | Игра → **Аркады** (запасной вариант — Казуальные) |
| Возрастной рейтинг | **0+** — насилия, крови и прочего нет. При 0+ и 6+ реклама только неперсонализированная (п. 9.7 правил) — так и настроено (`ageRestricted: true`) |
| Иконка | `store/icon.png` — 512×512, PNG без прозрачности |
| Скриншоты (телефон) | `store/screenshots/mobile_1…5.png` — см. ниже |
| Видео | только ссылкой на VK Видео: можно загрузить `../store/ru/video_vertical.mp4` |
| Политика конфиденциальности | `https://lesharg.github.io/space-jump/rustore/privacy/` (откроется после пуша в GitHub; в игре — Меню → «Политика конфиденциальности») |
| Почта для связи | revork.coconut@gmail.com — та же, что в `privacy/index.html` |
| Сайт разработчика | `https://lesharg.github.io` — понадобится для app-ads.txt (см. README) |
| Платные функции / покупки | нет |
| Реклама | да — если в `app.config.json` указаны блоки РСЯ |

## Скриншоты

Настоящие кадры забега из `store/ru/screenshots` (их снимает `store/tools/capture.mjs`). Требования RuStore: от 3 до 10, 9:16 или 16:9, до 3 МБ, без панелей Android.

| Файл | Размер | Вес |
|---|---|---|
| `screenshots/mobile_1.png` | 1080×1920 | 436 КБ |
| `screenshots/mobile_2.png` | 1080×1920 | 464 КБ |
| `screenshots/mobile_3.png` | 1080×1920 | 512 КБ |
| `screenshots/mobile_4.png` | 1080×1920 | 614 КБ |
| `screenshots/mobile_5.png` | 1080×1920 | 470 КБ |
