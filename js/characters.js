import {
  collection,
  addDoc,
  getDocs,
  writeBatch,
  deleteDoc,
  doc,
  query,
  where,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db, snapshotError } from "./firebase-init.js";
import { collectionsFor } from "./kinds.js";

// Cria uma personagem vazia (sem trajes/pets ainda), para poderes organizar antes de adicionar.
export function addCharacter({ ownerUid, name, kind = "costume" }) {
  return addDoc(collection(db, collectionsFor(kind).characters), {
    ownerUid,
    name: name.trim(),
    order: Date.now(),
    createdAt: serverTimestamp(),
  });
}

// Apaga a personagem E tudo o que ela tem, em todos os menus: trajes, pets, secções
// e tempos do Biologo / 6-7. A comparação do nome ignora maiúsculas/minúsculas.
export async function deleteCharacterEverywhere(ownerUid, name) {
  const target = name.trim().toLowerCase();
  const batch = writeBatch(db);
  const sources = [
    ["costumes", "character"],
    ["pets", "character"],
    ["sections", "character"],
    ["petSections", "character"],
    ["bioTimers", "character"],
    ["characters", "name"],
  ];
  for (const [collectionName, field] of sources) {
    const snap = await getDocs(query(collection(db, collectionName), where("ownerUid", "==", ownerUid)));
    snap.forEach((d) => {
      if ((d.data()[field] || "").trim().toLowerCase() === target) batch.delete(d.ref);
    });
  }
  return batch.commit();
}

export function deleteCharacter(characterId, kind = "costume") {
  return deleteDoc(doc(db, collectionsFor(kind).characters, characterId));
}

// Usado pelo admin para contar as personagens de todas as contas.
export function subscribeToAllCharacters(onChange) {
  return onSnapshot(collection(db, "characters"), (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, snapshotError("characters (todas)"));
}

export function subscribeToOwnCharacters(ownerUid, onChange, kind = "costume") {
  const q = query(collection(db, collectionsFor(kind).characters), where("ownerUid", "==", ownerUid));
  return onSnapshot(q, (snap) => {
    const characters = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    onChange(characters);
  }, snapshotError(collectionsFor(kind).characters));
}
