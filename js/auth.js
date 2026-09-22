import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
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
    displayName: data.displayName || firebaseUser.email,
  };
  return currentUser;
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
