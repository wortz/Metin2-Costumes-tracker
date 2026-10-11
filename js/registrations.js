import { doc, onSnapshot, setDoc, Timestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db } from "./firebase-init.js";

export const INSTANCES = {
  meley: "Meley",
  balathor: "Balathor",
};

// Tempo mínimo entre dois registos.
export const REGISTRATION_COOLDOWN_MS = 3 * 60 * 60 * 1000;

// Cada conta guarda em registrations/{uid} a hora do último registo de cada
// instância (meley / balathor), de forma independente: registar numa não afeta a outra.
// Devolve { meley: {at: Date, channel}|null, balathor: ... }. O canal (1 a 6) é
// só informativo (não limita nada: o intervalo de 3h é por instância).
export function subscribeToRegistration(uid, onChange) {
  return onSnapshot(doc(db, "registrations", uid), (snap) => {
    const data = snap.exists() ? snap.data() : {};
    const result = {};
    for (const key of Object.keys(INSTANCES)) {
      // Compatível com o formato antigo (um único registo: { instance, registeredAt }).
      const ts = data[key] ?? (data.instance === key ? data.registeredAt : null);
      result[key] = ts ? { at: ts.toDate(), channel: data[`${key}Channel`] || null } : null;
    }
    onChange(result);
  });
}

export const CHANNELS = [1, 2, 3, 4, 5, 6];

export function saveRegistration(uid, instance, channel) {
  return setDoc(
    doc(db, "registrations", uid),
    { ownerUid: uid, [instance]: Timestamp.now(), [`${instance}Channel`]: channel },
    { merge: true }
  );
}
