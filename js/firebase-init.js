import { initializeApp, getApps, deleteApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Usado pelo admin para criar novos utilizadores sem perder a sua própria sessão:
// cria-se uma segunda app Firebase temporária, cria-se lá o utilizador, e destrói-se
// a app de seguida. A sessão do admin na app principal nunca é afetada.
export async function createUserWithoutSignOut(email, password) {
  const { initializeApp: initSecondary } = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js");
  const { getAuth: getSecondaryAuth, createUserWithEmailAndPassword, signOut } = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js");

  const existing = getApps().find((a) => a.name === "secondary");
  if (existing) await deleteApp(existing);

  const secondaryApp = initSecondary(firebaseConfig, "secondary");
  const secondaryAuth = getSecondaryAuth(secondaryApp);
  try {
    const credential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    await signOut(secondaryAuth);
    return credential.user.uid;
  } finally {
    await deleteApp(secondaryApp);
  }
}
