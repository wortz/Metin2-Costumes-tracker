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
import { db, snapshotError } from "./firebase-init.js";

const HOUR_MS = 60 * 60 * 1000;

// Tipos de timer do menu "Biologo / 6-7": duração inicial (e a que volta ao
// entregar/recolher) e o nome do botão de ação.
export const BIO_TYPES = {
  bio18: { label: "Biologo 1-8", group: "bio", durationMs: 22 * HOUR_MS, action: "Entregar" },
  jewels: { label: "Joias", group: "bio", durationMs: 12 * HOUR_MS, action: "Entregar" },
  sixseven: { label: "6-7", group: "sixseven", durationMs: 24 * HOUR_MS, action: "Recolher" },
};

export const MAX_TIMERS_PER_CHARACTER = 2;

export function addBioTimer({ ownerUid, character, type }) {
  return addDoc(collection(db, "bioTimers"), {
    ownerUid,
    character: character.trim(),
    type,
    endAt: Timestamp.fromDate(new Date(Date.now() + BIO_TYPES[type].durationMs)),
    readyNotified: false,
    createdAt: serverTimestamp(),
  });
}

export function deleteBioTimer(id) {
  return deleteDoc(doc(db, "bioTimers", id));
}

// Entregar / Recolher: o timer volta à duração inicial do seu tipo.
export function resetBioTimer(id, type) {
  return updateDoc(doc(db, "bioTimers", id), {
    endAt: Timestamp.fromDate(new Date(Date.now() + BIO_TYPES[type].durationMs)),
  });
}

// Alterar tempo: define o novo tempo restante (no jogo o tempo pode ser reduzido).
export function changeBioTimer(id, { hours, minutes }) {
  const ms = ((Number(hours) || 0) * 60 + (Number(minutes) || 0)) * 60 * 1000;
  return updateDoc(doc(db, "bioTimers", id), {
    endAt: Timestamp.fromDate(new Date(Date.now() + ms)),
    readyNotified: false,
  });
}

export function subscribeToOwnBioTimers(ownerUid, onChange) {
  const q = query(collection(db, "bioTimers"), where("ownerUid", "==", ownerUid));
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, snapshotError("bioTimers"));
}
