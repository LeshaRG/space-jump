/**
 * Bubble — облако реплики над головой героя (HTML, следует за ним каждый кадр).
 * Прижимается к краям экрана, хвостик при этом продолжает смотреть на героя.
 */
export default class Bubble {
  constructor() {
    const el = document.createElement("div");
    el.className = "bubble";
    el.innerHTML = '<span class="bubble-text"></span><i class="bubble-tail"></i>';
    document.body.appendChild(el);
    this.el = el;
    this.$text = el.querySelector(".bubble-text");
    this.$tail = el.querySelector(".bubble-tail");
    this.t = 0;
    this.w = 0;
    this.h = 0;
  }

  /** Показать реплику. dur — сколько секунд висит (по умолчанию — по длине текста). */
  say(text, dur) {
    this.$text.textContent = text;
    this.el.classList.remove("show");
    void this.el.offsetWidth;          // перезапуск анимации появления
    this.el.classList.add("show");
    this.w = this.el.offsetWidth;
    this.h = this.el.offsetHeight;
    this.t = dur ?? Math.min(4.5, 1.6 + text.length * 0.05);
  }

  hide() {
    this.t = 0;
    this.el.classList.remove("show");
  }

  /** x, y — точка над головой героя в CSS-пикселях. */
  update(dt, x, y, screenW) {
    if (this.t <= 0) return;
    this.t -= dt;
    if (this.t <= 0) {
      this.el.classList.remove("show");
      return;
    }
    const left = Math.max(8, Math.min(x - this.w / 2, screenW - this.w - 8));
    const top = Math.max(8, y - this.h - 12);
    this.el.style.transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px)`;
    this.$tail.style.left = `${Math.max(14, Math.min(this.w - 14, x - left)).toFixed(1)}px`;
  }

  destroy() {
    this.el.remove();
  }
}
