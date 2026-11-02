import { useEditor } from './store';
import type { DocState } from './store';
import { safeFilename } from '../export/filename';
import { recordExport } from './backupNudge';
import { importDocIntoLibrary } from './library';
import { isCollabActive } from '../collab/collab';

/**
 * Choreography file export/import — a plain JSON snapshot of one DocState,
 * the same shape the library slots store. Lets users share a doc without a
 * server and keep browser-independent backups.
 *
 * ponytail: media blobs (audio, stage background) live in IndexedDB and are
 * NOT in the file; the UI says so. Bundling them (zip) is the known upgrade.
 */

/** Pure: doc -> pretty JSON (stable field order comes from the object). */
export function serializeDoc(doc: DocState): string {
  return JSON.stringify(doc, null, 2);
}

/**
 * Pure: parse + validate a choreography file. Returns a normalized DocState
 * (missing optional collections defaulted, mirroring the persist merge in
 * store.ts) or null when the text is not a GridStage document.
 */
export function parseDocFile(text: string): DocState | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const d = raw as Partial<DocState>;
  const perf = d.performance;
  if (
    typeof perf !== 'object' ||
    perf === null ||
    typeof perf.id !== 'string' ||
    typeof perf.title !== 'string' ||
    typeof perf.stageWidth !== 'number' ||
    typeof perf.stageHeight !== 'number'
  ) {
    return null;
  }
  if (!Array.isArray(d.performers) || !Array.isArray(d.formations)) return null;
  if (typeof d.positions !== 'object' || d.positions === null || Array.isArray(d.positions)) {
    return null;
  }
  return {
    performance: {
      ...perf,
      sections: perf.sections ?? [],
      countSegments: perf.countSegments ?? [],
    },
    performers: d.performers,
    props: Array.isArray(d.props) ? d.props : [],
    formations: d.formations,
    positions: d.positions,
    comments: Array.isArray(d.comments) ? d.comments : [],
    annotations: Array.isArray(d.annotations) ? d.annotations : [],
    fixtures: Array.isArray(d.fixtures) ? d.fixtures : [],
    captions: Array.isArray(d.captions) ? d.captions : [],
  };
}

/**
 * Pure: download name for a doc. Single-segment `.gridstage` (not
 * `.gridstage.json`) because Windows file associations only look at the last
 * suffix — we can own `.gridstage`, we must never claim `.json`.
 */
export function docFileName(title: string): string {
  return `${safeFilename(title)}.gridstage`;
}

function activeDocSnapshot(): DocState {
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

/** Download the open document as `<title>.gridstage`. */
export function exportActiveDocFile(): void {
  const doc = activeDocSnapshot();
  const url = URL.createObjectURL(new Blob([serializeDoc(doc)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = docFileName(doc.performance.title);
  a.click();
  URL.revokeObjectURL(url);
  recordExport(); // quiets the backup nudge for a week
}

/** True when this browser can hand a choreography file to the share sheet. */
export function canShareDocFile(): boolean {
  const probe = new File(['{}'], 'probe.gridstage', { type: 'application/json' });
  return typeof navigator.canShare === 'function' && navigator.canShare({ files: [probe] });
}

/** Open the system share sheet with the current doc (phones/tablets). */
export async function shareActiveDocFile(): Promise<void> {
  const doc = activeDocSnapshot();
  const file = new File([serializeDoc(doc)], docFileName(doc.performance.title), {
    type: 'application/json',
  });
  try {
    await navigator.share({ files: [file], title: doc.performance.title });
    recordExport();
  } catch (err) {
    // Closing the share sheet rejects with AbortError — that is not a failure.
    if (err instanceof DOMException && err.name === 'AbortError') return;
    throw err;
  }
}

/**
 * Import a choreography file from raw text — the shared entry for every
 * non-picker path (desktop "open with", Android share target). Returns false
 * when the text is not a GridStage document or a live-collab session is open
 * (switching docs mid-session would corrupt the shared Yjs doc).
 */
export function importDocText(text: string): boolean {
  if (isCollabActive()) return false;
  const doc = parseDocFile(text);
  if (doc === null) return false;
  importDocIntoLibrary(doc);
  return true;
}
