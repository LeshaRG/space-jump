/**
 * Tutorial — анимированная подсказка первого прыжка: «палец» зажимает экран
 * рядом с героем, оттягивает вниз-влево и отпускает. Текст подсказки говорит
 * сам герой в облаке. Показывается, пока игрок ни разу не прыгнул.
 */
export default class Tutorial {
  constructor() {
    const el = document.createElement("div");
    el.className = "tutorial";
    el.innerHTML = `<div class="tut-finger"><span class="tut-ring"></span><span class="tut-dot"></span></div>`;
    document.body.appendChild(el);
    this.el = el;
    this.visible = false;
  }

  show() {
    this.visible = true;
    this.el.classList.add("show");
  }

  hide() {
    this.visible = false;
    this.el.classList.remove("show");
  }

  /** Точка — ноги героя в CSS-пикселях. */
  update(p) {
    if (!this.visible) return;
    this.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
  }

  destroy() {
    this.el.remove();
  }
}
