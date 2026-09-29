/**
 * audio.js — звук.
 *
 * Каждый эффект — слот с именем (jump, land, coin, ...). Если в assets/sounds
 * лежит файл с таким именем (jump.mp3 и т. п.), играет файл; иначе — короткая
 * синтезированная заглушка через WebAudio. Музыка — только файлом
 * assets/sounds/music.ogg (+ music.wav для Safari, где OGG не играет:
 * MP3 не годится — на стыке цикла у него слышна пауза).
 *
 * Звук глушится при паузе платформы и уходе со вкладки (п. 1.3): контекст
 * WebAudio приостанавливается целиком, вместе с синтезатором.
 */
import CONFIG from "./config.js";

const Audio = {
  _game:   null,
  _ctx:    null,
  _out:    null,     // общий gain синтезатора
  _noise:  null,     // буфер белого шума
  _files:  new Set(),
  _loops:  new Map(),
  _music:  null,
  _muted:  false,
  _paused: false,

  /** @param {Phaser.Game} game  @param {object} sounds — список файлов из манифеста */
  init(game, sounds = {}) {
    this._game = game;
    this._files = new Set(Object.keys(sounds));
    const ctx = game.sound?.context;
    if (ctx && !this._ctx) {
      this._ctx = ctx;
      this._out = ctx.createGain();
      this._out.gain.value = this._muted ? 0 : CONFIG.AUDIO.SFX;
      this._out.connect(ctx.destination);
      const len = ctx.sampleRate;
      this._noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this._noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
  },

  /* ═══════ Эффекты ═══════ */

  play(name) {
    if (this._muted || this._paused || !this._game) return;
    if (this._files.has(name)) {
      this._game.sound.play(name, { volume: CONFIG.AUDIO.SFX });
      return;
    }
    const synth = SYNTH[name];
    if (synth && this._ctx && this._ctx.state === "running") {
      try { synth(this, this._ctx.currentTime); } catch (e) { console.warn(`[audio] ${name}:`, e.message); }
    }
  },

  /** Имена всех эффектов — для отладки и README. */
  names() { return Object.keys(SYNTH); },

  /** Зацикленный звук (джетпак). on=false — плавно выключить. */
  loop(name, on) {
    if (!this._ctx && !this._files.has(name)) return;
    const cur = this._loops.get(name);
    if (on && !cur) {
      if (this._files.has(name)) {
        const snd = this._game.sound.add(name, { loop: true, volume: this._muted ? 0 : CONFIG.AUDIO.SFX });
        snd.play();
        this._loops.set(name, { stop: () => { snd.stop(); snd.destroy(); } });
      } else if (LOOPS[name]) {
        this._loops.set(name, LOOPS[name](this));
      }
    } else if (!on && cur) {
      cur.stop();
      this._loops.delete(name);
    }
  },

  stopLoops() {
    for (const name of [...this._loops.keys()]) this.loop(name, false);
  },

  /* ═══════ Музыка ═══════ */

  /**
   * Фоновая музыка — файл assets/sounds/music.* (зацикленный). До первого
   * касания браузер звук не даёт: тогда музыка стартует сразу после него.
   */
  music(on) {
    if (!this._files.has("music") || !this._game) return;
    const snd = this._game.sound;
    if (on && !this._music) {
      if (snd.locked) {
        if (!this._musicWait) {
          this._musicWait = true;
          snd.once(Phaser.Sound.Events.UNLOCKED, () => { this._musicWait = false; this.music(true); });
        }
        return;
      }
      this._music = snd.add("music", { loop: true, volume: this._muted ? 0 : CONFIG.AUDIO.MUSIC });
      this._music.play();
      if (this._paused) this._music.pause();
    } else if (!on && this._music) {
      this._music.stop();
      this._music.destroy();
      this._music = null;
    }
  },

  /* ═══════ Громкость и пауза ═══════ */

  setMuted(m) {
    this._muted = !!m;
    if (this._out) this._out.gain.value = this._muted ? 0 : CONFIG.AUDIO.SFX;
    if (this._game) this._game.sound.mute = this._muted;
    if (this._music) this._music.setVolume(this._muted ? 0 : CONFIG.AUDIO.MUSIC);
  },

  isMuted() { return this._muted; },

  /** Пауза платформы / скрытая вкладка / реклама: тишина целиком. */
  pause() {
    this._paused = true;
    this._game?.sound.pauseAll();
    try { this._ctx?.suspend(); } catch {}
  },

  resume() {
    this._paused = false;
    if (document.hidden) return;
    try { this._ctx?.resume(); } catch {}
    this._game?.sound.resumeAll();
  },

  /* ═══════ Кирпичики синтезатора ═══════ */

  tone(t, { type = "sine", f0, f1 = 0, dur, vol = 0.2, attack = 0.004, delay = 0 }) {
    const ctx = this._ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const t0 = t + delay;
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this._out);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  },

  noise(t, { dur, vol = 0.2, f0 = 1000, f1 = 0, q = 0.8, type = "bandpass", delay = 0 }) {
    const ctx = this._ctx;
    const src = ctx.createBufferSource();
    const flt = ctx.createBiquadFilter();
    const g = ctx.createGain();
    const t0 = t + delay;
    src.buffer = this._noise;
    flt.type = type;
    flt.Q.value = q;
    flt.frequency.setValueAtTime(f0, t0);
    if (f1) flt.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(flt).connect(g).connect(this._out);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.05);
  },
};

/** Заглушки эффектов: несколько осцилляторов и шум, 0.05–0.9 с. */
const SYNTH = {
  jump:     (a, t) => { a.tone(t, { type: "square", f0: 260, f1: 620, dur: 0.14, vol: 0.07 });
                        a.tone(t, { type: "triangle", f0: 520, f1: 1240, dur: 0.12, vol: 0.05 }); },
  land:     (a, t) => { a.tone(t, { f0: 170, f1: 70, dur: 0.12, vol: 0.22 });
                        a.noise(t, { dur: 0.07, vol: 0.08, f0: 900, type: "lowpass" }); },
  bounce:   (a, t) => { a.tone(t, { type: "triangle", f0: 1250, f1: 880, dur: 0.12, vol: 0.09 });
                        a.tone(t, { f0: 1870, dur: 0.07, vol: 0.04 }); },
  coin:     (a, t) => { a.tone(t, { type: "square", f0: 988, dur: 0.07, vol: 0.05 });
                        a.tone(t, { type: "square", f0: 1319, dur: 0.2, vol: 0.05, delay: 0.07 }); },
  pickup:   (a, t) => { [660, 880, 1320].forEach((f, i) => a.tone(t, { type: "triangle", f0: f, dur: 0.1, vol: 0.08, delay: i * 0.06 })); },
  crack:    (a, t) => { a.noise(t, { dur: 0.09, vol: 0.14, f0: 1800, q: 2 }); },
  break:    (a, t) => { a.noise(t, { dur: 0.4, vol: 0.2, f0: 1400, f1: 180, type: "lowpass" }); },
  explode:  (a, t) => { a.noise(t, { dur: 0.55, vol: 0.28, f0: 2200, f1: 90, type: "lowpass" });
                        a.tone(t, { f0: 95, f1: 38, dur: 0.45, vol: 0.25 }); },
  hit:      (a, t) => { a.tone(t, { type: "sawtooth", f0: 420, f1: 120, dur: 0.22, vol: 0.08 });
                        a.noise(t, { dur: 0.08, vol: 0.12, f0: 1200 }); },
  fall:     (a, t) => { a.tone(t, { type: "triangle", f0: 760, f1: 140, dur: 0.9, vol: 0.08 }); },
  death:    (a, t) => { a.tone(t, { type: "triangle", f0: 440, f1: 55, dur: 0.8, vol: 0.12 });
                        a.noise(t, { dur: 0.5, vol: 0.08, f0: 600, f1: 120, type: "lowpass" }); },
  teleport: (a, t) => { a.tone(t, { f0: 300, f1: 1800, dur: 0.32, vol: 0.08 });
                        a.tone(t, { f0: 450, f1: 2700, dur: 0.32, vol: 0.04 }); },
  vanish:   (a, t) => { a.tone(t, { f0: 900, f1: 280, dur: 0.25, vol: 0.06 }); },
  warn:     (a, t) => { a.tone(t, { type: "square", f0: 880, dur: 0.08, vol: 0.05 });
                        a.tone(t, { type: "square", f0: 880, dur: 0.08, vol: 0.05, delay: 0.14 }); },
  lock:     (a, t) => { a.tone(t, { type: "square", f0: 1400, dur: 0.05, vol: 0.04 }); },
  launch:   (a, t) => { a.noise(t, { dur: 0.3, vol: 0.12, f0: 500, f1: 3000, type: "highpass" }); },
  swallow:  (a, t) => { a.tone(t, { f0: 220, f1: 30, dur: 1.2, vol: 0.18 }); },
  record:   (a, t) => { [523, 659, 784, 1047].forEach((f, i) => a.tone(t, { type: "triangle", f0: f, dur: 0.14, vol: 0.07, delay: i * 0.08 })); },
  click:    (a, t) => { a.tone(t, { type: "triangle", f0: 700, f1: 900, dur: 0.05, vol: 0.05 }); },
  diamond:  (a, t) => { [1319, 1760, 2637, 3520].forEach((f, i) => a.tone(t, { type: "triangle", f0: f, dur: 0.16, vol: 0.06, delay: i * 0.045 })); },
  energy:   (a, t) => { a.tone(t, { type: "triangle", f0: 520, f1: 880, dur: 0.1, vol: 0.06 }); },
  hotUp:    (a, t) => { a.noise(t, { dur: 0.45, vol: 0.12, f0: 300, f1: 2400, type: "bandpass" });
                        [392, 523, 659, 784].forEach((f, i) => a.tone(t, { type: "sawtooth", f0: f, dur: 0.22, vol: 0.035, delay: 0.05 + i * 0.05 })); },
  hotLost:  (a, t) => { a.noise(t, { dur: 0.4, vol: 0.1, f0: 2600, f1: 200, type: "lowpass" });
                        a.tone(t, { type: "triangle", f0: 520, f1: 180, dur: 0.35, vol: 0.06 }); },
  cash:     (a, t) => { a.tone(t, { type: "square", f0: 1568, dur: 0.06, vol: 0.04 });
                        a.tone(t, { type: "square", f0: 2093, dur: 0.18, vol: 0.04, delay: 0.06 });
                        a.noise(t, { dur: 0.05, vol: 0.05, f0: 6000, type: "highpass" }); },
  x2:       (a, t) => { [523, 784, 1047, 1568].forEach((f, i) => a.tone(t, { type: "square", f0: f, dur: 0.12, vol: 0.045, delay: i * 0.07 })); },
  buy:      (a, t) => { a.tone(t, { type: "triangle", f0: 880, dur: 0.07, vol: 0.06 });
                        a.tone(t, { type: "triangle", f0: 1320, dur: 0.16, vol: 0.06, delay: 0.07 }); },
};

/** Зацикленные заглушки: возвращают объект с stop(). */
const LOOPS = {
  jet(a) {
    const ctx = a._ctx;
    const src = ctx.createBufferSource();
    const flt = ctx.createBiquadFilter();
    const g = ctx.createGain();
    src.buffer = a._noise;
    src.loop = true;
    flt.type = "bandpass";
    flt.frequency.value = 520;
    flt.Q.value = 0.7;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 0.15);
    src.connect(flt).connect(g).connect(a._out);
    src.start();
    return {
      stop() {
        const t = ctx.currentTime;
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
        src.stop(t + 0.3);
      },
    };
  },
};

export default Audio;
