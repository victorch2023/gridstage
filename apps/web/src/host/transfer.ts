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
import { create } from 'zustand';
import { ensureOwnerLinks } from './editAccess';
import { hostingDb } from './firebase';
import { HostUnconfiguredError, ShareUnavailableError } from './shareRemote';

/**
 * Ownership offer addressed to an email. Spark has no mail server, so the
 * offer waits in that person's mailbox until they sign in with the same
 * address and accept it. Firestore rules are what make the hand-off real.
 */

export interface OwnershipInvite {
  shareId: string;
  title: string;
  fromEmail: string;
  toEmail: string;
}

interface OfferStore {
  pending: OwnershipInvite[];
  setPending: (pending: OwnershipInvite[]) => void;
}

export const useOwnershipOffers = create<OfferStore>((set) => ({
  pending: [],
  setPending: (pending) => set({ pending }),
}));

export class TransferEmailError extends Error {
  readonly reason: 'invalid' | 'self';
  constructor(reason: 'invalid' | 'self') {
    super(reason);
    this.name = 'TransferEmailError';
    this.reason = reason;
  }
}

export function normalizeOwnerEmail(email: string): string | null {
  const value = email.trim().toLowerCase();
  if (value.length < 5 || value.length > 180) return null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return null;
  return value;
}

function inviteRef(db: Firestore, email: string, shareId: string) {
  return doc(db, 'mailboxes', email, 'invites', shareId);
}

async function requireDb(): Promise<{ db: Firestore; uid: string; email: string }> {
  const db = await hostingDb();
  if (db === null) throw new HostUnconfiguredError();
  const user = getAuth().currentUser;
  const email = user?.email?.trim() ?? '';
  if (user === null || email === '') throw new ShareUnavailableError();
  return { db, uid: user.uid, email };
}

export async function offerOwnership(input: {
  shareId: string;
  toEmail: string;
  title: string;
}): Promise<string> {
  const toEmail = normalizeOwnerEmail(input.toEmail);
  const { db, uid, email } = await requireDb();
  if (toEmail === null) throw new TransferEmailError('invalid');
  if (toEmail === email.toLowerCase()) throw new TransferEmailError('self');
  // Keep this account on the edit link before the new owner takes editorUid.
  await ensureOwnerLinks(input.shareId);
  const shareRef = doc(db, 'shares', input.shareId);
  const existing = await getDoc(shareRef);
  const previous = existing.data()?.['pendingOwnerEmail'];
  if (typeof previous === 'string' && previous !== toEmail) {
    await deleteDoc(inviteRef(db, previous, input.shareId));
  }
  const title = input.title.trim().slice(0, 180) || 'GridStage';
  await setDoc(inviteRef(db, toEmail, input.shareId), {
    shareId: input.shareId,
    title,
    fromUid: uid,
    fromEmail: email,
    toEmail,
    status: 'pending',
    createdAt: Timestamp.now(),
  });
  await updateDoc(shareRef, {
    pendingOwnerEmail: toEmail,
    updatedAt: Timestamp.now(),
  });
  return toEmail;
}

export async function cancelOwnershipOffer(shareId: string, toEmail: string): Promise<void> {
  const { db } = await requireDb();
  const email = normalizeOwnerEmail(toEmail);
  if (email === null) return;
  await deleteDoc(inviteRef(db, email, shareId));
  await updateDoc(doc(db, 'shares', shareId), {
    pendingOwnerEmail: null,
    updatedAt: Timestamp.now(),
  });
}

export async function listOwnershipOffers(): Promise<OwnershipInvite[]> {
  const { db, email: rawEmail } = await requireDb();
  const email = rawEmail.toLowerCase();
  const snaps = await getDocs(collection(db, 'mailboxes', email, 'invites'));
  const pending: OwnershipInvite[] = [];
  for (const snap of snaps.docs) {
    const data = snap.data();
    if (data['status'] !== 'pending') continue;
    if (typeof data['shareId'] !== 'string' || typeof data['title'] !== 'string') continue;
    pending.push({
      shareId: data['shareId'],
      title: data['title'],
      fromEmail: typeof data['fromEmail'] === 'string' ? data['fromEmail'] : '',
      toEmail: email,
    });
  }
  return pending;
}

export async function refreshOwnershipOffers(): Promise<void> {
  try {
    const pending = await listOwnershipOffers();
    useOwnershipOffers.getState().setPending(pending);
  } catch {
    useOwnershipOffers.getState().setPending([]);
  }
}

export async function acceptOwnership(shareId: string): Promise<void> {
  const { db, uid, email: rawEmail } = await requireDb();
  const email = rawEmail.toLowerCase();
  // The share move has to land while the offer is still pending. A single
  // batch hides that pending offer from the rules, so the two writes stay apart.
  await updateDoc(doc(db, 'shares', shareId), {
    editorUid: uid,
    pendingOwnerEmail: null,
    updatedAt: Timestamp.now(),
  });
  await updateDoc(inviteRef(db, email, shareId), {
    status: 'accepted',
    acceptedUid: uid,
    acceptedAt: Timestamp.now(),
  });
}
