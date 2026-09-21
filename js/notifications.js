const NOTIFIED_KEY = "metin2-costumes-notified";

function getNotifiedSet() {
  try {
    return new Set(JSON.parse(localStorage.getItem(NOTIFIED_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function saveNotifiedSet(set) {
  localStorage.setItem(NOTIFIED_KEY, JSON.stringify([...set]));
}

export function requestNotificationPermission() {
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") {
    Notification.requestPermission();
  }
}

// Verifica a lista de trajes e dispara uma notificação (uma vez por traje) quando
// o tempo restante entra na janela definida por notifyDaysBefore.
export function checkCostumeNotifications(costumes, computeRemaining) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const notified = getNotifiedSet();
  let changed = false;

  for (const costume of costumes) {
    const remaining = computeRemaining(costume.endAt);
    const thresholdMs = (costume.notifyDaysBefore || 0) * 24 * 60 * 60 * 1000;
    const withinWindow = !remaining.expired && remaining.totalMs <= thresholdMs && thresholdMs > 0;

    if (withinWindow && !notified.has(costume.id)) {
      new Notification("Traje prestes a expirar", {
        body: `${costume.character} — ${costume.description || "traje"} termina em ${remaining.days}d ${remaining.hours}h ${remaining.minutes}m`,
        tag: costume.id,
      });
      notified.add(costume.id);
      changed = true;
    }

    if (remaining.expired && notified.has(costume.id)) {
      notified.delete(costume.id);
      changed = true;
    }
  }

  if (changed) saveNotifiedSet(notified);
}
