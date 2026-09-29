/**
 * icons.js — inline-SVG иконки HTML-интерфейса.
 *
 * Эмодзи в интерфейсе не используются: на Windows, Android, iOS и ТВ они
 * рисуются по-разному и ломают вертикальный ритм. Иконки монохромные и
 * наследуют цвет через currentColor — одна иконка работает на любой кнопке.
 *
 *   `<button>${icon("play")} ИГРАТЬ</button>`
 */

const SW = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

const PATHS = {
  play:    '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>',
  back:    `<path d="M11 5 4 12l7 7M4.5 12H20" ${SW}/>`,
  pause:   '<rect x="6" y="5" width="4" height="14" rx="1.2" fill="currentColor"/>'
         + '<rect x="14" y="5" width="4" height="14" rx="1.2" fill="currentColor"/>',
  restart: `<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.2v4.6h4.6" ${SW}/>`,
  close:   `<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" ${SW}/>`,

  coin:    '<circle cx="12" cy="12" r="9" fill="currentColor" opacity=".22"/>'
         + '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/>'
         + '<path d="m12 7.3 1.4 2.9 3.2.5-2.3 2.2.5 3.2-2.8-1.5-2.8 1.5.5-3.2-2.3-2.2 3.2-.5z" fill="currentColor"/>',

  ranking: `<rect x="2.5" y="12.5" width="5.5" height="8" rx="1.2" ${SW}/>`
         + '<rect x="9.25" y="6.5" width="5.5" height="14" rx="1.2" fill="currentColor"/>'
         + `<rect x="16" y="10" width="5.5" height="10.5" rx="1.2" ${SW}/>`,

  ad:      `<rect x="2.5" y="4.5" width="19" height="15" rx="3" ${SW}/>`
         + '<path d="M10 9v6l5-3z" fill="currentColor"/>',

  soundOn:  '<path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor"/>'
          + `<path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" ${SW}/>`,
  soundOff: '<path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor"/>'
          + `<path d="m16 9.5 5 5M21 9.5l-5 5" ${SW}/>`,
  musicOn:  `<path d="M9 17.5V6l10-2v11.5" ${SW}/>`
          + '<circle cx="6.5" cy="17.5" r="2.6" fill="currentColor"/><circle cx="16.5" cy="15.5" r="2.6" fill="currentColor"/>',
  musicOff: `<path d="M9 17.5V6l10-2v11.5" ${SW}/>`
          + '<circle cx="6.5" cy="17.5" r="2.6" fill="currentColor"/><circle cx="16.5" cy="15.5" r="2.6" fill="currentColor"/>'
          + `<path d="M3.5 3.5l17 17" ${SW}/>`,

  user:    `<circle cx="12" cy="8" r="4" ${SW}/><path d="M4.5 20c1-3.8 3.9-5.8 7.5-5.8s6.5 2 7.5 5.8" ${SW}/>`,
  star:    '<path d="m12 2.8 2.8 5.8 6.3.9-4.6 4.5 1.1 6.3L12 17.3l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9z" fill="currentColor"/>',
  helmet:  `<circle cx="12" cy="11" r="8" ${SW}/>`
         + '<path d="M7.3 10.5a4.7 4.2 0 0 1 9.4 0v1.3a2.2 2.2 0 0 1-2.2 2.2h-5a2.2 2.2 0 0 1-2.2-2.2z" fill="currentColor"/>'
         + `<path d="M8 20.5h8" ${SW}/>`,
  rotate:  `<rect x="7" y="2.5" width="10" height="19" rx="2.5" ${SW}/><path d="M11 18.5h2" ${SW}/>`,
  check:   `<path d="m5 12.5 4.5 4.5L19 7.5" ${SW}/>`,
  flame:   '<path d="M12 2c1 4 6 6.5 6 12a6 6 0 0 1-12 0c0-3.5 2.5-5 3.5-7.5 1 2 1.5 3 2.5 3.5.3-3-.4-5.5 0-8z" fill="currentColor"/>'
         + '<path d="M12 12.5c1.2 1.4 2.6 2.4 2.6 4.1a2.6 2.6 0 0 1-5.2 0c0-1.6 1.4-2.6 2.6-4.1z" fill="#fff" opacity=".55"/>',
  diamond: '<path d="M7 4h10l4 5-9 11L3 9z" fill="currentColor" opacity=".25"/>'
         + `<path d="M7 4h10l4 5-9 11L3 9zM3 9h18M9.5 9 12 20l2.5-11M9.5 9 12 4l2.5 5" ${SW}/>`,
  crown:   '<path d="M3.5 17.5 2.8 7.8l5 4 4.2-6.3 4.2 6.3 5-4-.7 9.7z" fill="currentColor"/>'
         + `<path d="M4 20.5h16" ${SW}/>`,
  pack:    `<rect x="3.5" y="8" width="17" height="12.5" rx="1.5" ${SW}/>`
         + `<path d="M3.5 12h17M12 8v12.5M12 8C10 4 6.5 4.5 7 7c.3 1.2 2.5 1 5 1zm0 0c2-4 5.5-3.5 5-1-.3 1.2-2.5 1-5 1z" ${SW}/>`,
  bag:     `<path d="M5 8.5h14l-1 12H6z" ${SW}/><path d="M9 8.5V7a3 3 0 0 1 6 0v1.5" ${SW}/>`,

  /* ── Бустеры ── */
  jetpack:  `<rect x="4.5" y="3.5" width="6" height="11.5" rx="3" ${SW}/>`
          + `<rect x="13.5" y="3.5" width="6" height="11.5" rx="3" ${SW}/>`
          + `<path d="M10.5 8h3" ${SW}/>`
          + '<path d="M6 16.5c0 2 1.5 3.4 1.5 5 0-1.6 1.5-3 1.5-5z" fill="currentColor"/>'
          + '<path d="M15 16.5c0 2 1.5 3.4 1.5 5 0-1.6 1.5-3 1.5-5z" fill="currentColor"/>',
  teleport: `<ellipse cx="12" cy="18.5" rx="7.5" ry="2.6" ${SW}/>`
          + `<path d="M12 14.5V3.8M8.4 7.4 12 3.8l3.6 3.6" ${SW}/>`
          + '<circle cx="5.3" cy="10" r="1.2" fill="currentColor"/><circle cx="18.7" cy="11.5" r="1.2" fill="currentColor"/>',
  aim:      '<path d="M3.5 20.5Q9.5 -1.5 16 14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-dasharray="0.1 3.6"/>'
          + `<circle cx="17.5" cy="16.5" r="3.4" ${SW}/><circle cx="17.5" cy="16.5" r="1" fill="currentColor"/>`,
  breaker:  `<rect x="3.5" y="3.5" width="9" height="17" rx="1.5" ${SW}/>`
          + `<path d="M8.5 3.5 7 8.5l3 2.5-2.5 4 1.5 5.5" ${SW}/>`
          + `<path d="M16 8.5 20 7M16.2 12h4.3M16 15.5l4 1.5" ${SW}/>`,
};

/**
 * @param {keyof PATHS} name
 * @param {string} [cls] дополнительные CSS-классы
 */
export function icon(name, cls = "") {
  const body = PATHS[name];
  if (!body) return "";
  return `<svg class="ic${cls ? " " + cls : ""}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
}

export default { icon };
