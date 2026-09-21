import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  query,
  where,
  onSnapshot,
  getDoc,
  getDocs,
  setDoc,
  writeBatch,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db } from "./firebase-init.js";

// Cria uma sub-secção dentro de uma personagem.
export function addSection({ ownerUid, character, name, order }) {
  return addDoc(collection(db, "sections"), {
    ownerUid,
    character,
    name: name.trim(),
    isDefault: false,
    order: order ?? Date.now(),
    createdAt: serverTimestamp(),
  });
}

// Garante que existe a secção "Geral" (isDefault) para esta personagem, usando um ID
// determinístico — mesmo que seja chamado várias vezes em simultâneo (várias renderizações
// antes da primeira escrita chegar via onSnapshot), nunca cria mais do que um documento,
// porque todas as chamadas escrevem no mesmo ID em vez de criarem IDs aleatórios.
export async function ensureDefaultSection({ ownerUid, character }) {
  const id = `default__${ownerUid}__${encodeURIComponent(character)}`;
  const ref = doc(db, "sections", id);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      ownerUid,
      character,
      name: "Geral",
      isDefault: true,
      order: 0,
      createdAt: serverTimestamp(),
    });
  }
  return id;
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
