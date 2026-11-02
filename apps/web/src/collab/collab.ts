import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import type {
  Annotation,
  DocComment,
  Formation,
  FormationPosition,
  Performance,
  Performer,
  StageCaption,
  StageFixture,
  StageProp,
} from '@gridstage/shared-types';
import { undoOverride, useEditor } from '../state/store';
import type { DocState, PositionMap } from '../state/store';
import { getLocalUser } from '../state/user';
import { getAudioElement } from '../audio/audioPlayer';

/**
 * Realtime collaboration: mirrors the Zustand doc into a Y.Doc synced over
 * y-websocket.
 *
 * Granularity is one Y.Map entry per entity (performer / formation /
 * position / comment), so two people editing different dancers merge
 * cleanly; concurrent edits to the SAME entity resolve last-writer-wins.
 *
 * Local Zustand mutations → diffed into Y inside a LOCAL_ORIGIN transaction.
 * Remote Y updates → rebuilt into a DocState and setState'd (guarded so the
 * store subscription doesn't echo it back).
 */

const LOCAL_ORIGIN = 'gridstage-local';
const POSITION_KEY_SEP = ':';

export interface RemotePeer {
  clientId: number;
  name: string;
  color: string;
  /** Stage-meter cursor, null when the pointer is off the stage. */
  cursor: { x: number; y: number } | null;
  selectedPerformerIds: string[];
  /** The peer's playhead + selected formation (for follow mode). */
  view: { playheadMs: number; formationId: string } | null;
}

interface CollabSession {
  room: string;
  ydoc: Y.Doc;
  provider: WebsocketProvider;
  undoManager: Y.UndoManager;
  unsubscribeStore: () => void;
}

let session: CollabSession | null = null;
let applyingRemote = false;
/** Bumped on every awareness change; cheap way for React to re-render peers. */
let peersVersion = 0;
let peersListeners: (() => void)[] = [];
let cachedPeers: RemotePeer[] = [];

export function collabRoom(): string | null {
  return session?.room ?? null;
}

export function isCollabActive(): boolean {
  return session !== null;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const ka = Object.keys(a as Record<string, unknown>);
  const kb = Object.keys(b as Record<string, unknown>);
  if (ka.length !== kb.length) return false;
  return ka.every((k) =>
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

/** Make a Y.Map mirror a plain record: set changed keys, delete missing ones. */
function syncMapFromRecord(ymap: Y.Map<unknown>, record: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(record)) {
    if (!deepEqual(ymap.get(key), value)) ymap.set(key, value);
  }
  for (const key of [...ymap.keys()]) {
    if (!(key in record)) ymap.delete(key);
  }
}

function docToRecords(s: DocState): {
  meta: Record<string, unknown>;
  performers: Record<string, unknown>;
  props: Record<string, unknown>;
  formations: Record<string, unknown>;
  positions: Record<string, unknown>;
  comments: Record<string, unknown>;
  annotations: Record<string, unknown>;
  fixtures: Record<string, unknown>;
  captions: Record<string, unknown>;
} {
  const positions: Record<string, unknown> = {};
  for (const [fid, byPerformer] of Object.entries(s.positions)) {
    for (const [pid, pos] of Object.entries(byPerformer)) {
      positions[`${fid}${POSITION_KEY_SEP}${pid}`] = pos;
    }
  }
  return {
    meta: { ...s.performance } as unknown as Record<string, unknown>,
    performers: Object.fromEntries(s.performers.map((p) => [p.id, p])),
    props: Object.fromEntries(s.props.map((p) => [p.id, p])),
    formations: Object.fromEntries(s.formations.map((f) => [f.id, f])),
    positions,
    comments: Object.fromEntries(s.comments.map((c) => [c.id, c])),
    annotations: Object.fromEntries(s.annotations.map((a) => [a.id, a])),
    fixtures: Object.fromEntries((s.fixtures ?? []).map((piece) => [piece.id, piece])),
    captions: Object.fromEntries((s.captions ?? []).map((piece) => [piece.id, piece])),
  };
}

function writeDocToY(ydoc: Y.Doc, s: DocState): void {
  const records = docToRecords(s);
  ydoc.transact(() => {
    syncMapFromRecord(ydoc.getMap('meta'), records.meta);
    syncMapFromRecord(ydoc.getMap('performers'), records.performers);
    syncMapFromRecord(ydoc.getMap('props'), records.props);
    syncMapFromRecord(ydoc.getMap('formations'), records.formations);
    syncMapFromRecord(ydoc.getMap('positions'), records.positions);
    syncMapFromRecord(ydoc.getMap('comments'), records.comments);
    syncMapFromRecord(ydoc.getMap('annotations'), records.annotations);
    syncMapFromRecord(ydoc.getMap('fixtures'), records.fixtures);
    syncMapFromRecord(ydoc.getMap('captions'), records.captions);
  }, LOCAL_ORIGIN);
}

function readDocFromY(ydoc: Y.Doc): DocState | null {
  const meta = Object.fromEntries(ydoc.getMap('meta').entries()) as unknown as Performance;
  const formations = [...ydoc.getMap('formations').values()] as Formation[];
  if (formations.length === 0 || typeof meta.id !== 'string') return null;
  const performers = [...ydoc.getMap('performers').values()] as Performer[];
  const positions: PositionMap = {};
  for (const f of formations) positions[f.id] = {};
  for (const [key, value] of ydoc.getMap('positions').entries()) {
    const sep = key.indexOf(POSITION_KEY_SEP);
    const fid = key.slice(0, sep);
    if (positions[fid] !== undefined) {
      positions[fid][key.slice(sep + 1)] = value as FormationPosition;
    }
  }
  const comments = ([...ydoc.getMap('comments').values()] as DocComment[]).sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  return {
    performance: meta,
    performers,
    props: [...ydoc.getMap('props').values()] as StageProp[],
    formations: [...formations].sort((a, b) => a.orderIndex - b.orderIndex),
    positions,
    comments,
    annotations: [...ydoc.getMap('annotations').values()] as Annotation[],
    fixtures: [...ydoc.getMap('fixtures').values()] as StageFixture[],
    captions: [...ydoc.getMap('captions').values()] as StageCaption[],
  };
}

function applyYToStore(ydoc: Y.Doc): void {
  const doc = readDocFromY(ydoc);
  if (doc === null) return;
  applyingRemote = true;
  try {
    useEditor.setState(doc);
  } finally {
    applyingRemote = false;
  }
}

function refreshPeers(provider: WebsocketProvider): void {
  const local = provider.awareness.clientID;
  const peers: RemotePeer[] = [];
  for (const [clientId, state] of provider.awareness.getStates()) {
    if (clientId === local) continue;
    const user = (state as Record<string, unknown>)['user'] as
      { name?: string; color?: string } | undefined;
    const cursor = (state as Record<string, unknown>)['cursor'] as RemotePeer['cursor'] | undefined;
    const selection = (state as Record<string, unknown>)['selection'] as string[] | undefined;
    const view = (state as Record<string, unknown>)['view'] as RemotePeer['view'] | undefined;
    peers.push({
      clientId,
      name: user?.name ?? 'Guest',
      color: user?.color ?? '#9a8f82',
      cursor: cursor ?? null,
      selectedPerformerIds: selection ?? [],
      view: view ?? null,
    });
  }
  cachedPeers = peers;
  peersVersion++;
  for (const listener of peersListeners) listener();
  applyFollowedView();
}

// ---- Follow mode: mirror one peer's playhead + selected formation. -------

let followedPeer: number | null = null;

export function followedPeerId(): number | null {
  return followedPeer;
}

/** Toggle following a peer (null = stop). Following applies their view live. */
export function setFollowPeer(clientId: number | null): void {
  followedPeer = clientId;
  peersVersion++;
  for (const listener of peersListeners) listener();
  applyFollowedView();
}

function applyFollowedView(): void {
  if (followedPeer === null) return;
  const peer = cachedPeers.find((p) => p.clientId === followedPeer);
  if (peer === undefined) {
    // The peer left the session — stop following quietly.
    followedPeer = null;
    return;
  }
  const view = peer.view;
  if (view === null) return;
  const s = useEditor.getState();
  if (
    view.formationId !== s.selectedFormationId &&
    s.formations.some((f) => f.id === view.formationId)
  ) {
    s.selectFormation(view.formationId);
  }
  if (Math.abs(s.playheadMs - view.playheadMs) > 40) {
    s.setPlayhead(view.playheadMs);
    const audio = getAudioElement();
    if (audio !== null && Math.abs(audio.currentTime * 1000 - view.playheadMs) > 250) {
      audio.currentTime = view.playheadMs / 1000;
    }
  }
}

/** React 18 external-store contract: subscribe + versioned snapshot. */
export const peersStore = {
  subscribe(listener: () => void): () => void {
    peersListeners.push(listener);
    return () => {
      peersListeners = peersListeners.filter((l) => l !== listener);
    };
  },
  getSnapshot(): number {
    return peersVersion;
  },
  getPeers(): RemotePeer[] {
    return cachedPeers;
  },
};

export function setAwarenessCursor(cursor: { x: number; y: number } | null): void {
  session?.provider.awareness.setLocalStateField('cursor', cursor);
}

export function setAwarenessUser(name: string, color: string): void {
  session?.provider.awareness.setLocalStateField('user', { name, color });
}

function collabUrl(): string {
  const fromEnv = import.meta.env['VITE_COLLAB_URL'] as string | undefined;
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  // Dev default: local collab server. Behind nginx it's /collab on same host.
  return import.meta.env.DEV ? 'ws://localhost:1234' : `${proto}://${window.location.host}/collab`;
}

export function startCollab(room: string): void {
  if (session !== null) return;

  const ydoc = new Y.Doc();
  const provider = new WebsocketProvider(collabUrl(), room, ydoc);

  const shared = [
    ydoc.getMap('meta'),
    ydoc.getMap('performers'),
    ydoc.getMap('props'),
    ydoc.getMap('formations'),
    ydoc.getMap('positions'),
    ydoc.getMap('comments'),
    ydoc.getMap('annotations'),
    ydoc.getMap('fixtures'),
    ydoc.getMap('captions'),
  ];
  const undoManager = new Y.UndoManager(shared, {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
  });

  const user = getLocalUser();
  provider.awareness.setLocalStateField('user', { name: user.name, color: user.color });
  provider.awareness.on('change', () => refreshPeers(provider));

  // Selection is shared so peers can see what you're working on.
  let lastSelection: string[] = [];
  // View (playhead + formation) is shared for follow mode. The playhead
  // changes every animation frame during playback, so coalesce sends:
  // a trailing-edge timer always broadcasts the LATEST state.
  let lastView = { playheadMs: -1, formationId: '' };
  let viewTimer: number | null = null;

  const unsubscribeStore = useEditor.subscribe((s, prev) => {
    if (applyingRemote) return;
    if (s.selectedPerformerIds !== lastSelection) {
      lastSelection = s.selectedPerformerIds;
      provider.awareness.setLocalStateField('selection', s.selectedPerformerIds);
    }
    if (
      (s.playheadMs !== lastView.playheadMs || s.selectedFormationId !== lastView.formationId) &&
      viewTimer === null
    ) {
      viewTimer = window.setTimeout(() => {
        viewTimer = null;
        if (session === null) return; // fired after stopCollab
        const current = useEditor.getState();
        lastView = { playheadMs: current.playheadMs, formationId: current.selectedFormationId };
        provider.awareness.setLocalStateField('view', lastView);
      }, 120);
    }
    // Only push when some doc part actually changed (reference check).
    if (
      s.performance === prev.performance &&
      s.performers === prev.performers &&
      s.formations === prev.formations &&
      s.positions === prev.positions &&
      s.comments === prev.comments &&
      s.annotations === prev.annotations &&
      s.props === prev.props &&
      s.fixtures === prev.fixtures &&
      s.captions === prev.captions
    ) {
      return;
    }
    writeDocToY(ydoc, s);
  });

  ydoc.on('update', (_update: Uint8Array, origin: unknown) => {
    if (origin !== LOCAL_ORIGIN) applyYToStore(ydoc);
  });

  provider.once('sync', () => {
    const remote = readDocFromY(ydoc);
    if (remote === null) {
      // Fresh room: seed it with the local document.
      writeDocToY(ydoc, useEditor.getState());
    } else {
      // Existing room wins. Keep a backup of the local doc first.
      try {
        const localDoc = localStorage.getItem('gridstage-doc');
        if (localDoc !== null) localStorage.setItem('gridstage-doc-backup', localDoc);
      } catch {
        // backup is best-effort
      }
      applyYToStore(ydoc);
    }
  });

  undoOverride.undo = () => undoManager.undo();
  undoOverride.redo = () => undoManager.redo();

  session = { room, ydoc, provider, undoManager, unsubscribeStore };
}

export function stopCollab(): void {
  if (session === null) return;
  followedPeer = null;
  undoOverride.undo = null;
  undoOverride.redo = null;
  session.unsubscribeStore();
  session.undoManager.destroy();
  session.provider.destroy();
  session.ydoc.destroy();
  session = null;
  cachedPeers = [];
  peersVersion++;
  for (const listener of peersListeners) listener();
}
