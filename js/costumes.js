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

// Cria o traje. daysLeft/hoursLeft/minutesLeft definem quanto tempo falta A PARTIR DE AGORA.
export function addCostume({ ownerUid, character, type, description, daysLeft, hoursLeft, minutesLeft, sectionId = null }) {
  const totalMinutes = (Number(daysLeft) || 0) * 24 * 60 + (Number(hoursLeft) || 0) * 60 + (Number(minutesLeft) || 0);
  const endAt = new Date(Date.now() + totalMinutes * 60 * 1000);
  return addDoc(collection(db, "costumes"), {
    ownerUid,
    character: character.trim(),
    type,
    description: description.trim(),
    endAt: Timestamp.fromDate(endAt),
    sectionId: sectionId || null,
    createdAt: serverTimestamp(),
  });
}

export function deleteCostume(costumeId) {
  return deleteDoc(doc(db, "costumes", costumeId));
}

// Move um traje para outra personagem/secção (drag-and-drop). A ordem dentro da
// secção é sempre pelo tempo restante, por isso não há posição manual a guardar.
export function moveCostume(costumeId, { character, sectionId }) {
  return updateDoc(doc(db, "costumes", costumeId), {
    character,
    sectionId: sectionId || null,
  });
}

// Renova o traje: define um novo tempo restante a partir de agora.
export function renewCostume(costumeId, { daysLeft, hoursLeft, minutesLeft }) {
  const totalMinutes = (Number(daysLeft) || 0) * 24 * 60 + (Number(hoursLeft) || 0) * 60 + (Number(minutesLeft) || 0);
  const endAt = new Date(Date.now() + totalMinutes * 60 * 1000);
  return updateDoc(doc(db, "costumes", costumeId), {
    endAt: Timestamp.fromDate(endAt),
  });
}

// Subscreve em tempo real aos trajes de um utilizador. Devolve a função unsubscribe.
export function subscribeToOwnCostumes(ownerUid, onChange) {
  const q = query(collection(db, "costumes"), where("ownerUid", "==", ownerUid));
  return onSnapshot(q, (snap) => {
    const costumes = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    onChange(costumes);
  });
}

// Usado pelo admin para contar trajes de todos os utilizadores.
export function subscribeToAllCostumes(onChange) {
  return onSnapshot(collection(db, "costumes"), (snap) => {
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
