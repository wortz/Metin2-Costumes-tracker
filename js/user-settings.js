// Preferências do utilizador guardadas no Firestore (não no browser), para
// ficarem sincronizadas entre dispositivos e para o Cloudflare Worker as
// conseguir ler e enviar DMs mesmo com o site fechado.
import { doc, getDoc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db } from "./firebase-init.js";

export const DEFAULT_USER_SETTINGS = {
  discordUserId: "",
  notifyThresholdDays: 1,
  warningThresholdDays: 3,
  alertThresholdDays: 1,
};

function positiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function normalize(data) {
  return {
    discordUserId: data?.discordUserId || "",
    notifyThresholdDays: positiveNumber(data?.notifyThresholdDays, DEFAULT_USER_SETTINGS.notifyThresholdDays),
    warningThresholdDays: positiveNumber(data?.warningThresholdDays, DEFAULT_USER_SETTINGS.warningThresholdDays),
    alertThresholdDays: positiveNumber(data?.alertThresholdDays, DEFAULT_USER_SETTINGS.alertThresholdDays),
  };
}

export async function getUserSettings(uid) {
  const snap = await getDoc(doc(db, "userSettings", uid));
  return normalize(snap.exists() ? snap.data() : null);
}

export function saveUserSettings(uid, { discordUserId, notifyThresholdDays, warningThresholdDays, alertThresholdDays }) {
  return setDoc(
    doc(db, "userSettings", uid),
    {
      discordUserId: (discordUserId || "").trim(),
      notifyThresholdDays: positiveNumber(notifyThresholdDays, DEFAULT_USER_SETTINGS.notifyThresholdDays),
      warningThresholdDays: positiveNumber(warningThresholdDays, DEFAULT_USER_SETTINGS.warningThresholdDays),
      alertThresholdDays: positiveNumber(alertThresholdDays, DEFAULT_USER_SETTINGS.alertThresholdDays),
    },
    { merge: true }
  );
}

export function subscribeToUserSettings(uid, onChange) {
  return onSnapshot(doc(db, "userSettings", uid), (snap) => {
    onChange(normalize(snap.exists() ? snap.data() : null));
  });
}
