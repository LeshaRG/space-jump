# Тексты для карточки игры — Space Jump

Консоль разработчика → игра → «Описание и продвижение». У каждого языка своя
вкладка: **Русский** и **English**. Рядом с полем — лимит консоли и фактическая длина.
Переключатель «Хочу подключить AI-описания» можно выключить: тексты написаны вручную.

---

## Вкладка «Русский»

### Название * — 10 / 50

```
Space Jump
```

### Описание для SEO — 137 / 50–160

```
Space Jump — космический прыгун: оттяни рогатку, прыгай по платформам вверх, отскакивай от стен, облетай чёрные дыры и собирай скафандры.
```

### Об игре * — 849 / 100–1000

```
Космонавт стоит на планете, а над ним — бесконечная лестница из летающих платформ. Зажмите экран, оттяните назад и отпустите: герой прыгнет, как из рогатки, а гаснущий пунктир подскажет, куда он полетит.

Отскакивайте от стен, чтобы попасть в узкие «карманы». Монеты и алмазы лежат только на сложных платформах — маленьких, ломающихся или спрятанных за стенкой, — и у каждой есть надёжная пара: встанете на неё, и сложная исчезнет.

Прыгайте без пауз, и жар разгонит множитель очков до ×3. Мешают метеориты, ракетные турели и чёрные дыры, которые затягивают траекторию. Выручат бустеры: джетпак, телепорт, точный прицел и разрушитель стен.

Каждые 200 очков приносят монеты, и чем выше вы забрались, тем щедрее выплаты, а выше личного рекорда они удваиваются. Тратьте монеты на бустеры и скафандры — от классического до премиального демона с рогами.
```

### Короткое описание — 57 / 70

```
Прыгай рогаткой по платформам к звёздам и бей свой рекорд
```

### Как играть * — 784 / 100–1000

```
УПРАВЛЕНИЕ
Зажмите экран или кнопку мыши, оттяните назад и отпустите — космонавт прыгнет в противоположную сторону. Чем сильнее натяжение, тем дальше прыжок. Пунктир показывает начало траектории.

ЦЕЛЬ
Забраться как можно выше. Очки дают за высоту, сложные платформы и рикошеты. Упали за нижний край экрана или попали в центр чёрной дыры — забег окончен.

СОВЕТЫ
• Отскакивайте от стен — так проще попасть в «карманы» с монетами.
• Прыгайте не позже чем через 3 секунды после приземления: копится жар, и очки умножаются на 2, а потом на 3.
• Метеорит и ракета сбивают героя и гасят жар — следите за красными предупреждениями.
• «Точный прицел» покажет весь путь до приземления, «Телепорт» перенесёт на любую платформу на экране.
• Выше своего рекорда монеты за очки начисляются вдвое.
```

### Ключевые слова — 77 / 100 (раздел «Метаданные»)

```
космос, прыжки, платформы, рогатка, космонавт, рикошет, рекорд, скины, аркада
```

---

## Вкладка «English»

### Название * — 10 / 50

```
Space Jump
```

### Описание для SEO — 148 / 50–160

```
Space Jump is a space jumper: pull back the slingshot, leap up floating platforms, bounce off walls, fly around black holes and collect space suits.
```

### Об игре * — 893 / 100–1000

```
An astronaut stands on a planet, and above him rises an endless ladder of floating platforms. Hold the screen, pull back and release: the hero leaps like a stone from a slingshot, and a fading dotted line shows where he will fly.

Bounce off the walls to reach narrow pockets. Coins and diamonds lie only on tricky platforms — tiny, crumbling or hidden behind a wall — and each one has a safe twin: land on the safe one and the tricky one disappears.

Jump without pauses and the heat pushes your score multiplier up to ×3. Meteors, rocket turrets and black holes that bend your path get in the way. Boosters help out: a jetpack, a teleport, a precise aim and a wall breaker.

Every 200 points pays out coins, the higher you climb the bigger the payouts, and above your personal best they are doubled. Spend coins on boosters and space suits — from the classic one to the premium horned demon.
```

### Короткое описание — 53 / 70

```
Slingshot up space platforms and beat your own record
```

### Как играть * — 777 / 100–1000

```
CONTROLS
Hold the screen or the mouse button, pull back and release — the astronaut jumps the opposite way. The harder you pull, the farther he flies. The dotted line shows the start of the path.

GOAL
Climb as high as you can. Points come for height, tricky platforms and ricochets. Fall below the screen or into the core of a black hole and the run is over.

TIPS
• Bounce off the walls — it is the easiest way into the coin pockets.
• Jump within 3 seconds after landing to build heat: your score is multiplied by 2, then by 3.
• A meteor or a rocket knocks the hero away and puts out the heat — watch the red warnings.
• Precise aim shows the whole path to the landing spot, Teleport moves you to any platform on screen.
• Above your personal best, score coins are doubled.
```

### Ключевые слова — 77 / 100 (раздел «Метаданные»)

```
space, jump, platforms, slingshot, astronaut, ricochet, record, skins, arcade
```

---

## Комментарий разработчика — 1171 / 2048

Раздел «Общее» → «Дополнительные параметры». Его читают только модераторы,
поэтому он один, на русском.

```
SDK Яндекс Игр: YaGames.init() вызывается сразу после загрузки /sdk.js, до движка. LoadingAPI.ready() — когда на экране меню. GameplayAPI.start()/stop() размечают забег: геймплей останавливается на паузе, в окнах магазина, во время рекламы и при скрытой вкладке. События game_api_pause и game_api_resume ставят игру и звук на паузу.

Сохранения: player.setData с дублированием в localStorage — прогресс сохраняется и у гостей, вход только по кнопке «Войти». Лидерборд «score» — для авторизованных игроков. Язык определяется через environment.i18n.lang (русский и английский).

Реклама только через SDK. Полноэкранная — на экране конца забега, не на каждой смерти и не чаще раза в 60 секунд. Видео за вознаграждение — только по кнопке: продолжить забег, получить бустер, монеты в магазине, удвоить монеты забега. Награда — дополнительный бонус: начать заново можно всегда и без рекламы. Покупок за реальные деньги нет, внутренняя валюта зарабатывается в игре.

Звук: отдельные переключатели музыки и звуков в меню и на паузе; при потере фокуса звук выключается. Управление: касание или мышь, одной рукой. Ориентация портретная, на компьютере игровое поле по центру экрана.
```
