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
async function sendDiscordDM(env, discordUserId, message) {
  const dmRes = await fetch("https://discord.com/api/v10/users/@me/channels", {
    method: "POST",
    headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ recipient_id: discordUserId }),
  });
  if (!dmRes.ok) {
    throw new Error(`Falha ao abrir DM: ${await dmRes.text()}`);
  }
  const channel = await dmRes.json();

  const msgRes = await fetch(`https://discord.com/api/v10/channels/${channel.id}/messages`, {
    method: "POST",
    headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ content: message }),
  });
  if (!msgRes.ok) {
    throw new Error(`Falha ao enviar mensagem: ${await msgRes.text()}`);
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
async function getGoogleAccessToken(env) {
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

async function listAllCostumes(accessToken, projectId) {
  const res = await fetch(`${firestoreBaseUrl(projectId)}:runQuery`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: "costumes" }] } }),
  });
  if (!res.ok) {
    throw new Error(`Falha ao ler trajes: ${await res.text()}`);
  }
  const rows = await res.json();
  return rows
    .filter((row) => row.document)
    .map((row) => ({ id: row.document.name.split("/").pop(), ...fromFirestoreFields(row.document.fields) }));
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

async function patchCostume(accessToken, projectId, costumeId, updates) {
  const mask = Object.keys(updates)
    .map((key) => `updateMask.fieldPaths=${key}`)
    .join("&");
  const fields = {};
  for (const [key, value] of Object.entries(updates)) {
    fields[key] = toFirestoreValue(value);
  }
  const res = await fetch(`${firestoreBaseUrl(projectId)}/costumes/${costumeId}?${mask}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    throw new Error(`Falha ao atualizar traje ${costumeId}: ${await res.text()}`);
  }
}

const COSTUME_TYPES = {
  body: "Corpo",
  weapon: "Arma",
  head: "Cabeça",
};

function formatEndDate(endAt) {
  return endAt.toLocaleString("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Mesmo formato usado pelo cliente (js/notifications.js), para as mensagens
// ficarem iguais quer disparem pelo browser quer por este Worker sozinho.
function discordAlertMessage(costume, stage, remainingMs, endAt) {
  const prefix = stage === "12h" ? "🚨 ALERTA IMPORTANTE" : "⚠️ AVISO";
  const typeLabel = COSTUME_TYPES[costume.type] || costume.type;
  const descPart = costume.description ? ` (${costume.description})` : "";
  const hours = Math.floor(remainingMs / (60 * 60 * 1000));
  return `${prefix}: Traje de ${typeLabel} do personagem ${costume.character}${descPart} a terminar em ${hours} horas - ${formatEndDate(endAt)}`;
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

// Verifica todos os trajes de todos os utilizadores e envia, no máximo, 2 DMs
// (a cada destinatário configurado) por traje: uma ao limiar definido pelo
// utilizador, outra às 12h ou menos. Devolve um resumo (usado pela rota
// /debug-sweep para diagnóstico).
async function runNotificationSweep(env) {
  const accessToken = await getGoogleAccessToken(env);
  const projectId = env.FIREBASE_PROJECT_ID;
  const costumes = await listAllCostumes(accessToken, projectId);
  const settingsCache = new Map();
  const summary = { totalCostumes: costumes.length, sent: [], skipped: [], errors: [] };

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
    const updates = {};
    const remainingHours = Math.round(remainingMs / (60 * 60 * 1000));

    // Se um traje já nascer com menos de 12h (salta logo o limiar do utilizador),
    // só manda o mais urgente (o "ALERTA IMPORTANTE"), não os dois de uma vez.
    if (remainingMs <= TWELVE_HOURS_MS && !costume.notified12h) {
      const message = discordAlertMessage(costume, "12h", remainingMs, endAt);
      const failures = [];
      for (const recipient of recipients) {
        try {
          await sendDiscordDM(env, recipient.id, message);
        } catch (err) {
          failures.push(err.message);
        }
      }
      updates.notified12h = true;
      if (!costume.notifiedThreshold) updates.notifiedThreshold = true;
      if (failures.length > 0) summary.errors.push({ id: costume.id, stage: "12h", error: failures.join("; ") });
      summary.sent.push({ id: costume.id, stage: "12h", remainingHours, recipients: recipients.length - failures.length });
    } else if (remainingMs <= thresholdMs && !costume.notifiedThreshold) {
      const message = discordAlertMessage(costume, "threshold", remainingMs, endAt);
      const failures = [];
      for (const recipient of recipients) {
        try {
          await sendDiscordDM(env, recipient.id, message);
        } catch (err) {
          failures.push(err.message);
        }
      }
      updates.notifiedThreshold = true;
      if (failures.length > 0) summary.errors.push({ id: costume.id, stage: "threshold", error: failures.join("; ") });
      summary.sent.push({ id: costume.id, stage: "threshold", remainingHours, recipients: recipients.length - failures.length });
    } else {
      summary.skipped.push({
        id: costume.id,
        reason: costume.notifiedThreshold || costume.notified12h ? "já notificado" : "ainda fora do limiar",
        remainingHours,
        thresholdHours: thresholdMs / 3600000,
      });
    }

    if (Object.keys(updates).length > 0) {
      try {
        await patchCostume(accessToken, projectId, costume.id, updates);
      } catch (err) {
        summary.errors.push({ id: costume.id, stage: "patch", error: err.message });
      }
    }
  }

  return summary;
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

    try {
      await verifyFirebaseIdToken(body.idToken, env.FIREBASE_PROJECT_ID);
    } catch (err) {
      return json(401, { error: `Sessão inválida: ${err.message}` });
    }

    if (!body.userId || !body.message) {
      return json(400, { error: "Falta userId ou message." });
    }

    try {
      await sendDiscordDM(env, body.userId, body.message);
    } catch (err) {
      return json(502, { error: err.message });
    }

    return json(200, { ok: true });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runNotificationSweep(env).catch((err) => console.error("Falha na verificação agendada:", err)));
  },
};
