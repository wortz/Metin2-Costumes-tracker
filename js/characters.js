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
import { db } from "./firebase-init.js";

// Cria uma personagem vazia (sem trajes ainda), para poderes organizar antes de adicionar trajes.
export function addCharacter({ ownerUid, name }) {
  return addDoc(collection(db, "characters"), {
    ownerUid,
    name: name.trim(),
    order: Date.now(),
    createdAt: serverTimestamp(),
  });
}

export function deleteCharacter(characterId) {
  return deleteDoc(doc(db, "characters", characterId));
}

export function subscribeToOwnCharacters(ownerUid, onChange) {
  const q = query(collection(db, "characters"), where("ownerUid", "==", ownerUid));
  return onSnapshot(q, (snap) => {
    const characters = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    onChange(characters);
  });
}
