/**
 * testing.js — Android-версия (подменяет src/testing.js при сборке).
 *
 * Capacitor открывает игру с адреса https://localhost, и проверка из
 * основной версии сочла бы телефон игрока тестовым компьютером — в магазине
 * появилась бы кнопка «+10 000 монет». В приложении тестовых кнопок нет.
 */
export function isTestHost() {
  return false;
}

export default { isTestHost };
