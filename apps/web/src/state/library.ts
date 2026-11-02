import { createInitialDoc, useEditor } from './store';
import type { DocState } from './store';
import { copyAudioBetweenDocs, deleteAudioForDoc } from '../audio/audioPlayer';
import { copyBackgroundBetweenDocs, deleteBackgroundForDoc } from './stageBackground';

/**
 * Choreography library — many documents in one browser.
 *
 * The OPEN document keeps living in zustand-persist's `gridstage-doc` key
 * (saved continuously, as before). The library adds one slot per document
 * (`gridstage-doc:<performanceId>`) plus a small index of metadata. Switching
 * saves the open doc into its slot, then loads the target via store.loadDoc.
 */

export interface LibraryEntry {
  id: string;
  title: string;
  updatedAt: string;
  tags: string[];
  archived: boolean;
}

const INDEX_KEY = 'gridstage-library';

const docKey = (id: string): string => `gridstage-doc:${id}`;

function readIndex(): LibraryEntry[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    return raw === null ? [] : (JSON.parse(raw) as LibraryEntry[]);
  } catch {
    return [];
  }
}

function writeIndex(entries: readonly LibraryEntry[]): void {
  localStorage.setItem(INDEX_KEY, JSON.stringify(entries));
}

function currentDoc(): DocState {
  const s = useEditor.getState();
  return {
    performance: s.performance,
    performers: s.performers,
    props: s.props,
    formations: s.formations,
    positions: s.positions,
    comments: s.comments,
    annotations: s.annotations,
    fixtures: s.fixtures,
    captions: s.captions,
  };
}

/** Pure: clone a doc under a new performance id (library "duplicate"). */
export function cloneDocAs(doc: DocState, newId: string, newTitle: string): DocState {
  return {
    ...doc,
    performance: { ...doc.performance, id: newId, title: newTitle },
    formations: doc.formations.map((f) => ({ ...f, performanceId: newId })),
    props: (doc.props ?? []).map((p) => ({ ...p, performanceId: newId })),
    annotations: (doc.annotations ?? []).map((a) => ({ ...a, performanceId: newId })),
    fixtures: doc.fixtures ?? [],
    captions: doc.captions ?? [],
  };
}

/** Write the open document into its library slot and refresh its index entry. */
export function saveActiveDoc(): void {
  const doc = currentDoc();
  localStorage.setItem(docKey(doc.performance.id), JSON.stringify(doc));
  const entries = readIndex();
  const existing = entries.find((e) => e.id === doc.performance.id);
  const entry: LibraryEntry = {
    id: doc.performance.id,
    title: doc.performance.title,
    updatedAt: new Date().toISOString(),
    tags: existing?.tags ?? [],
    archived: existing?.archived ?? false,
  };
  writeIndex([entry, ...entries.filter((e) => e.id !== entry.id)]);
}

/** Newest first (saveActiveDoc keeps the index in recency order). */
export function listLibrary(): LibraryEntry[] {
  return readIndex();
}

/** Save the open doc, then switch to the given one. False if the slot is gone. */
export function openDoc(id: string): boolean {
  const raw = localStorage.getItem(docKey(id));
  if (raw === null) return false;
  let doc: DocState;
  try {
    doc = JSON.parse(raw) as DocState;
  } catch {
    return false;
  }
  saveActiveDoc();
  useEditor.getState().loadDoc(doc);
  saveActiveDoc(); // bump the newly opened doc to the top of the index
  return true;
}

/** Save the open doc, then start a fresh one (already indexed). */
export function createDoc(options?: {
  title?: string;
  stageWidth?: number;
  stageHeight?: number;
}): void {
  saveActiveDoc();
  const doc = createInitialDoc();
  const clampM = (v: number): number => Math.min(60, Math.max(2, v));
  if (options?.title !== undefined && options.title.trim() !== '') {
    doc.performance.title = options.title.trim();
  }
  if (options?.stageWidth !== undefined) doc.performance.stageWidth = clampM(options.stageWidth);
  if (options?.stageHeight !== undefined) doc.performance.stageHeight = clampM(options.stageHeight);
  useEditor.getState().loadDoc(doc);
  saveActiveDoc();
}

/** Copy a document (and its audio) into a new library slot; stays closed. */
export function duplicateDoc(id: string, newTitle: string): void {
  if (id === useEditor.getState().performance.id) saveActiveDoc();
  const raw = localStorage.getItem(docKey(id));
  if (raw === null) return;
  const source = JSON.parse(raw) as DocState;
  const copy = cloneDocAs(source, crypto.randomUUID(), newTitle);
  localStorage.setItem(docKey(copy.performance.id), JSON.stringify(copy));
  const sourceEntry = readIndex().find((e) => e.id === id);
  writeIndex([
    {
      id: copy.performance.id,
      title: newTitle,
      updatedAt: new Date().toISOString(),
      tags: sourceEntry?.tags ?? [],
      archived: false,
    },
    ...readIndex(),
  ]);
  void copyAudioBetweenDocs(id, copy.performance.id);
  void copyBackgroundBetweenDocs(id, copy.performance.id);
}

/**
 * Add an imported document to the library and open it. Always clones under a
 * fresh id: no collision handling needed, and re-importing a backup can never
 * overwrite an existing doc.
 */
export function importDocIntoLibrary(doc: DocState): void {
  saveActiveDoc();
  const copy = cloneDocAs(doc, crypto.randomUUID(), doc.performance.title);
  localStorage.setItem(docKey(copy.performance.id), JSON.stringify(copy));
  writeIndex([
    {
      id: copy.performance.id,
      title: copy.performance.title,
      updatedAt: new Date().toISOString(),
      tags: [],
      archived: false,
    },
    ...readIndex(),
  ]);
  useEditor.getState().loadDoc(copy);
  saveActiveDoc();
}

/** Remove a CLOSED document; the UI never offers this for the open one. */
export function deleteDoc(id: string): void {
  localStorage.removeItem(docKey(id));
  writeIndex(readIndex().filter((e) => e.id !== id));
  void deleteAudioForDoc(id);
  void deleteBackgroundForDoc(id);
}

export function setDocTags(id: string, tags: string[]): void {
  writeIndex(readIndex().map((e) => (e.id === id ? { ...e, tags } : e)));
}

export function setDocArchived(id: string, archived: boolean): void {
  writeIndex(readIndex().map((e) => (e.id === id ? { ...e, archived } : e)));
}
