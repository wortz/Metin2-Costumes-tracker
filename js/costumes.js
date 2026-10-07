import {
  collection,
  addDoc,
  deleteDoc,
  updateDoc,
  doc,
  query,
  where,
  onSnapshot,
  Timestamp,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db } from "./firebase-init.js";
import { collectionsFor } from "./kinds.js";

export const COSTUME_TYPES = {
  body: "Corpo",
  weapon: "Arma",
  head: "Cabeça",
};

export const COSTUME_ICONS = {
  body: "assets/icons/body.png",
  weapon: "assets/icons/weapon.png",
  head: "assets/icons/head.png",
};

export function toDurationMs({ daysLeft, hoursLeft, minutesLeft }) {
  const totalMinutes = (Number(daysLeft) || 0) * 24 * 60 + (Number(hoursLeft) || 0) * 60 + (Number(minutesLeft) || 0);
  return totalMinutes * 60 * 1000;
}

// Cria o traje/pet. daysLeft/hoursLeft/minutesLeft definem quanto tempo falta A PARTIR DE AGORA.
// No caso dos pets esse tempo é também a duração fixa (guardada em durationMs),
// à qual o pet volta sempre que é renovado.
export function addCostume({ ownerUid, character, type = null, description, daysLeft, hoursLeft, minutesLeft, sectionId = null, kind = "costume", remainingMs = null }) {
  const durationMs = toDurationMs({ daysLeft, hoursLeft, minutesLeft });
  // Pet que já começou: o tempo restante atual pode ser menor que a duração total.
  const endAt = new Date(Date.now() + (remainingMs || durationMs));
  const data = {
    ownerUid,
    character: character.trim(),
    type,
    description: description.trim(),
    endAt: Timestamp.fromDate(endAt),
    sectionId: sectionId || null,
    createdAt: serverTimestamp(),
  };
  if (kind === "pet") data.durationMs = durationMs;
  return addDoc(collection(db, collectionsFor(kind).items), data);
}

export function deleteCostume(costumeId, kind = "costume") {
  return deleteDoc(doc(db, collectionsFor(kind).items, costumeId));
}

// Move um traje para outra personagem/secção (drag-and-drop). A ordem dentro da
// secção é sempre pelo tempo restante, por isso não há posição manual a guardar.
export function moveCostume(costumeId, { character, sectionId }, kind = "costume") {
  return updateDoc(doc(db, collectionsFor(kind).items, costumeId), {
    character,
    sectionId: sectionId || null,
  });
}

// Renova o traje: define um novo tempo restante a partir de agora, e reseta os
// avisos já disparados (para voltarem a acontecer neste novo prazo).
export function renewCostume(costumeId, { daysLeft, hoursLeft, minutesLeft }) {
  const endAt = new Date(Date.now() + toDurationMs({ daysLeft, hoursLeft, minutesLeft }));
  return updateDoc(doc(db, "costumes", costumeId), {
    endAt: Timestamp.fromDate(endAt),
    notifiedThreshold: false,
    notified12h: false,
  });
}

// Renova o pet: volta sempre à duração fixa com que foi criado.
export function renewPet(petId, durationMs) {
  return updateDoc(doc(db, "pets", petId), {
    endAt: Timestamp.fromDate(new Date(Date.now() + durationMs)),
    notifiedThreshold: false,
    notified12h: false,
  });
}

// Marca que já se avisou para este traje num determinado estágio ("threshold" ou
// "12h"), para não repetir o mesmo aviso. Partilhado entre o browser e o Worker.
export function markCostumeNotified(costumeId, stage, kind = "costume") {
  const field = stage === "12h" ? "notified12h" : "notifiedThreshold";
  return updateDoc(doc(db, collectionsFor(kind).items, costumeId), { [field]: true });
}

// Subscreve em tempo real aos trajes de um utilizador. Devolve a função unsubscribe.
export function subscribeToOwnCostumes(ownerUid, onChange, kind = "costume") {
  const q = query(collection(db, collectionsFor(kind).items), where("ownerUid", "==", ownerUid));
  return onSnapshot(q, (snap) => {
    const costumes = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    onChange(costumes);
  });
}

// Usado pelo admin para contar trajes de todos os utilizadores.
export function subscribeToAllCostumes(onChange, kind = "costume") {
  return onSnapshot(collection(db, collectionsFor(kind).items), (snap) => {
    const costumes = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    onChange(costumes);
  });
}

// Calcula o tempo restante de um traje a partir do seu endAt (Firestore Timestamp).
export function computeRemaining(endAt) {
  const end = endAt.toDate ? endAt.toDate() : new Date(endAt);
  const totalMs = end.getTime() - Date.now();
  const expired = totalMs <= 0;
  const totalMinutes = Math.max(0, Math.floor(totalMs / 60000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  return { days, hours, minutes, totalMs, expired, endDate: end };
}

export function formatEndDate(end) {
  return end.toLocaleString("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatRemaining({ days, hours, minutes, expired }) {
  if (expired) return "Expirado";
  return `${days}d ${hours}h ${minutes}m`;
}
