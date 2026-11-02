import { create } from 'zustand';
import {
  deleteAudioForDoc,
  getAudioBlob,
  primeAudioForDoc,
  switchAudioToDoc,
} from '../audio/audioPlayer';
import { saveActiveDoc } from '../state/library';
import { useEditor } from '../state/store';
import type { DocState } from '../state/store';
import { useReadOnly } from '../state/viewMode';
import { loadFirebaseConfig, waitForAuth } from './firebase';
import {
  HostUnconfiguredError,
  publishShare,
  renewShare,
  saveHostedEdits,
  ShareUnavailableError,
  withdrawShare,
} from './shareRemote';
import { loadShare } from './shareRemote';
import type { PublishedShare, ShareDurationDays } from './shareRemote';

const MEMORY_KEY = 'gridstage-hosted-shares';
const SAVE_DELAY_MS = 2000;

export interface HostedState {
  shareId: string | null;
  editorUid: string | null;
  expiresAtMs: number | null;
  performanceId: string | null;
  docParts: number;
  audioParts: number;
  canEdit: boolean;
  saveState: 'idle' | 'saving' | 'saved' | 'error';
}

export const useHosted = create<HostedState>(() => ({
  shareId: null,
  editorUid: null,
  expiresAtMs: null,
  performanceId: null,
  docParts: 0,
  audioParts: 0,
  canEdit: false,
  saveState: 'idle',
}));

interface MemoryMap {
  [performanceId: string]: string;
}

function readMemory(): MemoryMap {
  try {
    const raw = localStorage.getItem(MEMORY_KEY);
    return raw === null ? {} : (JSON.parse(raw) as MemoryMap);
  } catch {
    return {};
  }
}

export function rememberedShareId(performanceId: string): string | null {
  return readMemory()[performanceId] ?? null;
}

export function rememberShare(performanceId: string, shareId: string): void {
  const map = readMemory();
  map[performanceId] = shareId;
  localStorage.setItem(MEMORY_KEY, JSON.stringify(map));
}

export function forgetShare(performanceId: string): void {
  const map = readMemory();
  delete map[performanceId];
  localStorage.setItem(MEMORY_KEY, JSON.stringify(map));
}

export function sharePageUrl(shareId: string): string {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('share', shareId);
  return url.toString();
}

function currentDoc(): DocState {
  const state = useEditor.getState();
  return {
    performance: state.performance,
    performers: state.performers,
    props: state.props,
    formations: state.formations,
    positions: state.positions,
    comments: state.comments,
    annotations: state.annotations,
  };
}

let unsubscribe: (() => void) | null = null;
let timer: number | null = null;
let lastFingerprint = '';
let lastAudio: Blob | null = null;
let tail: Promise<void> = Promise.resolve();
let opening: Promise<void> | null = null;

function fingerprint(doc: DocState): string {
  return JSON.stringify(doc);
}

export function bindHostedSession(published: PublishedShare, performanceId: string): void {
  unbindHostedSession();
  lastFingerprint = fingerprint(currentDoc());
  lastAudio = getAudioBlob();
  useHosted.setState({
    shareId: published.shareId,
    performanceId,
    docParts: published.docParts,
    audioParts: published.audioParts,
    expiresAtMs: published.expiresAtMs,
    canEdit: true,
    saveState: 'saved',
  });
  unsubscribe = useEditor.subscribe(() => scheduleHostedSave());
  document.addEventListener('visibilitychange', onHide);
}

export function unbindHostedSession(): void {
  if (timer !== null) window.clearTimeout(timer);
  timer = null;
  unsubscribe?.();
  unsubscribe = null;
  document.removeEventListener('visibilitychange', onHide);
  useHosted.setState({ canEdit: false, saveState: 'idle' });
}

function onHide(): void {
  if (document.visibilityState === 'hidden') void flushHostedSave();
}

function scheduleHostedSave(): void {
  if (!useHosted.getState().canEdit) return;
  if (timer !== null) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    timer = null;
    void flushHostedSave();
  }, SAVE_DELAY_MS);
}

export function flushHostedSave(): Promise<void> {
  tail = tail.then(pushEdits, pushEdits);
  return tail;
}

async function pushEdits(): Promise<void> {
  const hosted = useHosted.getState();
  if (!hosted.canEdit || hosted.shareId === null || hosted.performanceId === null) return;
  const doc = currentDoc();
  if (doc.performance.id !== hosted.performanceId) return;
  const audio = getAudioBlob();
  const nextFingerprint = fingerprint(doc);
  const audioChanged = audio !== lastAudio;
  if (nextFingerprint === lastFingerprint && !audioChanged) return;
  useHosted.setState({ saveState: 'saving' });
  try {
    const published = await saveHostedEdits({
      shareId: hosted.shareId,
      doc,
      audio: audioChanged
        ? {
            mode: 'set',
            bytes: audio === null ? null : new Uint8Array(await audio.arrayBuffer()),
            contentType: audio?.type || null,
          }
        : { mode: 'keep' },
    });
    lastFingerprint = nextFingerprint;
    lastAudio = audio;
    useHosted.setState({
      saveState: 'saved',
      docParts: published.docParts,
      audioParts: published.audioParts,
      expiresAtMs: published.expiresAtMs,
    });
  } catch {
    useHosted.setState({ saveState: 'error' });
  }
}

export async function publishCurrentDoc(
  durationDays: ShareDurationDays,
  onProgress?: (done: number, total: number) => void,
): Promise<string> {
  const doc = currentDoc();
  const published = await publishShare({
    existingShareId: rememberedShareId(doc.performance.id) ?? useHosted.getState().shareId,
    doc,
    audio: getAudioBlob(),
    durationDays,
    onProgress,
  });
  rememberShare(doc.performance.id, published.shareId);
  const url = new URL(window.location.href);
  url.searchParams.set('share', published.shareId);
  window.history.replaceState(null, '', url);
  useHosted.setState({ editorUid: (await waitForAuth())?.uid ?? useHosted.getState().editorUid });
  bindHostedSession(published, doc.performance.id);
  useReadOnly.getState().setHostedReadOnly(false);
  return sharePageUrl(published.shareId);
}

export async function renewCurrentShare(durationDays: ShareDurationDays): Promise<void> {
  const hosted = useHosted.getState();
  if (hosted.shareId === null || hosted.performanceId === null) return;
  const expiresAtMs = await renewShare(hosted.shareId, durationDays);
  useHosted.setState({ expiresAtMs, canEdit: true });
  useReadOnly.getState().setHostedReadOnly(false);
  bindHostedSession(
    {
      shareId: hosted.shareId,
      expiresAtMs,
      docParts: hosted.docParts,
      audioParts: hosted.audioParts,
    },
    hosted.performanceId,
  );
}

export async function withdrawCurrentShare(): Promise<void> {
  const hosted = useHosted.getState();
  if (hosted.shareId === null) return;
  await withdrawShare(hosted.shareId, hosted.docParts, hosted.audioParts);
  if (hosted.performanceId !== null) forgetShare(hosted.performanceId);
  unbindHostedSession();
  useHosted.setState({
    shareId: null,
    editorUid: null,
    expiresAtMs: null,
    performanceId: null,
    docParts: 0,
    audioParts: 0,
  });
  const url = new URL(window.location.href);
  url.searchParams.delete('share');
  window.history.replaceState(null, '', url);
  useReadOnly.getState().setHostedReadOnly(false);
}

/** Open `?share=`. One in-flight load survives React StrictMode's double mount. */
export function openHostedShare(shareId: string): Promise<void> {
  if (opening === null) opening = loadIntoEditor(shareId);
  return opening;
}

async function loadIntoEditor(shareId: string): Promise<void> {
  if ((await loadFirebaseConfig()) === null) throw new HostUnconfiguredError();
  const user = await waitForAuth();
  const loaded = await loadShare(shareId);
  const local = useEditor.getState();
  const hasLocalWork =
    local.performance.id !== loaded.doc.performance.id &&
    (local.performers.length > 0 ||
      local.formations.length > 1 ||
      local.comments.length > 0 ||
      local.props.length > 0 ||
      local.annotations.length > 0);
  if (hasLocalWork) saveActiveDoc();
  if (loaded.audio !== null) {
    const copy = new Uint8Array(loaded.audio.byteLength);
    copy.set(loaded.audio);
    await primeAudioForDoc(
      loaded.doc.performance.id,
      new Blob([copy.buffer], { type: loaded.audioContentType ?? 'audio/mpeg' }),
    );
  } else {
    await deleteAudioForDoc(loaded.doc.performance.id);
  }
  useEditor.getState().loadDoc(loaded.doc);
  await switchAudioToDoc(loaded.doc.performance.id);
  const live = loaded.expiresAtMs > Date.now();
  const canEdit = user !== null && user.uid === loaded.editorUid && live;
  useHosted.setState({
    shareId,
    editorUid: loaded.editorUid,
    expiresAtMs: loaded.expiresAtMs,
    performanceId: loaded.doc.performance.id,
    docParts: loaded.docParts,
    audioParts: loaded.audioParts,
    canEdit: false,
    saveState: 'idle',
  });
  useReadOnly.getState().setHostedReadOnly(!canEdit);
  rememberShare(loaded.doc.performance.id, shareId);
  if (canEdit) {
    bindHostedSession(
      {
        shareId,
        expiresAtMs: loaded.expiresAtMs,
        docParts: loaded.docParts,
        audioParts: loaded.audioParts,
      },
      loaded.doc.performance.id,
    );
  }
}

export { HostUnconfiguredError, ShareUnavailableError };
