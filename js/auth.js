import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { doc, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { auth, db } from "./firebase-init.js";

// Estado do utilizador atualmente autenticado (dados do Firestore, não só do Auth).
export let currentUser = null; // { uid, email, role, disabled, displayName }

export function login(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export function logout() {
  currentUser = null;
  return signOut(auth);
}

// Carrega o documento users/{uid} do Firestore para o utilizador autenticado.
// Lança erro se a conta estiver desativada.
export async function loadCurrentUserProfile(firebaseUser) {
  const snap = await getDoc(doc(db, "users", firebaseUser.uid));
  if (!snap.exists()) {
    throw new Error("Conta sem perfil associado. Contacta o administrador.");
  }
  const data = snap.data();
  if (data.disabled) {
    await signOut(auth);
    throw new Error("Esta conta foi desativada.");
  }
  currentUser = {
    uid: firebaseUser.uid,
    email: firebaseUser.email,
    role: data.role || "user",
    disabled: !!data.disabled,
    privileged: !!data.privileged,
    displayName: data.displayName || firebaseUser.email,
  };
  return currentUser;
}

// Conta com limites maiores (marcada pelo admin). O admin conta sempre como privilegiado.
export function isPrivileged() {
  return !!currentUser && (currentUser.role === "admin" || currentUser.privileged);
}

// Acompanha o próprio perfil em tempo real, para o estado "privilegiada" mudar
// logo que o admin o altera, sem ser preciso voltar a entrar.
export function subscribeToOwnProfile(uid, onChange) {
  return onSnapshot(doc(db, "users", uid), (snap) => {
    if (snap.exists()) onChange(snap.data());
  });
}

export function isAdmin() {
  return !!currentUser && currentUser.role === "admin";
}

// onAuthChange(callback): callback recebe (currentUser | null). Devolve a
// função de unsubscribe do listener, para quem só precisa de um disparo único.
export function onAuthChange(callback) {
  return onAuthStateChanged(auth, async (firebaseUser) => {
    if (!firebaseUser) {
      currentUser = null;
      callback(null);
      return;
    }
    try {
      const profile = await loadCurrentUserProfile(firebaseUser);
      callback(profile);
    } catch (err) {
      currentUser = null;
      callback(null, err);
    }
  });
}
