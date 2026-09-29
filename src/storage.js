/**
 * storage.js — безопасный доступ к localStorage.
 *
 * Игра на Яндекс Играх открывается в iframe со стороннего домена. Если у
 * пользователя отключены сторонние cookie и хранилища (Safari по умолчанию,
 * Chrome с блокировкой сторонних данных, инкогнито), любое обращение к
 * localStorage — даже чтение — бросает SecurityError. Незащищённый вызов
 * при загрузке не дал бы дойти до LoadingAPI.ready(), и модерация увидела
 * бы это как «SDK не встроено или встроено некорректно».
 */

let warned = false;

function unavailable(e) {
  if (!warned) {
    warned = true;
    console.warn("[storage] localStorage недоступен, играем без локального кеша:", e.message);
  }
}

export function getItem(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    unavailable(e);
    return null;
  }
}

export function setItem(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    unavailable(e);
    return false;
  }
}

export default { getItem, setItem };
