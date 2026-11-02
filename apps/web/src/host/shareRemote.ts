import { getAuth } from 'firebase/auth';
import {
  Bytes,
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { parseDocFile } from '../state/docFile';
import type { DocState } from '../state/store';
import { firebaseErrorCode, hostingDb } from './firebase';
import { joinAudio, packShare } from './pack';

/** Durations the rules accept (they reject anything past 185 days). */
export const SHARE_DURATIONS_DAYS = [7, 30, 90, 180] as const;
export type ShareDurationDays = (typeof SHARE_DURATIONS_DAYS)[number];

const BATCH_OPS = 8;

export class ShareUnavailableError extends Error {
  constructor() {
    super('share unavailable');
    this.name = 'ShareUnavailableError';
  }
}

/** The owner refreshed the links, or this visitor no longer has access. */
export class ShareLinkRevokedError extends Error {
  constructor() {
    super('share link revoked');
    this.name = 'ShareLinkRevokedError';
  }
}

export class HostUnconfiguredError extends Error {
  constructor() {
    super('firebase unconfigured');
    this.name = 'HostUnconfiguredError';
  }
}

export interface LoadedShare {
  shareId: string;
  editorUid: string;
  expiresAtMs: number;
  pendingOwnerEmail: string | null;
  accessLocked: boolean;
  doc: DocState;
  audio: Uint8Array | null;
  audioContentType: string | null;
  docParts: number;
  audioParts: number;
}

export interface PublishedShare {
  shareId: string;
  expiresAtMs: number;
  docParts: number;
  audioParts: number;
}

type AudioWrite =
  { mode: 'keep' } | { mode: 'set'; bytes: Uint8Array | null; contentType: string | null };

function isDuration(days: number): days is ShareDurationDays {
  return (SHARE_DURATIONS_DAYS as readonly number[]).includes(days);
}

function expiresAtFor(days: ShareDurationDays): Timestamp {
  return Timestamp.fromMillis(Date.now() + days * 24 * 60 * 60 * 1000);
}

function partId(kind: 'doc' | 'audio', index: number): string {
  return `${kind}-${index}`;
}

async function commitParts(
  shareId: string,
  writes: { id: string; data: Record<string, unknown> }[],
  deletes: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const db = await hostingDb();
  if (db === null) throw new HostUnconfiguredError();
  const total = writes.length + deletes.length;
  let done = 0;
  const run = async (
    ids: { id: string; data?: Record<string, unknown> }[],
    deleting: boolean,
  ): Promise<void> => {
    for (let i = 0; i < ids.length; i += BATCH_OPS) {
      const batch = writeBatch(db);
      for (const item of ids.slice(i, i + BATCH_OPS)) {
        const ref = doc(db, 'shares', shareId, 'parts', item.id);
        if (deleting) batch.delete(ref);
        else batch.set(ref, item.data ?? {});
      }
      await batch.commit();
      done += Math.min(BATCH_OPS, ids.length - i);
      onProgress?.(done, total);
    }
  };
  await run(
    writes.map((item) => ({ id: item.id, data: item.data })),
    false,
  );
  await run(
    deletes.map((id) => ({ id })),
    true,
  );
}

async function readPartBytes(
  shareId: string,
  count: number,
  kind: 'doc' | 'audio',
): Promise<string[] | Uint8Array[]> {
  const db = await hostingDb();
  if (db === null) throw new HostUnconfiguredError();
  const snaps = await Promise.all(
    Array.from({ length: count }, (_, index) =>
      getDoc(doc(db, 'shares', shareId, 'parts', partId(kind, index))),
    ),
  );
  if (kind === 'doc') {
    return snaps.map((snap) => {
      const text = snap.data()?.['text'];
      if (!snap.exists() || typeof text !== 'string') throw new ShareUnavailableError();
      return text;
    });
  }
  return snaps.map((snap) => {
    const raw = snap.data()?.['bytes'];
    if (!snap.exists() || !(raw instanceof Bytes)) throw new ShareUnavailableError();
    return raw.toUint8Array();
  });
}

export async function loadShare(shareId: string): Promise<LoadedShare> {
  const db = await hostingDb();
  if (db === null) throw new HostUnconfiguredError();
  let snap;
  try {
    snap = await getDoc(doc(db, 'shares', shareId));
  } catch (error) {
    if (firebaseErrorCode(error) === 'permission-denied') throw new ShareLinkRevokedError();
    throw new ShareUnavailableError();
  }
  if (!snap.exists()) throw new ShareUnavailableError();
  const data = snap.data();
  const docParts = data['docParts'];
  const audioParts = data['audioParts'];
  const editorUid = data['editorUid'];
  const expiresAt = data['expiresAt'];
  if (
    typeof docParts !== 'number' ||
    typeof audioParts !== 'number' ||
    typeof editorUid !== 'string' ||
    !(expiresAt instanceof Timestamp)
  ) {
    throw new ShareUnavailableError();
  }
  const texts = (await readPartBytes(shareId, docParts, 'doc')) as string[];
  const parsed = parseDocFile(texts.join(''));
  if (parsed === null) throw new ShareUnavailableError();
  const audio =
    audioParts === 0
      ? null
      : joinAudio((await readPartBytes(shareId, audioParts, 'audio')) as Uint8Array[]);
  const contentType = data['audioContentType'];
  const pendingOwnerEmail = data['pendingOwnerEmail'];
  return {
    shareId,
    editorUid,
    expiresAtMs: expiresAt.toMillis(),
    pendingOwnerEmail: typeof pendingOwnerEmail === 'string' ? pendingOwnerEmail : null,
    accessLocked: data['accessLocked'] === true,
    doc: parsed,
    audio,
    audioContentType: typeof contentType === 'string' ? contentType : null,
    docParts,
    audioParts,
  };
}

async function blobBytes(
  blob: Blob | null,
): Promise<{ bytes: Uint8Array | null; contentType: string | null }> {
  if (blob === null || blob.size === 0) return { bytes: null, contentType: null };
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    contentType: blob.type !== '' ? blob.type : 'audio/mpeg',
  };
}

/**
 * Create or replace a hosted copy. Passing an existing id updates it when
 * this account is the editor; otherwise a new link is created.
 */
export async function publishShare(input: {
  existingShareId: string | null;
  doc: DocState;
  audio: Blob | null;
  durationDays: number;
  onProgress?: (done: number, total: number) => void;
}): Promise<PublishedShare> {
  if (!isDuration(input.durationDays)) throw new Error('duration');
  const audio = await blobBytes(input.audio);
  return writeShare({
    existingShareId: input.existingShareId,
    doc: input.doc,
    audio: { mode: 'set', bytes: audio.bytes, contentType: audio.contentType },
    expiresAt: expiresAtFor(input.durationDays),
    onProgress: input.onProgress,
  });
}

/** Push a later edit. Keeps the expiry. Audio is rewritten only when `audio` is set. */
export async function saveHostedEdits(input: {
  shareId: string;
  doc: DocState;
  audio: AudioWrite;
}): Promise<PublishedShare> {
  return writeShare({
    existingShareId: input.shareId,
    doc: input.doc,
    audio: input.audio,
    expiresAt: null,
  });
}

export async function renewShare(shareId: string, durationDays: number): Promise<number> {
  if (!isDuration(durationDays)) throw new Error('duration');
  const db = await hostingDb();
  if (db === null) throw new HostUnconfiguredError();
  const expiresAt = expiresAtFor(durationDays);
  await updateDoc(doc(db, 'shares', shareId), {
    expiresAt,
    updatedAt: Timestamp.now(),
    ready: true,
  });
  return expiresAt.toMillis();
}

export async function withdrawShare(
  shareId: string,
  docParts: number,
  audioParts: number,
): Promise<void> {
  const db = await hostingDb();
  if (db === null) throw new HostUnconfiguredError();
  const ids = [
    ...Array.from({ length: docParts }, (_, index) => partId('doc', index)),
    ...Array.from({ length: audioParts }, (_, index) => partId('audio', index)),
  ];
  await commitParts(shareId, [], ids);
  await deleteDoc(doc(db, 'shares', shareId));
}

async function writeShare(input: {
  existingShareId: string | null;
  doc: DocState;
  audio: AudioWrite;
  expiresAt: Timestamp | null;
  onProgress?: (done: number, total: number) => void;
}): Promise<PublishedShare> {
  const db = await hostingDb();
  if (db === null) throw new HostUnconfiguredError();
  const user = getAuth().currentUser;
  if (user === null) throw new ShareUnavailableError();

  const title = input.doc.performance.title.trim().slice(0, 180) || 'GridStage';
  const packed =
    input.audio.mode === 'set'
      ? packShare(input.doc, input.audio.bytes, input.audio.contentType)
      : null;
  const docParts = packed !== null ? packed.docParts : splitDocOnly(input.doc);

  let shareId = input.existingShareId;
  let previousDocParts = 0;
  let previousAudioParts = 0;
  let owned = false;
  if (shareId !== null) {
    try {
      const existing = await getDoc(doc(db, 'shares', shareId));
      if (existing.exists() && existing.data()['editorUid'] === user.uid) {
        owned = true;
        previousDocParts = numberField(existing.data()['docParts']);
        previousAudioParts = numberField(existing.data()['audioParts']);
      }
    } catch {
      owned = false;
    }
  }
  const id: string = owned && shareId !== null ? shareId : crypto.randomUUID();

  const writes: { id: string; data: Record<string, unknown> }[] = docParts.map((text, index) => ({
    id: partId('doc', index),
    data: { kind: 'doc', index, text },
  }));
  let audioParts = previousAudioParts;
  let audioContentType: string | null | undefined;
  if (packed !== null) {
    audioParts = packed.audioParts.length;
    audioContentType = packed.audioContentType;
    for (let index = 0; index < packed.audioParts.length; index += 1) {
      const bytes = packed.audioParts[index];
      if (bytes === undefined) continue;
      writes.push({
        id: partId('audio', index),
        data: { kind: 'audio', index, bytes: Bytes.fromUint8Array(bytes) },
      });
    }
  }

  const extraDoc = owned
    ? Array.from({ length: Math.max(0, previousDocParts - docParts.length) }, (_, offset) =>
        partId('doc', docParts.length + offset),
      )
    : [];
  const extraAudio =
    packed !== null && owned
      ? Array.from({ length: Math.max(0, previousAudioParts - audioParts) }, (_, offset) =>
          partId('audio', audioParts + offset),
        )
      : [];

  if (!owned) {
    const expiresAt = input.expiresAt ?? expiresAtFor(30);
    await setDoc(doc(db, 'shares', id), {
      title,
      editorUid: user.uid,
      performanceId: input.doc.performance.id,
      expiresAt,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      docParts: docParts.length,
      audioParts,
      audioContentType: audioContentType ?? null,
      ready: false,
    });
  }

  await commitParts(id, writes, [], input.onProgress);

  const expiresAt = input.expiresAt;
  const patch: Record<string, unknown> = {
    title,
    performanceId: input.doc.performance.id,
    updatedAt: Timestamp.now(),
    docParts: docParts.length,
    ready: true,
  };
  if (expiresAt !== null) patch['expiresAt'] = expiresAt;
  if (packed !== null) {
    patch['audioParts'] = audioParts;
    patch['audioContentType'] = audioContentType;
  }
  await updateDoc(doc(db, 'shares', id), patch);
  if (extraDoc.length + extraAudio.length > 0) {
    await commitParts(id, [], [...extraDoc, ...extraAudio]);
  }

  const expiresAtMs = expiresAt === null ? await readExpiry(id) : expiresAt.toMillis();
  return {
    shareId: id,
    expiresAtMs,
    docParts: docParts.length,
    audioParts,
  };
}

function splitDocOnly(docState: DocState): string[] {
  return packShare(docState, null, null).docParts;
}

function numberField(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

async function readExpiry(shareId: string): Promise<number> {
  const db = await hostingDb();
  if (db === null) throw new HostUnconfiguredError();
  const snap = await getDoc(doc(db, 'shares', shareId));
  const expiresAt = snap.data()?.['expiresAt'];
  if (!(expiresAt instanceof Timestamp)) throw new ShareUnavailableError();
  return expiresAt.toMillis();
}
