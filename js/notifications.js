import { DISCORD_DM_WORKER_URL } from "./settings.js";
import { auth } from "./firebase-init.js";
import { markCostumeNotified, COSTUME_TYPES } from "./costumes.js";

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
const REPEAT_SETTING_KEY = "metin2-costumes-notify-repeat";
const BROWSER_NOTIFIED_KEY = "metin2-costumes-browser-notified-hours";

// Preferência local (só afeta as notificações do browser, não as DMs): repetir
// o aviso a cada hora enquanto o traje estiver dentro do limiar, ou só uma vez.
export function getNotifyRepeatSetting() {
  return localStorage.getItem(REPEAT_SETTING_KEY) === "true";
}
export function setNotifyRepeatSetting(value) {
  localStorage.setItem(REPEAT_SETTING_KEY, value ? "true" : "false");
}

function getBrowserNotifiedState() {
  try {
    return JSON.parse(localStorage.getItem(BROWSER_NOTIFIED_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveBrowserNotifiedState(state) {
  localStorage.setItem(BROWSER_NOTIFIED_KEY, JSON.stringify(state));
}

export function requestNotificationPermission() {
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") {
    Notification.requestPermission();
  }
}

// Envia uma DM no Discord através do Cloudflare Worker (que fala com o bot).
// Autentica-se com o próprio token de login do Firebase do utilizador atual —
// não há nenhum segredo para partilhar/colar, o Worker confia em quem já está
// autenticado nesta app. Devolve { ok, error } em vez de lançar, para a UI
// poder mostrar o motivo da falha.
export async function sendDiscordDM(userId, message) {
  if (!auth.currentUser) {
    return { ok: false, error: "Não estás autenticado." };
  }
  try {
    const idToken = await auth.currentUser.getIdToken();
    const res = await fetch(DISCORD_DM_WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken, userId, message }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: data.error || `Erro ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || "Erro de rede." };
  }
}

export function testDiscordDM(userId) {
  return sendDiscordDM(userId, "✅ Teste do Metin2 Costumes Tracker — a DM está a funcionar!");
}

// "Traje de Corpo" / "Pet" — o começo da frase nas mensagens.
function itemLabel(item, kind) {
  if (kind === "pet") return "Pet";
  return `Traje de ${COSTUME_TYPES[item.type] || item.type}`;
}

function alertBody(costume, remaining, kind) {
  return `${costume.character} — ${costume.description || (kind === "pet" ? "pet" : "traje")} termina em ${remaining.days}d ${remaining.hours}h ${remaining.minutes}m`;
}

// Formata a data/hora fixa em hora de Portugal (Europe/Lisbon), independente
// do fuso horário de quem/onde corre o código (browser do utilizador, ou o
// Worker que corre em UTC) — ajusta-se sozinho ao horário de inverno/verão.
function formatDiscordEndDate(date) {
  const datePart = date.toLocaleString("pt-PT", { day: "2-digit", month: "2-digit", timeZone: "Europe/Lisbon" });
  const timePart = date.toLocaleString("pt-PT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Lisbon" });
  return `${datePart}, ${timePart} PT`;
}

// Mensagem para o Discord, no formato pedido: "AVISO: Traje de X do personagem
// Y (descrição) a terminar em Z horas - DD/MM, HH:MM PT" (ou "ALERTA
// IMPORTANTE" nas 12h).
function discordAlertMessage(costume, stage, remaining, kind) {
  const prefix = stage === "12h" ? "🚨 ALERTA IMPORTANTE" : "⚠️ AVISO";
  const descPart = costume.description ? ` (${costume.description})` : "";
  const hours = Math.floor(remaining.totalMs / (60 * 60 * 1000));
  return `${prefix}: ${itemLabel(costume, kind)} do personagem ${costume.character}${descPart} a terminar em ${hours} horas - ${formatDiscordEndDate(remaining.endDate)}`;
}

// Avisa todos os destinatários do Discord de que um traje foi renovado, com o
// novo tempo de duração e a nova data de fim. Só avisa se o traje já tinha
// disparado algum aviso no Discord (ou seja, se as pessoas já sabiam que
// estava a acabar) — senão não há nada a "resolver" e não manda nada.
export function notifyCostumeRenewed(costume, { daysLeft, hoursLeft, minutesLeft }, recipients, kind = "costume") {
  if (!recipients || recipients.length === 0 || !auth.currentUser) return;
  if (!costume.notifiedThreshold && !costume.notified12h) return;
  const days = Number(daysLeft) || 0;
  const hours = Number(hoursLeft) || 0;
  const minutes = Number(minutesLeft) || 0;
  const endDate = new Date(Date.now() + ((days * 24 + hours) * 60 + minutes) * 60 * 1000);
  const descPart = costume.description ? ` (${costume.description})` : "";
  const message = `✅ ${itemLabel(costume, kind)} do personagem ${costume.character}${descPart} renovado - novo tempo: ${days}d ${hours}h ${minutes}m - ${formatDiscordEndDate(endDate)}`;
  for (const recipient of recipients) sendDiscordDM(recipient.id, message);
}

// Notificações do browser: um único limiar (definido pelo utilizador), que
// repete a cada hora cheia enquanto a preferência "repetir" estiver ligada, ou
// dispara só uma vez caso contrário. Estado guardado no browser (não precisa
// de sobreviver ao site fechado, ao contrário das DMs).
function checkBrowserNotifications(costumes, computeRemaining, thresholdMs, kind) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const repeatHourly = getNotifyRepeatSetting();
  const state = getBrowserNotifiedState();
  let changed = false;

  for (const costume of costumes) {
    const remaining = computeRemaining(costume.endAt);
    const withinWindow = !remaining.expired && remaining.totalMs <= thresholdMs;

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
      new Notification(kind === "pet" ? "Pet prestes a expirar" : "Traje prestes a expirar", {
        body: alertBody(costume, remaining, kind),
        tag: costume.id,
      });
      state[costume.id] = hoursRemaining;
      changed = true;
    }
  }

  if (changed) saveBrowserNotifiedState(state);
}

// DM no Discord: no máximo 2 avisos por traje — ao limiar do utilizador e às
// 12h ou menos — independentemente da preferência de repetição. Se um traje já
// nascer com menos de 12h (salta logo o limiar), só manda o mais urgente (o
// "ALERTA IMPORTANTE"), não os dois de uma vez. Manda a todos os destinatários
// configurados. Estado guardado no próprio traje (Firestore), partilhado com
// o Worker que corre em fundo.
function checkDiscordDMs(costumes, computeRemaining, thresholdMs, recipients, kind) {
  if (!recipients || recipients.length === 0 || !auth.currentUser) return;

  for (const costume of costumes) {
    const remaining = computeRemaining(costume.endAt);
    if (remaining.expired) continue;

    if (remaining.totalMs <= TWELVE_HOURS_MS && !costume.notified12h) {
      const message = discordAlertMessage(costume, "12h", remaining, kind);
      for (const recipient of recipients) sendDiscordDM(recipient.id, message);
      markCostumeNotified(costume.id, "12h", kind);
      if (!costume.notifiedThreshold) markCostumeNotified(costume.id, "threshold", kind);
    } else if (remaining.totalMs <= thresholdMs && !costume.notifiedThreshold) {
      const message = discordAlertMessage(costume, "threshold", remaining, kind);
      for (const recipient of recipients) sendDiscordDM(recipient.id, message);
      markCostumeNotified(costume.id, "threshold", kind);
    }
  }
}

export function checkCostumeNotifications(costumes, computeRemaining, userSettings, kind = "costume") {
  const thresholdMs = (userSettings?.notifyThresholdDays || 1) * 24 * 60 * 60 * 1000;
  checkBrowserNotifications(costumes, computeRemaining, thresholdMs, kind);
  checkDiscordDMs(costumes, computeRemaining, thresholdMs, userSettings?.discordRecipients, kind);
}
