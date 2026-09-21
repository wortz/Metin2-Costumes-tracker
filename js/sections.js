import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  query,
  where,
  onSnapshot,
  getDocs,
  writeBatch,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db } from "./firebase-init.js";

// Cria uma sub-secção dentro de uma personagem. isDefault marca a secção "Geral"
// automática (uma por personagem), que não pode ser apagada mas pode ser arrastada.
export function addSection({ ownerUid, character, name, isDefault = false, order }) {
  return addDoc(collection(db, "sections"), {
    ownerUid,
    character,
    name: name.trim(),
    isDefault,
    order: order ?? Date.now(),
    createdAt: serverTimestamp(),
  });
}

// Apaga a secção; os trajes que lá estavam passam para fallbackSectionId (normalmente a secção "Geral").
export async function deleteSection(sectionId, fallbackSectionId = null) {
  const costumesSnap = await getDocs(query(collection(db, "costumes"), where("sectionId", "==", sectionId)));
  const batch = writeBatch(db);
  costumesSnap.forEach((docSnap) => batch.update(docSnap.ref, { sectionId: fallbackSectionId }));
  batch.delete(doc(db, "sections", sectionId));
  return batch.commit();
}

export function subscribeToOwnSections(ownerUid, onChange) {
  const q = query(collection(db, "sections"), where("ownerUid", "==", ownerUid));
  return onSnapshot(q, (snap) => {
    const sections = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    onChange(sections);
  });
}

// Aplica uma nova ordem a várias secções de uma vez (reordenar dentro da mesma personagem).
export function reorderSections(updates) {
  const batch = writeBatch(db);
  for (const { id, order } of updates) {
    batch.update(doc(db, "sections", id), { order });
  }
  return batch.commit();
}
