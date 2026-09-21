// Preferências do utilizador (guardadas no browser) para os limiares de tempo
// usados nos avisos: notificação do browser, aviso amarelo e alerta vermelho.
const KEYS = {
  notifyDays: "metin2-costumes-threshold-notify",
  warningDays: "metin2-costumes-threshold-warning",
  alertDays: "metin2-costumes-threshold-alert",
};

const DEFAULTS = {
  notifyDays: 1,
  warningDays: 3,
  alertDays: 1,
};

function getDays(key, fallback) {
  const raw = localStorage.getItem(key);
  const value = Number(raw);
  return raw !== null && Number.isFinite(value) && value > 0 ? value : fallback;
}

function setDays(key, value) {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) {
    localStorage.setItem(key, String(n));
  }
}

export function getNotifyThresholdDays() {
  return getDays(KEYS.notifyDays, DEFAULTS.notifyDays);
}
export function setNotifyThresholdDays(days) {
  setDays(KEYS.notifyDays, days);
}

export function getWarningThresholdDays() {
  return getDays(KEYS.warningDays, DEFAULTS.warningDays);
}
export function setWarningThresholdDays(days) {
  setDays(KEYS.warningDays, days);
}

export function getAlertThresholdDays() {
  return getDays(KEYS.alertDays, DEFAULTS.alertDays);
}
export function setAlertThresholdDays(days) {
  setDays(KEYS.alertDays, days);
}
