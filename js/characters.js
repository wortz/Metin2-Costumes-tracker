import {
  collection,
  addDoc,
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
