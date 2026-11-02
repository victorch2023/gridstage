import { initializeApp } from 'firebase/app';
import type { FirebaseApp, FirebaseOptions } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import type { Auth, User } from 'firebase/auth';
import { doc, getDoc, getFirestore, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';

/**
 * Spark-plan Firebase: Auth (email/password) plus Firestore. Cloud Storage
 * and Cloud Functions need Blaze, so they are not used. The web config is
 * public by design; Firestore rules are the access control.
 */

interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}

function complete(value: Partial<FirebaseConfig> | null): FirebaseConfig | null {
  if (value === null) return null;
  const { apiKey, authDomain, projectId, appId } = value;
  if (
    apiKey === undefined ||
    apiKey === '' ||
    authDomain === undefined ||
    authDomain === '' ||
    projectId === undefined ||
    projectId === '' ||
    appId === undefined ||
    appId === ''
  ) {
    return null;
  }
  return { apiKey, authDomain, projectId, appId };
}

function configFromEnv(): FirebaseConfig | null {
  return complete({
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
    appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
  });
}

let configPromise: Promise<FirebaseConfig | null> | null = null;

export function loadFirebaseConfig(): Promise<FirebaseConfig | null> {
  if (configPromise === null) configPromise = resolveConfig();
  return configPromise;
}

async function resolveConfig(): Promise<FirebaseConfig | null> {
  const fromEnv = configFromEnv();
  if (fromEnv !== null) return fromEnv;
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}firebase-config.json`);
    if (!response.ok) return null;
    const json = (await response.json()) as Partial<FirebaseConfig>;
    return complete(json);
  } catch {
    return null;
  }
}

let app: FirebaseApp | null = null;

async function firebaseApp(): Promise<FirebaseApp | null> {
  const config = await loadFirebaseConfig();
  if (config === null) return null;
  if (app === null) app = initializeApp(config as FirebaseOptions);
  return app;
}

export async function hostingAuth(): Promise<Auth | null> {
  const ready = await firebaseApp();
  if (ready === null) return null;
  return getAuth(ready);
}

export async function hostingDb(): Promise<Firestore | null> {
  const ready = await firebaseApp();
  if (ready === null) return null;
  return getFirestore(ready);
}

/** Resolves with the restored session, including null when nobody is signed in. */
export async function waitForAuth(): Promise<User | null> {
  const auth = await hostingAuth();
  if (auth === null) return null;
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user);
    });
  });
}

export function watchAuth(onChange: (user: User | null) => void): () => void {
  let unsubscribe = (): void => {};
  let cancelled = false;
  void hostingAuth().then((auth) => {
    if (auth === null || cancelled) {
      onChange(null);
      return;
    }
    unsubscribe = onAuthStateChanged(auth, onChange);
  });
  return () => {
    cancelled = true;
    unsubscribe();
  };
}

/**
 * Account row in Firestore. The password is never written here: Firebase
 * Authentication stores it hashed. This document only ties the email to the
 * uid that owns published projects.
 */
export async function saveAccount(user: User): Promise<void> {
  const db = await hostingDb();
  if (db === null) throw new Error('unconfigured');
  const email = user.email?.trim() ?? '';
  if (email === '') throw new Error('no email');
  const ref = doc(db, 'accounts', user.uid);
  const existing = await getDoc(ref);
  if (!existing.exists()) {
    await setDoc(ref, { email, createdAt: Timestamp.now() });
    return;
  }
  if (existing.data()['email'] !== email) await updateDoc(ref, { email });
}

export async function signUpWithEmail(email: string, password: string): Promise<void> {
  const auth = await hostingAuth();
  if (auth === null) throw new Error('unconfigured');
  const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
  await saveAccount(credential.user);
}

/** A guest on an edit or view link. This is not an email account. */
export async function ensureGuestUser(): Promise<User | null> {
  const existing = await waitForAuth();
  if (existing !== null) return existing;
  const auth = await hostingAuth();
  if (auth === null) return null;
  const credential = await signInAnonymously(auth);
  return credential.user;
}

export async function signInWithEmail(email: string, password: string): Promise<void> {
  const auth = await hostingAuth();
  if (auth === null) throw new Error('unconfigured');
  const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
  await saveAccount(credential.user);
}

export async function signOutHosting(): Promise<void> {
  const auth = await hostingAuth();
  if (auth === null) return;
  await signOut(auth);
}

export async function sendHostingPasswordReset(email: string): Promise<void> {
  const auth = await hostingAuth();
  if (auth === null) throw new Error('unconfigured');
  await sendPasswordResetEmail(auth, email.trim());
}

export function firebaseErrorCode(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code;
  }
  return '';
}
