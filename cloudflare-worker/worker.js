// Cloudflare Worker que:
//  1. (fetch) recebe pedidos da app para enviar uma DM de teste, autenticando
//     quem pede através do próprio token de login do Firebase.
//  2. (scheduled) corre sozinho de hora a hora, lê todos os trajes de todos os
//     utilizadores diretamente do Firestore, e envia DMs a quem estiver perto
//     de expirar — mesmo com o site fechado.
//
// O token do bot NUNCA chega ao browser — fica só aqui, guardado como secret.
//
// Variáveis a configurar no Worker:
//   DISCORD_BOT_TOKEN      (secret) -> o token do bot do Discord
//   DISCORD_REGISTRY_BOT_TOKEN (secret) -> token do 2.º bot (avisos de registo Meley/Balathor)
//   DISCORD_BIO_BOT_TOKEN  (secret) -> token do 3.º bot (timers de Biologo / 6-7)
//   FIREBASE_PROJECT_ID    (var)    -> o project id do Firebase (ex: "costumes-tracker")
//   FIREBASE_CLIENT_EMAIL  (secret) -> "client_email" da chave de conta de serviço
//   FIREBASE_PRIVATE_KEY   (secret) -> "private_key" da chave de conta de serviço
//
// Ver cloudflare-worker/README.md para os passos completos.

import { createRemoteJWKSet, jwtVerify, SignJWT, importPKCS8 } from "jose";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// ---------- Envio de DMs no Discord (partilhado pelo fetch e pelo scheduled) ----------
async function sendDiscordDM(env, discordUserId, message, botKey = "default", tracking = null) {
  // Os registos de Meley/Balathor usam um segundo bot, para as mensagens
  // aparecerem separadas das de expiração de trajes/pets.
  const tokenNames = { default: "DISCORD_BOT_TOKEN", registry: "DISCORD_REGISTRY_BOT_TOKEN", bio: "DISCORD_BIO_BOT_TOKEN" };
  const tokenName = tokenNames[botKey] || tokenNames.default;
  const token = env[tokenName];
  if (!token) {
    throw new Error(`Bot não configurado (${tokenName}).`);
  }
  const dmRes = await fetch("https://discord.com/api/v10/users/@me/channels", {
    method: "POST",
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ recipient_id: discordUserId }),
  });
  if (!dmRes.ok) {
    throw new Error(`Falha ao abrir DM: ${await dmRes.text()}`);
  }
  const channel = await dmRes.json();

  const msgRes = await fetch(`https://discord.com/api/v10/channels/${channel.id}/messages`, {
    method: "POST",
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ content: message }),
  });
  if (!msgRes.ok) {
    throw new Error(`Falha ao enviar mensagem: ${await msgRes.text()}`);
  }

  // Se a mensagem está "associada" a um item (traje, pet, timer de Biologo / 6-7),
  // apaga a mensagem anterior sobre o mesmo item para este destinatário e guarda
  // a nova — assim fica sempre só a mais recente. Uma falha aqui nunca impede
  // o envio (a mensagem nova já foi enviada).
  if (tracking) {
    try {
      const sent = await msgRes.json();
      await replacePreviousMessage(token, tracking, botKey, discordUserId, { channelId: sent.channel_id || channel.id, messageId: sent.id });
    } catch (err) {
      console.error("Falha a substituir a mensagem anterior:", err.message);
    }
  }
}

// ---------- Mensagens "substituíveis": guarda a última mensagem enviada por item ----------
// Guardado no Firestore (coleção discordMessages, só acessível ao Worker): um registo por
// (conta, bot, destinatário, item) com o canal e o ID da última mensagem.
function trackingDocId(ownerUid, botKey, recipientId, key) {
  // IDs de documentos do Firestore não podem ter "/" — o resto do texto é preservado.
  const safeKey = key.replace(/[^A-Za-z0-9_-]/g, (c) => `~${c.charCodeAt(0).toString(16)}~`);
  return `${ownerUid}__${botKey}__${recipientId}__${safeKey}`;
}

async function replacePreviousMessage(token, tracking, botKey, recipientId, current) {
  const { accessToken, projectId, ownerUid, key } = tracking;
  const docId = trackingDocId(ownerUid, botKey, recipientId, key);
  const docUrl = `${firestoreBaseUrl(projectId)}/discordMessages/${docId}`;

  let previous = null;
  const getRes = await fetch(docUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (getRes.ok) {
    const fields = fromFirestoreFields((await getRes.json()).fields);
    if (fields.channelId && fields.messageId) previous = fields;
  } else if (getRes.status !== 404) {
    console.error(`Substituição: falha a ler o registo (${getRes.status}): ${await getRes.text()}`);
  }

  if (previous && previous.messageId !== current.messageId) {
    // Se já foi apagada (por exemplo, pela limpeza diária) o Discord devolve 404 — sem problema.
    const delRes = await fetch(`https://discord.com/api/v10/channels/${previous.channelId}/messages/${previous.messageId}`, {
      method: "DELETE",
      headers: { Authorization: `Bot ${token}` },
    });
    if (!delRes.ok && delRes.status !== 404) {
      console.error(`Substituição: falha a apagar a mensagem anterior (${delRes.status}): ${await delRes.text()}`);
    }
  }

  const saveRes = await fetch(docUrl, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      fields: {
        ownerUid: toFirestoreValue(ownerUid),
        channelId: toFirestoreValue(current.channelId),
        messageId: toFirestoreValue(current.messageId),
        sentAt: toFirestoreValue(new Date()),
      },
    }),
  });
  if (!saveRes.ok) {
    console.error(`Substituição: falha a guardar o registo (${saveRes.status}): ${await saveRes.text()}`);
  }
}

// ---------- Verificação do login Firebase (usado pelo pedido de teste) ----------
const FIREBASE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com")
);

async function verifyFirebaseIdToken(idToken, projectId) {
  const { payload } = await jwtVerify(idToken, FIREBASE_JWKS, {
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
  });
  if (!payload.sub) {
    throw new Error("Token sem utilizador.");
  }
  return payload;
}

// ---------- Acesso ao Firestore com credenciais de serviço (Admin) ----------
// O token da Google dura 1 hora: guarda-se em memória para não pedir um novo a cada
// execução (poupa pedidos externos, que têm limite por execução).
let cachedGoogleToken = null;

async function getGoogleAccessToken(env) {
  if (cachedGoogleToken && cachedGoogleToken.expiresAt - Date.now() > 5 * 60 * 1000) {
    return cachedGoogleToken.token;
  }
  const privateKeyPem = env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n");
  const privateKey = await importPKCS8(privateKeyPem, "RS256");
  const now = Math.floor(Date.now() / 1000);

  const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/datastore" })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(env.FIREBASE_CLIENT_EMAIL)
    .setSubject(env.FIREBASE_CLIENT_EMAIL)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    throw new Error(`Falha ao autenticar com a Google: ${await res.text()}`);
  }
  const data = await res.json();
  cachedGoogleToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
  return data.access_token;
}

function fromFirestoreValue(value) {
  if (!value) return null;
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.integerValue !== undefined) return Number(value.integerValue);
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.booleanValue !== undefined) return value.booleanValue;
  if (value.timestampValue !== undefined) return new Date(value.timestampValue);
  if (value.nullValue !== undefined) return null;
  if (value.mapValue !== undefined) return fromFirestoreFields(value.mapValue.fields || {});
  if (value.arrayValue !== undefined) return (value.arrayValue.values || []).map(fromFirestoreValue);
  return null;
}

function fromFirestoreFields(fields) {
  const obj = {};
  for (const [key, value] of Object.entries(fields || {})) {
    obj[key] = fromFirestoreValue(value);
  }
  return obj;
}

function toFirestoreValue(value) {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  return { nullValue: null };
}

function firestoreBaseUrl(projectId) {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
}

async function listAllCostumes(accessToken, projectId, collectionId = "costumes") {
  const res = await fetch(`${firestoreBaseUrl(projectId)}:runQuery`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId }] } }),
  });
  if (!res.ok) {
    throw new Error(`Falha ao ler ${collectionId}: ${await res.text()}`);
  }
  const rows = await res.json();
  return rows
    .filter((row) => row.document)
    .map((row) => ({
      id: row.document.name.split("/").pop(),
      _updateTime: row.document.updateTime,
      ...fromFirestoreFields(row.document.fields),
    }));
}

async function getUserSettingsDoc(accessToken, projectId, uid) {
  const res = await fetch(`${firestoreBaseUrl(projectId)}/userSettings/${uid}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Falha ao ler userSettings/${uid}: ${await res.text()}`);
  }
  const docBody = await res.json();
  return fromFirestoreFields(docBody.fields);
}

// Atualiza campos do documento. Se for passado updateTime, a escrita só acontece se o
// documento ainda não mudou desde que foi lido — é assim que se "reserva" um aviso
// de forma atómica: se outra pessoa/aba/Worker já o reservou, a escrita falha e
// devolve false (e quem perdeu não envia a mensagem, evitando duplicados).
async function patchCostume(accessToken, projectId, costumeId, updates, collectionId = "costumes", updateTime = null) {
  const mask = Object.keys(updates)
    .map((key) => `updateMask.fieldPaths=${key}`)
    .join("&");
  const fields = {};
  for (const [key, value] of Object.entries(updates)) {
    fields[key] = toFirestoreValue(value);
  }
  const precondition = updateTime ? `&currentDocument.updateTime=${encodeURIComponent(updateTime)}` : "";
  const res = await fetch(`${firestoreBaseUrl(projectId)}/${collectionId}/${costumeId}?${mask}${precondition}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    const body = await res.text();
    if (updateTime && [400, 409, 412].includes(res.status) && /FAILED_PRECONDITION|ABORTED/.test(body)) return false;
    throw new Error(`Falha ao atualizar ${collectionId}/${costumeId}: ${body}`);
  }
  return true;
}

const COSTUME_TYPES = {
  body: "Corpo",
  weapon: "Arma",
  head: "Cabeça",
};

// Formata a data/hora fixa em hora de Portugal (Europe/Lisbon) — este Worker
// corre em UTC por padrão, por isso é preciso fixar o fuso explicitamente para
// não ficar 1h atrasado em horário de verão. Ajusta-se sozinho ao
// inverno/verão, tal como o mesmo helper no cliente (js/notifications.js).
function formatEndDate(date) {
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

// Mesmo formato usado pelo cliente (js/notifications.js), para as mensagens
// ficarem iguais quer disparem pelo browser quer por este Worker sozinho.
function discordAlertMessage(costume, stage, remainingMs, endAt) {
  const prefix = stage === "12h" ? "🚨 ALERTA IMPORTANTE" : "⚠️ AVISO";
  const label = costume._kind === "pet" ? "Pet" : `Traje de ${COSTUME_TYPES[costume.type] || costume.type}`;
  const descPart = costume.description ? ` (${costume.description})` : "";
  const hours = Math.floor(remainingMs / (60 * 60 * 1000));
  return `${prefix}: ${label} do personagem ${costume.character}${descPart} a terminar em ${hours} horas - ${formatEndDate(endAt)}`;
}

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

// Aceita a lista atual (com nome), ou os formatos antigos (de antes de haver
// vários destinatários): uma lista simples de IDs, ou um único ID.
function getRecipients(settings) {
  if (!settings) return [];
  if (Array.isArray(settings.discordRecipients)) {
    return settings.discordRecipients.filter((r) => r && r.id);
  }
  if (Array.isArray(settings.discordUserIds)) {
    return settings.discordUserIds.filter(Boolean).map((id) => ({ name: "", id }));
  }
  if (settings.discordUserId) {
    return [{ name: "", id: settings.discordUserId }];
  }
  return [];
}

// Verifica todos os trajes e pets de todos os utilizadores e envia, no máximo, 2 DMs
// (a cada destinatário configurado) por traje: uma ao limiar definido pelo
// utilizador, outra às 12h ou menos. Devolve um resumo (usado pela rota
// /debug-sweep para diagnóstico).
async function runNotificationSweep(env) {
  const accessToken = await getGoogleAccessToken(env);
  const projectId = env.FIREBASE_PROJECT_ID;
  // Trajes e pets seguem exatamente as mesmas regras de aviso.
  const [costumeDocs, petDocs] = await Promise.all([
    listAllCostumes(accessToken, projectId, "costumes"),
    listAllCostumes(accessToken, projectId, "pets"),
  ]);
  const costumes = [
    ...costumeDocs.map((c) => ({ ...c, _kind: "costume" })),
    ...petDocs.map((p) => ({ ...p, _kind: "pet" })),
  ];
  const settingsCache = new Map();
  const summary = { totalCostumes: costumes.length, sent: [], skipped: [], errors: [] };
  // Pedidos externos disponíveis nesta execução (cada envio com substituição gasta ~5 por
  // destinatário). O que não couber fica por avisar e é feito na execução seguinte.
  const budget = { left: 30 };
  let processed = 0;

  for (const costume of costumes) {
    if (!costume.endAt || !costume.ownerUid) {
      summary.skipped.push({ id: costume.id, reason: "sem endAt/ownerUid" });
      continue;
    }
    const endAt = costume.endAt instanceof Date ? costume.endAt : new Date(costume.endAt);
    const remainingMs = endAt.getTime() - Date.now();
    if (remainingMs <= 0) {
      summary.skipped.push({ id: costume.id, reason: "expirado" });
      continue;
    }

    if (!settingsCache.has(costume.ownerUid)) {
      budget.left -= 1;
      try {
        settingsCache.set(costume.ownerUid, await getUserSettingsDoc(accessToken, projectId, costume.ownerUid));
      } catch (err) {
        console.error(err);
        settingsCache.set(costume.ownerUid, null);
      }
    }
    const settings = settingsCache.get(costume.ownerUid);
    const recipients = getRecipients(settings);
    if (recipients.length === 0) {
      summary.skipped.push({ id: costume.id, reason: "sem destinatários", ownerUid: costume.ownerUid });
      continue;
    }

    const thresholdMs = (settings.notifyThresholdDays || 1) * 24 * 60 * 60 * 1000;
    const remainingHours = Math.round(remainingMs / (60 * 60 * 1000));

    // Se um traje já nascer com menos de 12h (salta logo o limiar do utilizador),
    // só manda o mais urgente (o "ALERTA IMPORTANTE"), não os dois de uma vez.
    let stage = null;
    const updates = {};
    if (remainingMs <= TWELVE_HOURS_MS && !costume.notified12h) {
      stage = "12h";
      updates.notified12h = true;
      if (!costume.notifiedThreshold) updates.notifiedThreshold = true;
    } else if (remainingMs <= thresholdMs && !costume.notifiedThreshold) {
      stage = "threshold";
      updates.notifiedThreshold = true;
    }

    if (!stage) {
      summary.skipped.push({
        id: costume.id,
        reason: costume.notifiedThreshold || costume.notified12h ? "já notificado" : "ainda fora do limiar",
        remainingHours,
        thresholdHours: thresholdMs / 3600000,
      });
      continue;
    }

    const needed = 1 + recipients.length * 5;
    // O primeiro aviso é sempre enviado (mesmo com muitos destinatários); os seguintes só se couberem.
    if (needed > budget.left && processed > 0) {
      summary.skipped.push({ id: costume.id, reason: "limite de pedidos desta execução; fica para a próxima" });
      continue;
    }
    budget.left -= needed;
    processed++;

    // Reserva o aviso ANTES de enviar: se o site (ou outra execução) o reservou entretanto,
    // a escrita falha e não se envia — assim nunca há mensagens duplicadas.
    let claimed;
    try {
      claimed = await patchCostume(
        accessToken,
        projectId,
        costume.id,
        updates,
        costume._kind === "pet" ? "pets" : "costumes",
        costume._updateTime
      );
    } catch (err) {
      summary.errors.push({ id: costume.id, stage: "patch", error: err.message });
      continue;
    }
    if (!claimed) {
      summary.skipped.push({ id: costume.id, reason: "já reservado por outro" });
      continue;
    }

    const message = discordAlertMessage(costume, stage, remainingMs, endAt);
    const failures = [];
    // A mensagem nova substitui a anterior sobre este mesmo traje/pet (key = tipo + id).
    const tracking = { accessToken, projectId, ownerUid: costume.ownerUid, key: `${costume._kind}:${costume.id}` };
    for (const recipient of recipients) {
      try {
        await sendDiscordDM(env, recipient.id, message, "default", tracking);
      } catch (err) {
        failures.push(err.message);
      }
    }
    if (failures.length > 0) summary.errors.push({ id: costume.id, stage, error: failures.join("; ") });
    summary.sent.push({ id: costume.id, stage, remainingHours, recipients: recipients.length - failures.length });
  }

  return summary;
}

// ---------- Timers de Biologo / 6-7: aviso quando já podem ser entregues/recolhidos ----------
const BIO_TYPES = {
  bio18: { label: "Biologo 1-8", infinitive: "entregue" },
  jewels: { label: "Joias", infinitive: "entregue" },
  sixseven: { label: "6-7", infinitive: "recolhido" },
};

// Corre a cada 5 minutos: para cada timer que já terminou e ainda não foi avisado,
// manda "✅ ... já pode ser entregue/recolhido!" e marca readyNotified (a app volta
// a pôr isto a false quando o tempo é alterado ou o timer recomeça).
async function runBioReadyCheck(env, budgetLeft = 40) {
  const accessToken = await getGoogleAccessToken(env);
  const projectId = env.FIREBASE_PROJECT_ID;
  const timers = await listAllCostumes(accessToken, projectId, "bioTimers");
  const settingsCache = new Map();
  // Pedidos externos disponíveis nesta execução (o limite é 50; nas execuções em que corre
  // também o varrimento de trajes/pets ou a limpeza, este valor é mais pequeno). O que não
  // couber é avisado 5 minutos depois — mas o primeiro aviso de cada execução é sempre
  // enviado, mesmo que precise de mais, para nunca ficar preso por ter muitos destinatários.
  const budget = { left: budgetLeft };
  let processed = 0;

  for (const timer of timers) {
    if (!timer.endAt || !timer.ownerUid || timer.readyNotified) continue;
    const endAt = timer.endAt instanceof Date ? timer.endAt : new Date(timer.endAt);
    if (endAt.getTime() > Date.now()) continue;

    const type = BIO_TYPES[timer.type];
    if (!type) continue;

    if (!settingsCache.has(timer.ownerUid)) {
      budget.left -= 1;
      try {
        settingsCache.set(timer.ownerUid, await getUserSettingsDoc(accessToken, projectId, timer.ownerUid));
      } catch (err) {
        console.error(err);
        settingsCache.set(timer.ownerUid, null);
      }
    }
    const recipients = getRecipients(settingsCache.get(timer.ownerUid));

    const needed = 1 + recipients.length * 5;
    if (needed > budget.left && processed > 0) continue; // fica para a próxima execução (5 minutos depois)
    budget.left -= needed;
    processed++;

    // Reserva o aviso antes de enviar (se o timer mudou entretanto, não envia).
    try {
      const claimed = await patchCostume(accessToken, projectId, timer.id, { readyNotified: true }, "bioTimers", timer._updateTime);
      if (!claimed) continue;
    } catch (err) {
      console.error(err.message);
      continue;
    }

    const message = `✅ ${type.label} (${timer.character}) já pode ser ${type.infinitive}!`;
    // Substitui a mensagem anterior sobre este mesmo timer (mesma personagem e tipo).
    const tracking = {
      accessToken,
      projectId,
      ownerUid: timer.ownerUid,
      key: `bio:${String(timer.character).toLowerCase()}:${timer.type}`,
    };
    for (const recipient of recipients) {
      try {
        await sendDiscordDM(env, recipient.id, message, "bio", tracking);
      } catch (err) {
        console.error(err.message);
      }
    }
  }
}

// ---------- Limpeza diária das mensagens dos bots ----------
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function discordHeaders(token) {
  return { Authorization: `Bot ${token}`, "Content-Type": "application/json" };
}

// Pedido ao Discord que repete uma vez se bater no limite de pedidos (429).
// Cada execução do Worker só pode fazer um número limitado de pedidos externos
// (50 no plano gratuito), por isso a limpeza usa um "orçamento" (budget) e pára
// quando acaba — o resto fica para a execução seguinte.
class OutOfBudgetError extends Error {}

async function discordFetch(url, options, budget) {
  const spend = () => {
    if (budget) {
      if (budget.left <= 0) throw new OutOfBudgetError("Limite de pedidos por execução atingido.");
      budget.left--;
    }
  };
  spend();
  let res = await fetch(url, options);
  if (res.status === 429) {
    const data = await res.json().catch(() => ({}));
    await new Promise((resolve) => setTimeout(resolve, Math.ceil((data.retry_after || 1) * 1000) + 100));
    spend();
    res = await fetch(url, options);
  }
  return res;
}

// Apaga, na DM de cada destinatário, as mensagens enviadas por ESTE bot há mais
// de 24 horas (as mensagens de outras pessoas nunca são tocadas).
async function deleteOldBotMessages(token, recipientIds, budget) {
  const meRes = await discordFetch("https://discord.com/api/v10/users/@me", { headers: discordHeaders(token) }, budget);
  if (!meRes.ok) throw new Error(`Falha ao identificar o bot: ${await meRes.text()}`);
  const botId = (await meRes.json()).id;
  let deleted = 0;

  for (const userId of recipientIds) {
    const chRes = await discordFetch("https://discord.com/api/v10/users/@me/channels", {
      method: "POST",
      headers: discordHeaders(token),
      body: JSON.stringify({ recipient_id: userId }),
    }, budget);
    if (!chRes.ok) {
      console.error(`Limpeza: não consegui abrir a DM de ${userId}: ${chRes.status} ${await chRes.text()}`);
      continue;
    }
    const channel = await chRes.json();

    let before = null;
    for (let page = 0; page < 5; page++) {
      const url = `https://discord.com/api/v10/channels/${channel.id}/messages?limit=100${before ? `&before=${before}` : ""}`;
      const msgRes = await discordFetch(url, { headers: discordHeaders(token) }, budget);
      if (!msgRes.ok) {
        console.error(`Limpeza: não consegui ler as mensagens da DM de ${userId}: ${msgRes.status} ${await msgRes.text()}`);
        break;
      }
      const messages = await msgRes.json();
      if (messages.length === 0) break;

      for (const msg of messages) {
        if (msg.author?.id !== botId) continue;
        if (Date.now() - new Date(msg.timestamp).getTime() < ONE_DAY_MS) continue;
        const delRes = await discordFetch(`https://discord.com/api/v10/channels/${channel.id}/messages/${msg.id}`, {
          method: "DELETE",
          headers: discordHeaders(token),
        }, budget);
        if (delRes.ok) deleted++;
        else console.error(`Limpeza: falhou a apagar a mensagem ${msg.id}: ${delRes.status} ${await delRes.text()}`);
      }
      before = messages[messages.length - 1].id;
      if (messages.length < 100) break;
    }
  }
  return deleted;
}

async function cleanupBotMessages(env) {
  // Orçamento de pedidos ao Discord nesta execução (o resto é feito na próxima).
  const budget = { left: 28 };
  const accessToken = await getGoogleAccessToken(env);
  const settingsDocs = await listAllCostumes(accessToken, env.FIREBASE_PROJECT_ID, "userSettings");
  const recipientIds = [...new Set(settingsDocs.flatMap((doc) => getRecipients(doc).map((r) => r.id)))];
  if (recipientIds.length === 0) return;

  for (const token of [env.DISCORD_BOT_TOKEN, env.DISCORD_REGISTRY_BOT_TOKEN, env.DISCORD_BIO_BOT_TOKEN]) {
    if (!token) continue;
    try {
      const deleted = await deleteOldBotMessages(token, recipientIds, budget);
      console.log(`Limpeza: ${deleted} mensagens apagadas.`);
    } catch (err) {
      if (err instanceof OutOfBudgetError) {
        console.log("Limpeza: limite de pedidos atingido, continua na próxima execução.");
        return;
      }
      console.error("Falha na limpeza de mensagens:", err);
    }
  }
}

// A limpeza só corre durante a hora da meia-noite em Portugal (ajusta-se sozinho
// a inverno/verão), em várias execuções seguidas: cada uma apaga um lote e a
// seguinte continua, por causa do limite de pedidos por execução.
function isLisbonMidnight(date) {
  const hour = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: "Europe/Lisbon" }).format(date);
  return Number(hour) === 0;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }
    if (request.method !== "POST") {
      return json(405, { error: "Método não permitido." });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json(400, { error: "JSON inválido." });
    }

    if (!body.idToken) {
      return json(401, { error: "Sem sessão (idToken em falta)." });
    }

    let payload;
    try {
      payload = await verifyFirebaseIdToken(body.idToken, env.FIREBASE_PROJECT_ID);
    } catch (err) {
      return json(401, { error: `Sessão inválida: ${err.message}` });
    }

    if (!body.userId || !body.message) {
      return json(400, { error: "Falta userId ou message." });
    }

    try {
      // "key" (opcional) identifica o item da mensagem; a anterior com a mesma key é apagada.
      // A conta é a do token verificado, por isso cada pessoa só mexe nas suas mensagens.
      let tracking = null;
      if (typeof body.key === "string" && body.key && body.key.length <= 200) {
        tracking = {
          accessToken: await getGoogleAccessToken(env),
          projectId: env.FIREBASE_PROJECT_ID,
          ownerUid: payload.sub,
          key: body.key,
        };
      }
      await sendDiscordDM(env, body.userId, body.message, ["registry", "bio"].includes(body.bot) ? body.bot : "default", tracking);
    } catch (err) {
      return json(502, { error: err.message });
    }

    return json(200, { ok: true });
  },

  async scheduled(event, env, ctx) {
    // O cron corre a cada 5 minutos: os timers de Biologo / 6-7 verificam-se sempre;
    // o resto (trajes, pets e limpeza) só na execução do minuto 0 de cada hora.
    const scheduled = new Date(event.scheduledTime);
    // Orçamento de pedidos do Biologo / 6-7 conforme o que mais corre nesta execução.
    const bioBudget = scheduled.getUTCMinutes() === 0 ? 12 : isLisbonMidnight(scheduled) ? 16 : 40;
    ctx.waitUntil(runBioReadyCheck(env, bioBudget).catch((err) => console.error("Falha na verificação dos timers:", err)));
    if (scheduled.getUTCMinutes() === 0) {
      ctx.waitUntil(runNotificationSweep(env).catch((err) => console.error("Falha na verificação agendada:", err)));
    } else if (isLisbonMidnight(scheduled)) {
      // Fora do minuto 0 para não competir com a verificação de trajes/pets pelo
      // limite de pedidos da mesma execução.
      ctx.waitUntil(cleanupBotMessages(env).catch((err) => console.error("Falha na limpeza diária:", err)));
    }
  },
};
