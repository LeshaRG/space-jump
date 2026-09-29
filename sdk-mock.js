/**
 * sdk-mock.js — заглушка Yandex Games SDK для локальной проверки интеграции.
 *
 * На платформе /sdk.js отдаёт Яндекс. Локально dev-server подставляет этот
 * мок: он повторяет используемую часть API и пишет каждый вызов в консоль и
 * в window.__sdkCalls. Так видно ровно то, что проверяет модерация: вызван
 * ли YaGames.init(), сработал ли LoadingAPI.ready(), правильно ли размечен
 * геймплей через GameplayAPI.start/stop.
 *
 * Пауза платформы проверяется из консоли:  __sdkMock.pause() / __sdkMock.resume()
 *
 * В архив игры файл не попадает.
 */
(function () {
  const calls = [];
  const listeners = {};
  const log = (name, arg) => {
    calls.push(arg === undefined ? name : `${name}:${arg}`);
    console.log("%c[sdk-mock]", "color:#46dcff", name, arg ?? "");
  };
  window.__sdkCalls = calls;

  const player = {
    _data: null,
    isAuthorized: () => false,
    getName: () => "",
    getUniqueID: () => "mock-user",
    getData: async function () { log("player.getData"); return this._data ?? {}; },
    setData: async function (data) { log("player.setData"); this._data = data; },
  };

  const emit = name => (listeners[name] || []).forEach(fn => fn());

  window.__sdkMock = {
    pause:  () => { log("→ game_api_pause"); emit("game_api_pause"); },
    resume: () => { log("→ game_api_resume"); emit("game_api_resume"); },
  };

  window.YaGames = {
    init: async function () {
      log("YaGames.init");
      return {
        environment: { i18n: { lang: new URLSearchParams(location.search).get("lang") || "ru" } },
        deviceInfo:  { type: "desktop" },
        EVENTS: { ACCOUNT_SELECTION_DIALOG_OPENED: "ASD_OPENED", ACCOUNT_SELECTION_DIALOG_CLOSED: "ASD_CLOSED" },

        features: {
          LoadingAPI:  { ready: () => log("LoadingAPI.ready") },
          GameplayAPI: {
            start: () => log("GameplayAPI.start"),
            stop:  () => log("GameplayAPI.stop"),
          },
        },

        on:  (event, fn) => { (listeners[event] = listeners[event] || []).push(fn); log("on", event); },
        off: () => {},

        getPlayer: async () => { log("getPlayer"); return player; },
        auth: { openAuthDialog: async () => { log("auth.openAuthDialog"); throw new Error("mock"); } },

        adv: {
          showFullscreenAdv: ({ callbacks }) => {
            log("adv.showFullscreenAdv");
            emit("game_api_pause");
            setTimeout(() => { callbacks?.onClose?.(true); emit("game_api_resume"); }, 400);
          },
          showRewardedVideo: ({ callbacks }) => {
            log("adv.showRewardedVideo");
            emit("game_api_pause");
            setTimeout(() => { callbacks?.onRewarded?.(); callbacks?.onClose?.(true); emit("game_api_resume"); }, 400);
          },
        },

        leaderboards: {
          setScore:       async (n, s) => log("leaderboards.setScore", s),
          getEntries:     async () => ({ entries: [] }),
          getPlayerEntry: async () => { throw new Error("LEADERBOARD_PLAYER_NOT_PRESENT"); },
        },
      };
    },
  };
})();
