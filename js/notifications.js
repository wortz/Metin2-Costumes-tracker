const NOTIFIED_KEY = "metin2-costumes-notified-hours";
const REPEAT_SETTING_KEY = "metin2-costumes-notify-repeat";

// Preferência global do utilizador: avisar a cada hora (true) ou só uma vez (false).
export function getNotifyRepeatSetting() {
  const value = localStorage.getItem(REPEAT_SETTING_KEY);
  return value === null ? true : value === "true";
}

export function setNotifyRepeatSetting(value) {
  localStorage.setItem(REPEAT_SETTING_KEY, value ? "true" : "false");
}

// Guarda, por traje, a última "hora restante" em que já se notificou.
function getNotifiedState() {
  try {
    return JSON.parse(localStorage.getItem(NOTIFIED_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveNotifiedState(state) {
  localStorage.setItem(NOTIFIED_KEY, JSON.stringify(state));
}

// Remove um traje do registo de notificações (usado ao renovar, para que
// volte a notificar quando entrar de novo na janela de aviso).
export function clearNotified(costumeId) {
  const state = getNotifiedState();
  if (costumeId in state) {
    delete state[costumeId];
    saveNotifiedState(state);
  }
}

export function requestNotificationPermission() {
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") {
    Notification.requestPermission();
  }
}

// Verifica a lista de trajes e dispara uma notificação sempre que o tempo restante
// (dentro da janela definida por notifyDaysBefore) descer para uma nova hora cheia,
// ex: notifyDaysBefore=1 avisa às 24h, 23h, 22h... restantes, até ser renovado ou expirar.
export function checkCostumeNotifications(costumes, computeRemaining) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const state = getNotifiedState();
  const repeatHourly = getNotifyRepeatSetting();
  let changed = false;

  for (const costume of costumes) {
    const remaining = computeRemaining(costume.endAt);
    const thresholdMs = (costume.notifyDaysBefore || 0) * 24 * 60 * 60 * 1000;
    const withinWindow = !remaining.expired && thresholdMs > 0 && remaining.totalMs <= thresholdMs;

    if (!withinWindow) {
      if (costume.id in state) {
        delete state[costume.id];
        changed = true;
      }
      continue;
    }

    const hoursRemaining = Math.floor(remaining.totalMs / (60 * 60 * 1000));
    const lastNotifiedHour = state[costume.id];

    const shouldNotify = lastNotifiedHour === undefined || (repeatHourly && hoursRemaining < lastNotifiedHour);

    if (shouldNotify) {
      new Notification("Traje prestes a expirar", {
        body: `${costume.character} — ${costume.description || "traje"} termina em ${remaining.days}d ${remaining.hours}h ${remaining.minutes}m`,
        tag: costume.id,
      });
      state[costume.id] = hoursRemaining;
      changed = true;
    }
  }

  if (changed) saveNotifiedState(state);
}
