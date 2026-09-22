// Preferências do utilizador guardadas no Firestore (não no browser), para
// ficarem sincronizadas entre dispositivos e para o Cloudflare Worker as
// conseguir ler e enviar DMs mesmo com o site fechado.
import { doc, getDoc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db } from "./firebase-init.js";

export const DEFAULT_USER_SETTINGS = {
  discordRecipients: [], // [{ name, id }]
  notifyThresholdDays: 1,
  warningThresholdDays: 3,
  alertThresholdDays: 1,
};

function positiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function cleanRecipients(list) {
  const seen = new Set();
  const result = [];
  for (const r of list || []) {
    const id = String(r?.id || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push({ name: String(r?.name || "").trim(), id });
  }
  return result;
}

// Aceita a lista atual (com nome), ou os formatos antigos (de antes desta
// funcionalidade existir): uma lista simples de IDs, ou um único ID.
function normalizeDiscordRecipients(data) {
  if (Array.isArray(data?.discordRecipients)) {
    return cleanRecipients(data.discordRecipients);
  }
  if (Array.isArray(data?.discordUserIds)) {
    return cleanRecipients(data.discordUserIds.map((id) => ({ name: "", id })));
  }
  if (data?.discordUserId) {
    return cleanRecipients([{ name: "", id: data.discordUserId }]);
  }
  return [];
}

function normalize(data) {
  return {
    discordRecipients: normalizeDiscordRecipients(data),
    notifyThresholdDays: positiveNumber(data?.notifyThresholdDays, DEFAULT_USER_SETTINGS.notifyThresholdDays),
    warningThresholdDays: positiveNumber(data?.warningThresholdDays, DEFAULT_USER_SETTINGS.warningThresholdDays),
    alertThresholdDays: positiveNumber(data?.alertThresholdDays, DEFAULT_USER_SETTINGS.alertThresholdDays),
  };
}

export async function getUserSettings(uid) {
  const snap = await getDoc(doc(db, "userSettings", uid));
  return normalize(snap.exists() ? snap.data() : null);
}

export function saveUserSettings(uid, { discordRecipients, notifyThresholdDays, warningThresholdDays, alertThresholdDays }) {
  return setDoc(
    doc(db, "userSettings", uid),
    {
      discordRecipients: cleanRecipients(discordRecipients),
      discordUserIds: null,
      discordUserId: null,
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
