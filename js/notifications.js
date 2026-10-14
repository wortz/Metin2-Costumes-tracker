import { DISCORD_DM_WORKER_URL } from "./settings.js";
import { auth } from "./firebase-init.js";
import { COSTUME_TYPES } from "./costumes.js";

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
// "key" (opcional) identifica o item a que a mensagem diz respeito: o Worker apaga a
// mensagem anterior com a mesma key para este destinatário e deixa só a nova.
export async function sendDiscordDM(userId, message, bot = "default", key = null) {
  if (!auth.currentUser) {
    return { ok: false, error: "Não estás autenticado." };
  }
  try {
    const idToken = await auth.currentUser.getIdToken();
    const res = await fetch(DISCORD_DM_WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken, userId, message, bot, key }),
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

// Envia a mensagem de teste pelos dois bots (trajes/pets e registos). Devolve
// { ok, error }, com o erro a indicar qual dos bots falhou.
export async function testDiscordDM(userId) {
  const [costumes, registry, bio] = await Promise.all([
    sendDiscordDM(userId, "✅ Teste do Metin2 Timers Tracker (bot dos trajes e pets) — a DM está a funcionar!"),
    sendDiscordDM(userId, "✅ Teste do Metin2 Timers Tracker (bot dos registos) — a DM está a funcionar!", "registry"),
    sendDiscordDM(userId, "✅ Teste do Metin2 Timers Tracker (bot do Biologo / 6-7) — a DM está a funcionar!", "bio"),
  ]);
  const errors = [];
  if (!costumes.ok) errors.push(`bot dos trajes: ${costumes.error}`);
  if (!registry.ok) errors.push(`bot dos registos: ${registry.error}`);
  if (!bio.ok) errors.push(`bot do Biologo / 6-7: ${bio.error}`);
  return errors.length === 0 ? { ok: true } : { ok: false, error: errors.join(" | ") };
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
export function formatDiscordEndDate(date) {
  // Mostra a hora em Portugal (PT) e na República Checa / Suíça (CZ/CH, que têm a
  // mesma hora); o fuso de cada um ajusta-se sozinho ao horário de inverno/verão.
  const part = (tz) => ({
    date: date.toLocaleString("pt-PT", { day: "2-digit", month: "2-digit", timeZone: tz }),
    time: date.toLocaleString("pt-PT", { hour: "2-digit", minute: "2-digit", timeZone: tz }),
  });
  const pt = part("Europe/Lisbon");
  const cz = part("Europe/Prague");
  // A data só se repete na segunda hora se for um dia diferente (por volta da meia-noite).
  const czText = cz.date === pt.date ? cz.time : `${cz.date}, ${cz.time}`;
  return `${pt.date}, ${pt.time} PT (${czText} CZ/CH)`;
}

// Avisa todos os destinatários do Discord de um registo de Meley/Balathor,
// através do segundo bot. Devolve os resultados de cada envio.
export function notifyRegistration(instanceLabel, registeredAt, nextAt, recipients, channel) {
  if (!recipients || recipients.length === 0) return Promise.resolve([]);
  const message = `📝 Registo de ${instanceLabel} feito - CH ${channel}.
Próximo registo possível a ${formatDiscordEndDate(nextAt)}`;
  return Promise.all(recipients.map((r) => sendDiscordDM(r.id, message, "registry")));
}

// Avisa os destinatários (3.º bot) de que um timer de Biologo / 6-7 foi entregue/
// recolhido ou teve o tempo alterado, com a hora a que já pode ser entregue/recolhido.
export function notifyBioTimer({ label, action, character, type, readyAt, changed }, recipients) {
  if (!recipients || recipients.length === 0) return Promise.resolve([]);
  const past = action === "Entregar" ? "entregue" : "recolhido";
  const first = changed ? `⏳ Tempo do ${label} (${character}) alterado.` : `⏳ ${label} (${character}) ${past}.`;
  const second = changed
    ? `Pode ser ${past} a ${formatDiscordEndDate(readyAt)}`
    : `Pode ser ${past} novamente a ${formatDiscordEndDate(readyAt)}`;
  // Substitui a mensagem anterior sobre o mesmo timer (mesma personagem e tipo).
  const key = `bio:${character.toLowerCase()}:${type}`;
  return Promise.all(recipients.map((r) => sendDiscordDM(r.id, `${first}\n${second}`, "bio", key)));
}

// 6-7 recolhido e apagado (sem novo tempo): substitui a mensagem anterior sobre este timer.
export function notifyBioCollected({ label, character, type }, recipients) {
  if (!recipients || recipients.length === 0) return Promise.resolve([]);
  const message = `📦 ${label} (${character}) recolhido.
Timer apagado.`;
  const key = `bio:${character.toLowerCase()}:${type}`;
  return Promise.all(recipients.map((r) => sendDiscordDM(r.id, message, "bio", key)));
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
  // Substitui o aviso de expiração anterior deste traje/pet (mesma key que o Worker usa).
  for (const recipient of recipients) sendDiscordDM(recipient.id, message, "default", `${kind}:${costume.id}`);
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

// As DMs do Discord de expiração (traje/pet a acabar) são enviadas SÓ pelo Worker
// (de hora a hora, mesmo com o site fechado) — assim não há duplicados quando o
// site está aberto em vários separadores ou dispositivos. Aqui só ficam as
// notificações do browser.
export function checkCostumeNotifications(costumes, computeRemaining, userSettings, kind = "costume") {
  const thresholdMs = (userSettings?.notifyThresholdDays || 1) * 24 * 60 * 60 * 1000;
  checkBrowserNotifications(costumes, computeRemaining, thresholdMs, kind);
}
