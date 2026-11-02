import { getAuth } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { hostingDb } from './firebase';
import { HostUnconfiguredError } from './shareRemote';

/**
 * Edit link: `?share=&key=`. Anyone who opens it can edit, with or without an
 * email account. View link: `?share=&mode=view&viewKey=`. It never edits.
 * The owner can refresh both keys. Old links stop opening the project once
 * access is locked, and old editors are removed.
 */

const EDIT_KEYS = 'gridstage-edit-keys';
const VIEW_KEYS = 'gridstage-view-keys';

export interface ShareLinks {
  editKey: string;
  viewKey: string;
}

function readMap(storageKey: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw === null ? {} : (JSON.parse(raw) as Record<string, string>);
  } catch {
    return {};
  }
}

function remember(storageKey: string, shareId: string, key: string): void {
  const map = readMap(storageKey);
  map[shareId] = key;
  localStorage.setItem(storageKey, JSON.stringify(map));
}

function forget(storageKey: string, shareId: string): void {
  const map = readMap(storageKey);
  delete map[shareId];
  localStorage.setItem(storageKey, JSON.stringify(map));
}

export function rememberedEditKey(shareId: string): string | null {
  return readMap(EDIT_KEYS)[shareId] ?? null;
}

export function rememberedViewKey(shareId: string): string | null {
  return readMap(VIEW_KEYS)[shareId] ?? null;
}

export function forgetEditKey(shareId: string): void {
  forget(EDIT_KEYS, shareId);
  forget(VIEW_KEYS, shareId);
}

function newLinkKey(): string {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
}

async function readOrCreateKey(
  db: Firestore,
  shareId: string,
  kind: 'edit' | 'view',
): Promise<string> {
  const ref = doc(db, 'shares', shareId, 'gate', kind);
  const existing = await getDoc(ref);
  const stored = existing.data()?.['key'];
  if (typeof stored === 'string' && stored.length >= 20) return stored;
  const key = newLinkKey();
  await setDoc(ref, { key });
  return key;
}

async function requireDb(): Promise<{ db: Firestore; uid: string }> {
  const db = await hostingDb();
  const user = getAuth().currentUser;
  if (db === null || user === null) throw new HostUnconfiguredError();
  return { db, uid: user.uid };
}

/** Owner-only. Keeps the current keys and makes sure this account stays an editor. */
export async function ensureOwnerLinks(shareId: string): Promise<ShareLinks> {
  const { db, uid } = await requireDb();
  const editKey = await readOrCreateKey(db, shareId, 'edit');
  const viewKey = await readOrCreateKey(db, shareId, 'view');
  const member = doc(db, 'shares', shareId, 'members', uid);
  const joined = await getDoc(member);
  if (!joined.exists()) await setDoc(member, { key: editKey });
  remember(EDIT_KEYS, shareId, editKey);
  remember(VIEW_KEYS, shareId, viewKey);
  return { editKey, viewKey };
}

/** New keys. Previous edit and view links stop working. */
export async function refreshShareLinks(shareId: string): Promise<ShareLinks> {
  const { db, uid } = await requireDb();
  const editKey = newLinkKey();
  const viewKey = newLinkKey();
  await setDoc(doc(db, 'shares', shareId, 'gate', 'edit'), { key: editKey });
  await setDoc(doc(db, 'shares', shareId, 'gate', 'view'), { key: viewKey });
  const members = await getDocs(collection(db, 'shares', shareId, 'members'));
  const viewers = await getDocs(collection(db, 'shares', shareId, 'viewers'));
  await Promise.all([
    ...members.docs.map((snap) => deleteDoc(snap.ref)),
    ...viewers.docs.map((snap) => deleteDoc(snap.ref)),
  ]);
  await setDoc(doc(db, 'shares', shareId, 'members', uid), { key: editKey });
  await updateDoc(doc(db, 'shares', shareId), {
    accessLocked: true,
    updatedAt: Timestamp.now(),
  });
  remember(EDIT_KEYS, shareId, editKey);
  remember(VIEW_KEYS, shareId, viewKey);
  return { editKey, viewKey };
}

export async function lockShareAccess(shareId: string): Promise<void> {
  const { db } = await requireDb();
  await updateDoc(doc(db, 'shares', shareId), {
    accessLocked: true,
    updatedAt: Timestamp.now(),
  });
}

async function claimPass(
  shareId: string,
  key: string | null,
  collectionName: 'members' | 'viewers',
  storageKey: string,
): Promise<boolean> {
  const db = await hostingDb();
  const user = getAuth().currentUser;
  if (db === null || user === null) return false;
  const ref = doc(db, 'shares', shareId, collectionName, user.uid);
  try {
    const existing = await getDoc(ref);
    if (existing.exists()) {
      if (key !== null) remember(storageKey, shareId, key);
      return true;
    }
  } catch {
    return false;
  }
  if (key === null || key.length < 20) return false;
  try {
    await setDoc(ref, { key });
    remember(storageKey, shareId, key);
    return true;
  } catch {
    return false;
  }
}

/** True when this browser may edit: already joined, or the edit-link key matches. */
export async function claimEditAccess(shareId: string, key: string | null): Promise<boolean> {
  return claimPass(shareId, key, 'members', EDIT_KEYS);
}

/** True when this browser may open the view link after the owner has locked it. */
export async function claimViewAccess(shareId: string, key: string | null): Promise<boolean> {
  return claimPass(shareId, key, 'viewers', VIEW_KEYS);
}

export async function deleteEditAccess(shareId: string): Promise<void> {
  const db = await hostingDb();
  if (db === null) return;
  const members = await getDocs(collection(db, 'shares', shareId, 'members'));
  const viewers = await getDocs(collection(db, 'shares', shareId, 'viewers'));
  await Promise.all([
    ...members.docs.map((snap) => deleteDoc(snap.ref)),
    ...viewers.docs.map((snap) => deleteDoc(snap.ref)),
    deleteDoc(doc(db, 'shares', shareId, 'gate', 'edit')),
    deleteDoc(doc(db, 'shares', shareId, 'gate', 'view')),
  ]);
  forgetEditKey(shareId);
}
