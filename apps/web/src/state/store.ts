import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  Annotation,
  CountSegment,
  DocComment,
  Formation,
  FormationPosition,
  Performance,
  Performer,
  PositionMarker,
  PropKind,
  StageCaption,
  StageFixture,
  StageProp,
} from '@gridstage/shared-types';
import {
  DEFAULT_FORMATION_DURATION_MS,
  DEFAULT_STAGE_HEIGHT_M,
  DEFAULT_STAGE_WIDTH_M,
  DEFAULT_TRANSITION_MS,
  isPerformerActive,
  PERFORMER_COLORS,
} from '@gridstage/shared-types';
import { planTransition } from '@gridstage/path-planner';
import { messages } from '../i18n';
import { reindexByStart } from './formationOrder';
import {
  alignSpots,
  distributeSpots,
  mirrorAcrossX,
  rotateSpots,
  stretchSpots,
} from './formationTransform';
import type { Spot } from './formationTransform';
import { byOrder } from './interpolate';
import { newProp } from './props';
import { templateSpots } from './templates';
import type { TemplateKind } from './templates';
import type { RosterRow } from './csv';

/** positions[formationId][performerId] = FormationPosition */
export type PositionMap = Record<string, Record<string, FormationPosition>>;

export interface DocState {
  performance: Performance;
  performers: Performer[];
  /** Stage props; their per-formation positions live in `positions` too. */
  props: StageProp[];
  formations: Formation[];
  positions: PositionMap;
  comments: DocComment[];
  /** Rehearsal notes (pen strokes, text pins) drawn per formation. */
  annotations: Annotation[];
  /** Fixed set pieces (furniture). Same spot in every formation. */
  fixtures: StageFixture[];
  /** Fixed text marks. Same spot in every formation. */
  captions: StageCaption[];
}

interface EditorState extends DocState {
  selectedFormationId: string;
  selectedPerformerIds: string[];
  /** Selected prop (single-select; mutually exclusive with performers). */
  selectedPropId: string | null;
  selectedFixtureId: string | null;
  selectedCaptionId: string | null;
  playheadMs: number;
  isPlaying: boolean;
  /** Session-only playback speed multiplier, 0.5–2 (not persisted). */
  playbackRate: number;
  /** Session-only: click on every beat while playing (needs a BPM). */
  metronomeOn: boolean;
  /** Session-only: repeat the [loopStartMs, loopEndMs] range while playing. */
  loopOn: boolean;
  /** Loop posts on the timeline; null until the loop is first enabled. */
  loopStartMs: number | null;
  loopEndMs: number | null;
  /** Session-only canvas tool: draw strokes / drop pins / off. */
  annotateMode: 'off' | 'pen' | 'pin';

  setTitle: (title: string) => void;
  setStageSize: (width: number, height: number) => void;
  setBpm: (bpm: number | null) => void;
  /** Which screen edge the audience is drawn on (2D plan and exports). */
  setAudienceAt: (at: 'top' | 'bottom') => void;
  /** Opacity of the venue photo under the grid, 0–1. */
  setStageBackgroundOpacity: (opacity: number) => void;
  /** Offstage holding zones (left/right wings, backstage), meters 0–10. */
  setWings: (wings: { left: number; right: number; back: number }) => void;

  addPerformer: () => void;
  importRoster: (rows: readonly RosterRow[]) => void;
  removePerformer: (id: string) => void;
  updatePerformer: (id: string, patch: Partial<Omit<Performer, 'id' | 'performanceId'>>) => void;

  addProp: (kind: PropKind, textOnly?: boolean) => void;
  removeProp: (id: string) => void;
  updateProp: (id: string, patch: Partial<Omit<StageProp, 'id' | 'performanceId'>>) => void;
  /** Select a prop (null = deselect); clears the performer selection. */
  selectProp: (id: string | null) => void;

  addFixture: () => void;
  updateFixture: (id: string, patch: Partial<Omit<StageFixture, 'id'>>) => void;
  moveFixture: (id: string, x: number, y: number) => void;
  /** Write a resized or rotated footprint without a second undo step. */
  commitFixtureGeometry: (
    id: string,
    box: { x: number; y: number; width: number; height: number; rotation: number },
  ) => void;
  removeFixture: (id: string) => void;
  selectFixture: (id: string | null) => void;

  addCaption: () => void;
  updateCaption: (id: string, patch: Partial<Omit<StageCaption, 'id'>>) => void;
  moveCaption: (id: string, x: number, y: number) => void;
  /** Write a resized or rotated text box without a second undo step. */
  commitCaptionGeometry: (
    id: string,
    box: { x: number; y: number; width: number; height: number; rotation: number },
  ) => void;
  /**
   * Resize a formation object and write its place and angle in one formation.
   * The footprint size is shared by every formation; the place and angle are not.
   */
  commitPropGeometry: (
    id: string,
    formationId: string,
    box: { x: number; y: number; width: number; height: number; rotation: number },
  ) => void;
  removeCaption: (id: string) => void;
  selectCaption: (id: string | null) => void;

  addFormation: () => void;
  /** Insert a copy of the selected formation right after it (Ctrl+D). */
  duplicateFormation: () => void;
  removeFormation: (id: string) => void;
  /** Delete key: selected performers if any, else the selected formation. */
  deleteSelection: () => void;
  updateFormation: (
    id: string,
    patch: Partial<Omit<Formation, 'id' | 'performanceId' | 'orderIndex'>>,
  ) => void;
  moveFormation: (id: string, direction: -1 | 1) => void;
  /** Set start time and re-derive play order; records one undo step. */
  setFormationStart: (id: string, startTimeMs: number) => void;
  /** Same, but WITHOUT recording history — for continuous drag frames. */
  setFormationStartLive: (id: string, startTimeMs: number) => void;
  /** Push the current doc onto the undo stack (checkpoint before a drag). */
  pushHistory: () => void;
  /** Arrange the selected formation's performers into a template shape. */
  applyTemplate: (kind: TemplateKind) => void;
  /** Write suggested per-performer spots into the selected formation. */
  applySuggestedPositions: (spots: Record<string, { x: number; y: number }>) => void;
  /**
   * Reassign the selected formation's spots among performers so total travel
   * from the previous formation is minimal (Hungarian matching).
   */
  untangleFromPrevious: () => void;

  /** Mirror the selected formation left-right across the stage center line. */
  mirrorFormation: () => void;
  /** Swap the placement of the two selected performers (current formation). */
  swapSelected: () => void;
  /** Align selected performers onto a shared row (y) or column (x). */
  alignSelected: (axis: 'row' | 'col') => void;
  /** Evenly space selected performers between their extremes on one axis. */
  distributeSelected: (axis: 'x' | 'y') => void;
  /** Rotate the selected group around its centroid (deg clockwise, facing too). */
  rotateSelectedAsGroup: (deltaDeg: number) => void;
  /** Spread (>1) or tighten (<1) the selected group around its centroid. */
  stretchSelected: (factor: number) => void;

  setPosition: (formationId: string, performerId: string, x: number, y: number) => void;
  /** Write many positions in one undo step (video-capture drafts). */
  setPositionsBulk: (
    formationId: string,
    updates: Record<string, { x: number; y: number; rotation?: number }>,
  ) => void;
  /**
   * REPLACE the whole chart with the formations found by a whole-video scan
   * (M2) in ONE undo step — the UI asks for confirmation first. Durations
   * come from how long each formation was held in the video.
   */
  applyScanFormations: (
    results: readonly {
      startTimeMs: number;
      endTimeMs: number;
      positions: Record<string, { x: number; y: number }>;
    }[],
  ) => void;
  /** Same, but WITHOUT recording history — for continuous drag frames. */
  setPositionLive: (formationId: string, performerId: string, x: number, y: number) => void;
  setRotation: (formationId: string, performerId: string, rotation: number) => void;
  /** Set or clear (null) this performer's state marker in one formation. */
  setMarker: (formationId: string, performerId: string, marker: PositionMarker | null) => void;
  /** Set the Bézier control point for this performer's transition OUT. */
  setCurveControl: (formationId: string, performerId: string, x: number, y: number) => void;
  nudgeSelected: (dx: number, dy: number) => void;
  rotateSelected: (deltaDeg: number) => void;

  selectFormation: (id: string) => void;
  selectPerformer: (id: string, additive: boolean) => void;
  /** Replace the whole performer selection (marquee select). */
  setPerformerSelection: (ids: string[]) => void;
  clearPerformerSelection: () => void;

  /** Copy every stored position from another formation into the selected one. */
  copyPositionsFrom: (sourceFormationId: string) => void;

  /**
   * Ctrl+C: copy the selected performers' spots in the current formation to
   * the in-memory clipboard (no selection = the whole formation).
   */
  copyPositions: () => void;
  /** Ctrl+V: apply clipboard spots to the current formation. */
  pastePositions: () => void;

  /** Performer whose whole-show walk path is overlaid on the canvas (UI-only). */
  pathPerformerId: string | null;
  setPathPerformer: (id: string | null) => void;

  addBeatMarker: (ms: number) => void;
  removeBeatMarker: (ms: number) => void;

  /** Drop a named section marker at the given time; returns its new id. */
  addSection: (ms: number, name: string) => string;
  renameSection: (id: string, name: string) => void;
  removeSection: (id: string) => void;

  /** Add a counted (8-count) range. None defined = the whole piece counts from 0. */
  addCountSegment: (startMs: number, endMs: number) => void;
  updateCountSegment: (id: string, patch: Partial<Pick<CountSegment, 'startMs' | 'endMs'>>) => void;
  removeCountSegment: (id: string) => void;

  addComment: (text: string, performerId: string | null, authorName: string) => void;
  removeComment: (id: string) => void;
  /** Flip a comment's resolved flag (resolved notes collapse in the panel). */
  toggleCommentResolved: (id: string) => void;

  setPlayhead: (ms: number) => void;
  setIsPlaying: (playing: boolean) => void;
  setPlaybackRate: (rate: number) => void;
  setMetronomeOn: (on: boolean) => void;
  setLoopOn: (on: boolean) => void;
  /** Move the loop posts; enforces start ≥ 0 and a 200ms minimum length. */
  setLoopRange: (startMs: number, endMs: number) => void;
  setAnnotateMode: (mode: 'off' | 'pen' | 'pin') => void;
  addAnnotation: (a: Omit<Annotation, 'id' | 'performanceId'>) => void;
  removeAnnotation: (id: string) => void;

  /** Replace the whole document (version-history restore); undoable. */
  restoreDoc: (doc: DocState) => void;
  /**
   * Switch to another library document: NOT undoable (undo must never cross
   * documents), clears the undo/redo stacks and resets the session UI state.
   */
  loadDoc: (doc: DocState) => void;

  undo: () => void;
  redo: () => void;
}

function newId(): string {
  return crypto.randomUUID();
}

type PositionsByPerformer = Record<string, FormationPosition>;

/** Pull the given performers out of a formation as plain spots for the transforms. */
function selectedSpots(current: PositionsByPerformer, ids: readonly string[]): Spot[] {
  const spots: Spot[] = [];
  for (const id of ids) {
    const pos = current[id];
    if (pos !== undefined) spots.push({ id, x: pos.x, y: pos.y, rotation: pos.rotation });
  }
  return spots;
}

/** Write transformed spots back onto a formation's positions, leaving others untouched. */
function applySpots(current: PositionsByPerformer, spots: readonly Spot[]): PositionsByPerformer {
  const updated = { ...current };
  for (const spot of spots) {
    const existing = updated[spot.id];
    if (existing !== undefined) {
      updated[spot.id] = { ...existing, x: spot.x, y: spot.y, rotation: spot.rotation };
    }
  }
  return updated;
}

export function createInitialDoc(): DocState {
  const performanceId = newId();
  const formationId = newId();
  return {
    performance: {
      id: performanceId,
      orgId: 'local',
      title: messages().defaults.performanceTitle,
      stageWidth: DEFAULT_STAGE_WIDTH_M,
      stageHeight: DEFAULT_STAGE_HEIGHT_M,
      bpm: null,
      audioAssetId: null,
      beatMarkersMs: [],
      sections: [],
      countSegments: [],
      // Performer view: the audience sits on the top edge of the plan.
      audienceAt: 'top',
    },
    performers: [],
    props: [],
    formations: [
      {
        id: formationId,
        performanceId,
        orderIndex: 0,
        startTimeMs: 0,
        durationMs: DEFAULT_FORMATION_DURATION_MS,
        transitionType: 'linear',
        name: messages().defaults.formation(1),
      },
    ],
    positions: { [formationId]: {} },
    comments: [],
    annotations: [],
    fixtures: [],
    captions: [],
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Placeable extent including wings: x ∈ [-left, w+right], y ∈ [-back, h]. */
export function stageBounds(p: Performance): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  const wings = p.wings ?? { left: 0, right: 0, back: 0 };
  return {
    minX: -wings.left,
    maxX: p.stageWidth + wings.right,
    minY: -wings.back,
    maxY: p.stageHeight,
  };
}

const SET_COLORS = ['#8a8074', '#6e8b74', '#8b7355', '#7a6a62', '#6a7a8b'];
const CAPTION_COLOR = '#202124';

function placeOnStage(performance: Performance, x: number, y: number): { x: number; y: number } {
  const bounds = stageBounds(performance);
  return { x: clamp(x, bounds.minX, bounds.maxX), y: clamp(y, bounds.minY, bounds.maxY) };
}

/** Default spot for the index-th cast member: rows across downstage. */
function defaultSpot(
  index: number,
  stageWidth: number,
  stageHeight: number,
): { x: number; y: number } {
  const usable = Math.max(stageWidth - 3, 1);
  const step = 1.5;
  const perRow = Math.max(Math.floor(usable / step), 1);
  return {
    x: clamp(1.5 + (index % perRow) * step, 0, stageWidth),
    y: clamp(stageHeight - 1.5 - Math.floor(index / perRow) * step, 0, stageHeight),
  };
}

function snapshotDoc(s: DocState): DocState {
  return {
    performance: { ...s.performance, beatMarkersMs: [...s.performance.beatMarkersMs] },
    performers: s.performers.map((p) => ({ ...p })),
    // ?? []: version snapshots saved before props existed lack the field.
    props: (s.props ?? []).map((p) => ({ ...p })),
    formations: s.formations.map((f) => ({ ...f })),
    positions: Object.fromEntries(
      Object.entries(s.positions).map(([fid, byPerformer]) => [
        fid,
        Object.fromEntries(Object.entries(byPerformer).map(([pid, pos]) => [pid, { ...pos }])),
      ]),
    ),
    comments: s.comments.map((c) => ({ ...c })),
    // ?? []: snapshots saved before annotations existed lack the field.
    annotations: (s.annotations ?? []).map((a) => ({ ...a })),
    fixtures: (s.fixtures ?? []).map((piece) => ({ ...piece })),
    captions: (s.captions ?? []).map((piece) => ({ ...piece })),
  };
}

// Positions clipboard for Ctrl+C/Ctrl+V — session-only, keyed by performer id
// so a spot copied in one formation pastes onto the SAME performer elsewhere.
let positionsClipboard: Record<string, { x: number; y: number; rotation: number }> | null = null;

// ponytail: in-memory snapshot undo (Ctrl+Z), capped ring buffer; move to a
// structural-sharing history if doc sizes ever make this slow.
const UNDO_LIMIT = 50;
const undoStack: DocState[] = [];
const redoStack: DocState[] = [];

/**
 * Collaboration hook point: when a Yjs session is active, snapshot undo would
 * also revert other people's edits, so the collab module swaps in a
 * Y.UndoManager (which only tracks local transactions).
 */
export const undoOverride: { undo: (() => void) | null; redo: (() => void) | null } = {
  undo: null,
  redo: null,
};

export const useEditor = create<EditorState>()(
  persist(
    (set, get) => {
      /** Wraps a doc mutation so it records undo history first. */
      function mutateDoc(fn: (s: EditorState) => Partial<EditorState>): void {
        const before = snapshotDoc(get());
        undoStack.push(before);
        if (undoStack.length > UNDO_LIMIT) undoStack.shift();
        redoStack.length = 0;
        set(fn(get()) as EditorState);
      }

      const initialDoc = createInitialDoc();
      return {
        ...initialDoc,
        // Fresh sessions start with the (only) formation selected; persisted
        // docs get re-pointed by the subscribe guard below after rehydration.
        selectedFormationId: initialDoc.formations[0]?.id ?? '',
        selectedPerformerIds: [],
        selectedPropId: null,
        selectedFixtureId: null,
        selectedCaptionId: null,
        playheadMs: 0,
        isPlaying: false,
        playbackRate: 1,
        metronomeOn: false,
        loopOn: false,
        loopStartMs: null,
        loopEndMs: null,
        annotateMode: 'off',

        setTitle: (title) => mutateDoc((s) => ({ performance: { ...s.performance, title } })),

        setStageSize: (width, height) =>
          mutateDoc((s) => {
            const stageWidth = clamp(width, 2, 60);
            const stageHeight = clamp(height, 2, 60);
            // Keep every stored position on the resized stage (wings included).
            const b = stageBounds({ ...s.performance, stageWidth, stageHeight });
            const positions: PositionMap = Object.fromEntries(
              Object.entries(s.positions).map(([fid, byPerformer]) => [
                fid,
                Object.fromEntries(
                  Object.entries(byPerformer).map(([pid, pos]) => [
                    pid,
                    { ...pos, x: clamp(pos.x, b.minX, b.maxX), y: clamp(pos.y, b.minY, b.maxY) },
                  ]),
                ),
              ]),
            );
            return { performance: { ...s.performance, stageWidth, stageHeight }, positions };
          }),

        setWings: (wings) =>
          mutateDoc((s) => {
            const next = {
              left: clamp(wings.left, 0, 10),
              right: clamp(wings.right, 0, 10),
              back: clamp(wings.back, 0, 10),
            };
            const performance = { ...s.performance, wings: next };
            // Shrinking a wing pulls anyone standing there back inside.
            const b = stageBounds(performance);
            const positions: PositionMap = Object.fromEntries(
              Object.entries(s.positions).map(([fid, byPerformer]) => [
                fid,
                Object.fromEntries(
                  Object.entries(byPerformer).map(([pid, pos]) => [
                    pid,
                    { ...pos, x: clamp(pos.x, b.minX, b.maxX), y: clamp(pos.y, b.minY, b.maxY) },
                  ]),
                ),
              ]),
            );
            return { performance, positions };
          }),

        setBpm: (bpm) =>
          mutateDoc((s) => ({
            performance: { ...s.performance, bpm: bpm === null ? null : clamp(bpm, 20, 300) },
          })),

        setAudienceAt: (at) =>
          mutateDoc((s) => ({ performance: { ...s.performance, audienceAt: at } })),

        // Not undoable: a slider drag fires per tick and would flood the
        // undo stack with one step per pixel.
        setStageBackgroundOpacity: (opacity) =>
          set((s) => ({
            performance: { ...s.performance, stageBackgroundOpacity: clamp(opacity, 0, 1) },
          })),

        addPerformer: () =>
          mutateDoc((s) => {
            const index = s.performers.length;
            const performer: Performer = {
              id: newId(),
              performanceId: s.performance.id,
              name: messages().defaults.dancer(index + 1),
              color: PERFORMER_COLORS[index % PERFORMER_COLORS.length] ?? '#e8a84c',
              role: '',
              avatarUrl: null,
            };
            const spot = defaultSpot(index, s.performance.stageWidth, s.performance.stageHeight);
            const positions: PositionMap = { ...s.positions };
            for (const f of s.formations) {
              positions[f.id] = {
                ...positions[f.id],
                [performer.id]: {
                  formationId: f.id,
                  performerId: performer.id,
                  x: spot.x,
                  y: spot.y,
                  rotation: 0,
                },
              };
            }
            return {
              performers: [...s.performers, performer],
              positions,
              selectedPerformerIds: [performer.id],
            };
          }),

        importRoster: (rows) =>
          mutateDoc((s) => {
            if (rows.length === 0) return {};
            const added: Performer[] = rows.map((row, i) => ({
              id: newId(),
              performanceId: s.performance.id,
              name: row.name,
              color:
                row.color ??
                PERFORMER_COLORS[(s.performers.length + i) % PERFORMER_COLORS.length] ??
                '#e8a84c',
              role: row.role,
              avatarUrl: null,
              // Crews restore group tags; CSV rows never carry them.
              ...(row.tags !== undefined && row.tags.length > 0 ? { tags: row.tags } : {}),
            }));
            const positions: PositionMap = { ...s.positions };
            added.forEach((performer, i) => {
              const spot = defaultSpot(
                s.performers.length + i,
                s.performance.stageWidth,
                s.performance.stageHeight,
              );
              for (const f of s.formations) {
                positions[f.id] = {
                  ...positions[f.id],
                  [performer.id]: {
                    formationId: f.id,
                    performerId: performer.id,
                    x: spot.x,
                    y: spot.y,
                    rotation: 0,
                  },
                };
              }
            });
            return { performers: [...s.performers, ...added], positions };
          }),

        removePerformer: (id) =>
          mutateDoc((s) => {
            const positions: PositionMap = Object.fromEntries(
              Object.entries(s.positions).map(([fid, byPerformer]) => {
                const rest = { ...byPerformer };
                delete rest[id];
                return [fid, rest];
              }),
            );
            return {
              performers: s.performers.filter((p) => p.id !== id),
              positions,
              selectedPerformerIds: s.selectedPerformerIds.filter((pid) => pid !== id),
            };
          }),

        updatePerformer: (id, patch) =>
          mutateDoc((s) => ({
            performers: s.performers.map((p) => (p.id === id ? { ...p, ...patch } : p)),
          })),

        addProp: (kind, textOnly = false) =>
          mutateDoc((s) => {
            const prop = newProp(newId(), s.performance.id, s.props.length, kind, textOnly);
            // Center stage in every formation; drag it per formation from there.
            const positions: PositionMap = { ...s.positions };
            for (const f of s.formations) {
              positions[f.id] = {
                ...positions[f.id],
                [prop.id]: {
                  formationId: f.id,
                  performerId: prop.id,
                  x: s.performance.stageWidth / 2,
                  y: s.performance.stageHeight / 2,
                  rotation: 0,
                },
              };
            }
            return {
              props: [...s.props, prop],
              positions,
              selectedPropId: prop.id,
              selectedPerformerIds: [],
              selectedFixtureId: null,
              selectedCaptionId: null,
            };
          }),

        removeProp: (id) =>
          mutateDoc((s) => {
            const positions: PositionMap = Object.fromEntries(
              Object.entries(s.positions).map(([fid, byId]) => {
                const rest = { ...byId };
                delete rest[id];
                return [fid, rest];
              }),
            );
            return {
              props: s.props.filter((p) => p.id !== id),
              positions,
              selectedPropId: s.selectedPropId === id ? null : s.selectedPropId,
            };
          }),

        updateProp: (id, patch) =>
          mutateDoc((s) => ({
            props: s.props.map((p) => (p.id === id ? { ...p, ...patch } : p)),
          })),

        selectProp: (id) =>
          set({
            selectedPropId: id,
            selectedPerformerIds: [],
            selectedFixtureId: null,
            selectedCaptionId: null,
          }),

        addFixture: () =>
          mutateDoc((s) => {
            const spot = placeOnStage(
              s.performance,
              s.performance.stageWidth / 2,
              s.performance.stageHeight / 2,
            );
            const piece: StageFixture = {
              id: newId(),
              ...spot,
              width: 2,
              height: 1,
              label: messages().defaults.fixture(s.fixtures.length + 1),
              color: SET_COLORS[s.fixtures.length % SET_COLORS.length] ?? '#8a8074',
              shape: 'rect',
              rotation: 0,
            };
            return {
              fixtures: [...s.fixtures, piece],
              selectedFixtureId: piece.id,
              selectedCaptionId: null,
              selectedPropId: null,
              selectedPerformerIds: [],
            };
          }),

        updateFixture: (id, patch) =>
          mutateDoc((s) => ({
            fixtures: s.fixtures.map((piece) => (piece.id === id ? { ...piece, ...patch } : piece)),
          })),

        moveFixture: (id, x, y) =>
          set((s) => {
            const spot = placeOnStage(s.performance, x, y);
            return {
              fixtures: s.fixtures.map((piece) =>
                piece.id === id ? { ...piece, ...spot } : piece,
              ),
            };
          }),

        commitFixtureGeometry: (id, box) =>
          set((s) => ({
            fixtures: s.fixtures.map((piece) =>
              piece.id === id
                ? {
                    ...piece,
                    x: box.x,
                    y: box.y,
                    width: box.width,
                    height: box.height,
                    rotation: box.rotation,
                  }
                : piece,
            ),
          })),

        removeFixture: (id) =>
          mutateDoc((s) => ({
            fixtures: s.fixtures.filter((piece) => piece.id !== id),
            selectedFixtureId: s.selectedFixtureId === id ? null : s.selectedFixtureId,
          })),

        selectFixture: (id) =>
          set({
            selectedFixtureId: id,
            selectedCaptionId: null,
            selectedPropId: null,
            selectedPerformerIds: [],
          }),

        addCaption: () =>
          mutateDoc((s) => {
            const spot = placeOnStage(
              s.performance,
              s.performance.stageWidth / 2,
              s.performance.stageHeight / 2 + 1.5,
            );
            const piece: StageCaption = {
              id: newId(),
              ...spot,
              text: messages().defaults.caption(s.captions.length + 1),
              color: CAPTION_COLOR,
              shape: 'rect',
              rotation: 0,
              width: 2,
              height: 0.6,
            };
            return {
              captions: [...s.captions, piece],
              selectedCaptionId: piece.id,
              selectedFixtureId: null,
              selectedPropId: null,
              selectedPerformerIds: [],
            };
          }),

        updateCaption: (id, patch) =>
          mutateDoc((s) => ({
            captions: s.captions.map((piece) => (piece.id === id ? { ...piece, ...patch } : piece)),
          })),

        moveCaption: (id, x, y) =>
          set((s) => {
            const spot = placeOnStage(s.performance, x, y);
            return {
              captions: s.captions.map((piece) =>
                piece.id === id ? { ...piece, ...spot } : piece,
              ),
            };
          }),

        commitCaptionGeometry: (id, box) =>
          set((s) => ({
            captions: s.captions.map((piece) =>
              piece.id === id
                ? {
                    ...piece,
                    x: box.x,
                    y: box.y,
                    width: box.width,
                    height: box.height,
                    rotation: box.rotation,
                  }
                : piece,
            ),
          })),

        commitPropGeometry: (id, formationId, box) =>
          set((s) => {
            const existing = s.positions[formationId]?.[id];
            if (existing === undefined) return {};
            const rotation = ((box.rotation % 360) + 360) % 360;
            return {
              props: s.props.map((prop) =>
                prop.id === id ? { ...prop, width: box.width, height: box.height } : prop,
              ),
              positions: {
                ...s.positions,
                [formationId]: {
                  ...s.positions[formationId],
                  [id]: { ...existing, x: box.x, y: box.y, rotation },
                },
              },
            };
          }),

        removeCaption: (id) =>
          mutateDoc((s) => ({
            captions: s.captions.filter((piece) => piece.id !== id),
            selectedCaptionId: s.selectedCaptionId === id ? null : s.selectedCaptionId,
          })),

        selectCaption: (id) =>
          set({
            selectedCaptionId: id,
            selectedFixtureId: null,
            selectedPropId: null,
            selectedPerformerIds: [],
          }),

        addFormation: () =>
          mutateDoc((s) => {
            const ordered = [...s.formations].sort((a, b) => a.orderIndex - b.orderIndex);
            const last = ordered[ordered.length - 1];
            const id = newId();
            const startTimeMs =
              last !== undefined ? last.startTimeMs + last.durationMs + DEFAULT_TRANSITION_MS : 0;
            const formation: Formation = {
              id,
              performanceId: s.performance.id,
              orderIndex: ordered.length,
              startTimeMs,
              durationMs: DEFAULT_FORMATION_DURATION_MS,
              transitionType: 'linear',
              name: messages().defaults.formation(ordered.length + 1),
            };
            // New formation starts as a copy of the previous one.
            const copied: Record<string, FormationPosition> =
              last !== undefined
                ? Object.fromEntries(
                    Object.entries(s.positions[last.id] ?? {}).map(([pid, pos]) => [
                      pid,
                      { ...pos, formationId: id },
                    ]),
                  )
                : {};
            return {
              formations: [...s.formations, formation],
              positions: { ...s.positions, [id]: copied },
              selectedFormationId: id,
            };
          }),

        duplicateFormation: () =>
          mutateDoc((s) => {
            const source = s.formations.find((f) => f.id === s.selectedFormationId);
            if (source === undefined) return {};
            const id = newId();
            const startTimeMs = source.startTimeMs + source.durationMs + DEFAULT_TRANSITION_MS;
            const copied: Record<string, FormationPosition> = Object.fromEntries(
              Object.entries(s.positions[source.id] ?? {}).map(([pid, pos]) => [
                pid,
                { ...pos, formationId: id },
              ]),
            );
            const duplicate: Formation = {
              ...source,
              id,
              startTimeMs,
              orderIndex: s.formations.length,
              name: messages().defaults.formationCopy(source.name),
            };
            return {
              formations: reindexByStart([...s.formations, duplicate], id, startTimeMs),
              positions: { ...s.positions, [id]: copied },
              selectedFormationId: id,
            };
          }),

        deleteSelection: () => {
          const s = get();
          if (s.selectedFixtureId !== null) {
            get().removeFixture(s.selectedFixtureId);
            return;
          }
          if (s.selectedCaptionId !== null) {
            get().removeCaption(s.selectedCaptionId);
            return;
          }
          if (s.selectedPropId !== null) {
            get().removeProp(s.selectedPropId);
            return;
          }
          if (s.selectedPerformerIds.length > 0) {
            // One undo step no matter how many performers go.
            mutateDoc((st) => {
              const removed = new Set(st.selectedPerformerIds);
              const positions: PositionMap = Object.fromEntries(
                Object.entries(st.positions).map(([fid, byPerformer]) => {
                  const rest = { ...byPerformer };
                  for (const pid of removed) delete rest[pid];
                  return [fid, rest];
                }),
              );
              return {
                performers: st.performers.filter((p) => !removed.has(p.id)),
                positions,
                selectedPerformerIds: [],
              };
            });
            return;
          }
          get().removeFormation(s.selectedFormationId);
        },

        removeFormation: (id) =>
          mutateDoc((s) => {
            if (s.formations.length <= 1) return {};
            const remaining = s.formations
              .filter((f) => f.id !== id)
              .sort((a, b) => a.orderIndex - b.orderIndex)
              .map((f, i) => ({ ...f, orderIndex: i }));
            const positions = { ...s.positions };
            delete positions[id];
            const fallback = remaining[0];
            return {
              formations: remaining,
              positions,
              annotations: s.annotations.filter((a) => a.formationId !== id),
              selectedFormationId:
                s.selectedFormationId === id && fallback !== undefined
                  ? fallback.id
                  : s.selectedFormationId,
            };
          }),

        updateFormation: (id, patch) =>
          mutateDoc((s) => ({
            formations: s.formations.map((f) => (f.id === id ? { ...f, ...patch } : f)),
          })),

        moveFormation: (id, direction) =>
          mutateDoc((s) => {
            const ordered = [...s.formations].sort((a, b) => a.orderIndex - b.orderIndex);
            const index = ordered.findIndex((f) => f.id === id);
            const target = index + direction;
            if (index === -1 || target < 0 || target >= ordered.length) return {};
            const a = ordered[index];
            const b = ordered[target];
            if (a === undefined || b === undefined) return {};
            // Swap slots AND times so the timeline stays monotonic.
            return {
              formations: s.formations.map((f) => {
                if (f.id === a.id)
                  return { ...f, orderIndex: b.orderIndex, startTimeMs: b.startTimeMs };
                if (f.id === b.id)
                  return { ...f, orderIndex: a.orderIndex, startTimeMs: a.startTimeMs };
                return f;
              }),
            };
          }),

        setFormationStart: (id, startTimeMs) =>
          mutateDoc((s) => ({ formations: reindexByStart(s.formations, id, startTimeMs) })),

        setFormationStartLive: (id, startTimeMs) =>
          set((s) => ({ formations: reindexByStart(s.formations, id, startTimeMs) })),

        pushHistory: () => {
          undoStack.push(snapshotDoc(get()));
          if (undoStack.length > UNDO_LIMIT) undoStack.shift();
          redoStack.length = 0;
        },

        applyTemplate: (kind) =>
          mutateDoc((s) => {
            const fid = s.selectedFormationId;
            const byFormation = s.positions[fid];
            if (byFormation === undefined || s.performers.length === 0) return {};
            const spots = templateSpots(
              kind,
              s.performers.length,
              s.performance.stageWidth,
              s.performance.stageHeight,
            );
            const updated = { ...byFormation };
            s.performers.forEach((p, i) => {
              const spot = spots[i];
              const existing = updated[p.id];
              if (spot === undefined || existing === undefined) return;
              updated[p.id] = { ...existing, x: spot.x, y: spot.y };
            });
            return { positions: { ...s.positions, [fid]: updated } };
          }),

        applySuggestedPositions: (spots) =>
          mutateDoc((s) => {
            const fid = s.selectedFormationId;
            const current = s.positions[fid];
            if (current === undefined) return {};
            const updated = { ...current };
            for (const [pid, spot] of Object.entries(spots)) {
              const existing = updated[pid];
              if (existing !== undefined) updated[pid] = { ...existing, x: spot.x, y: spot.y };
            }
            return { positions: { ...s.positions, [fid]: updated } };
          }),

        untangleFromPrevious: () =>
          mutateDoc((s) => {
            const ordered = byOrder(s.formations);
            const index = ordered.findIndex((f) => f.id === s.selectedFormationId);
            const previous = index > 0 ? ordered[index - 1] : undefined;
            const current = ordered[index];
            if (previous === undefined || current === undefined) return {};
            const prevPositions = s.positions[previous.id] ?? {};
            const currPositions = s.positions[current.id] ?? {};
            const ids = s.performers
              .map((p) => p.id)
              .filter(
                (pid) => prevPositions[pid] !== undefined && currPositions[pid] !== undefined,
              );
            if (ids.length < 2) return {};
            const fromSpots = ids.map((pid) => {
              const pos = prevPositions[pid];
              return { x: pos?.x ?? 0, y: pos?.y ?? 0 };
            });
            // The formation's SPOTS (position + facing) stay fixed; who stands
            // where is what gets reshuffled.
            const spots = ids.map((pid) => currPositions[pid]);
            const { assignment } = planTransition(
              fromSpots,
              spots.map((pos) => ({ x: pos?.x ?? 0, y: pos?.y ?? 0 })),
            );
            const updated = { ...currPositions };
            ids.forEach((pid, i) => {
              const target = spots[assignment[i] ?? i];
              const existing = updated[pid];
              if (target === undefined || existing === undefined) return;
              updated[pid] = { ...existing, x: target.x, y: target.y, rotation: target.rotation };
            });
            return { positions: { ...s.positions, [current.id]: updated } };
          }),

        mirrorFormation: () =>
          mutateDoc((s) => {
            const fid = s.selectedFormationId;
            const current = s.positions[fid];
            if (current === undefined) return {};
            const spots = Object.entries(current).map(([id, pos]) => ({
              id,
              x: pos.x,
              y: pos.y,
              rotation: pos.rotation,
            }));
            const mirrored = mirrorAcrossX(spots, s.performance.stageWidth);
            return { positions: { ...s.positions, [fid]: applySpots(current, mirrored) } };
          }),

        swapSelected: () =>
          mutateDoc((s) => {
            const fid = s.selectedFormationId;
            const [idA, idB] = s.selectedPerformerIds;
            const current = s.positions[fid];
            if (idA === undefined || idB === undefined || s.selectedPerformerIds.length !== 2)
              return {};
            const a = current?.[idA];
            const b = current?.[idB];
            if (a === undefined || b === undefined) return {};
            return {
              positions: {
                ...s.positions,
                [fid]: {
                  ...current,
                  [idA]: { ...a, x: b.x, y: b.y, rotation: b.rotation },
                  [idB]: { ...b, x: a.x, y: a.y, rotation: a.rotation },
                },
              },
            };
          }),

        alignSelected: (axis) =>
          mutateDoc((s) => {
            const fid = s.selectedFormationId;
            const current = s.positions[fid];
            if (current === undefined || s.selectedPerformerIds.length < 2) return {};
            const selected = selectedSpots(current, s.selectedPerformerIds);
            if (selected.length < 2) return {};
            return {
              positions: { ...s.positions, [fid]: applySpots(current, alignSpots(selected, axis)) },
            };
          }),

        distributeSelected: (axis) =>
          mutateDoc((s) => {
            const fid = s.selectedFormationId;
            const current = s.positions[fid];
            if (current === undefined || s.selectedPerformerIds.length < 3) return {};
            const selected = selectedSpots(current, s.selectedPerformerIds);
            if (selected.length < 3) return {};
            return {
              positions: {
                ...s.positions,
                [fid]: applySpots(current, distributeSpots(selected, axis)),
              },
            };
          }),

        rotateSelectedAsGroup: (deltaDeg) =>
          mutateDoc((s) => {
            const fid = s.selectedFormationId;
            const current = s.positions[fid];
            if (current === undefined || s.selectedPerformerIds.length < 2) return {};
            const selected = selectedSpots(current, s.selectedPerformerIds);
            if (selected.length < 2) return {};
            const b = stageBounds(s.performance);
            const rotated = rotateSpots(selected, deltaDeg).map((spot) => ({
              ...spot,
              x: clamp(spot.x, b.minX, b.maxX),
              y: clamp(spot.y, b.minY, b.maxY),
            }));
            return {
              positions: { ...s.positions, [fid]: applySpots(current, rotated) },
            };
          }),

        stretchSelected: (factor) =>
          mutateDoc((s) => {
            const fid = s.selectedFormationId;
            const current = s.positions[fid];
            if (current === undefined || s.selectedPerformerIds.length < 2) return {};
            const selected = selectedSpots(current, s.selectedPerformerIds);
            if (selected.length < 2) return {};
            const b = stageBounds(s.performance);
            const stretched = stretchSpots(selected, factor).map((spot) => ({
              ...spot,
              x: clamp(spot.x, b.minX, b.maxX),
              y: clamp(spot.y, b.minY, b.maxY),
            }));
            return {
              positions: { ...s.positions, [fid]: applySpots(current, stretched) },
            };
          }),

        setPosition: (formationId, performerId, x, y) =>
          mutateDoc((s) => {
            const existing = s.positions[formationId]?.[performerId];
            if (existing === undefined) return {};
            const b = stageBounds(s.performance);
            return {
              positions: {
                ...s.positions,
                [formationId]: {
                  ...s.positions[formationId],
                  [performerId]: {
                    ...existing,
                    x: clamp(x, b.minX, b.maxX),
                    y: clamp(y, b.minY, b.maxY),
                  },
                },
              },
            };
          }),

        setPositionLive: (formationId, performerId, x, y) =>
          set((s) => {
            const existing = s.positions[formationId]?.[performerId];
            if (existing === undefined) return {};
            const b = stageBounds(s.performance);
            return {
              positions: {
                ...s.positions,
                [formationId]: {
                  ...s.positions[formationId],
                  [performerId]: {
                    ...existing,
                    x: clamp(x, b.minX, b.maxX),
                    y: clamp(y, b.minY, b.maxY),
                  },
                },
              },
            };
          }),

        setPositionsBulk: (formationId, updates) =>
          mutateDoc((s) => {
            const current = s.positions[formationId];
            if (current === undefined) return {};
            const b = stageBounds(s.performance);
            const next = { ...current };
            for (const [performerId, p] of Object.entries(updates)) {
              const existing = next[performerId];
              if (existing === undefined) continue;
              next[performerId] = {
                ...existing,
                x: clamp(p.x, b.minX, b.maxX),
                y: clamp(p.y, b.minY, b.maxY),
                ...(p.rotation !== undefined ? { rotation: ((p.rotation % 360) + 360) % 360 } : {}),
              };
            }
            return { positions: { ...s.positions, [formationId]: next } };
          }),

        applyScanFormations: (results) =>
          mutateDoc((s) => {
            if (results.length === 0) return {};
            const b = stageBounds(s.performance);
            // REPLACE the whole chart with the scan (the UI confirms first;
            // one undo restores everything). Dancers a hold didn't detect
            // keep their previous spot, seeded from the formation the scan
            // used as its identity reference, so every formation stays
            // fully populated (the editor's invariant).
            const formations: Formation[] = [];
            const positions: PositionMap = {};
            let carry: Record<string, { x: number; y: number }> = Object.fromEntries(
              Object.entries(s.positions[s.selectedFormationId] ?? {}).map(([pid, pos]) => [
                pid,
                { x: pos.x, y: pos.y },
              ]),
            );
            let nextIndex = 0;
            for (const r of results) {
              const id = newId();
              const merged = { ...carry, ...r.positions };
              carry = merged;
              formations.push({
                id,
                performanceId: s.performance.id,
                orderIndex: nextIndex,
                startTimeMs: Math.max(0, Math.round(r.startTimeMs)),
                durationMs: Math.max(1000, Math.round(r.endTimeMs - r.startTimeMs)),
                transitionType: 'linear',
                name: messages().defaults.formation(nextIndex + 1),
              });
              positions[id] = Object.fromEntries(
                Object.entries(merged).map(([pid, p]) => [
                  pid,
                  {
                    formationId: id,
                    performerId: pid,
                    x: clamp(p.x, b.minX, b.maxX),
                    y: clamp(p.y, b.minY, b.maxY),
                    rotation: 0,
                  },
                ]),
              );
              nextIndex += 1;
            }
            // Keep the play-order invariant (orderIndex == start-time order).
            const reindexed = [...formations]
              .sort((a, f) => a.startTimeMs - f.startTimeMs || a.orderIndex - f.orderIndex)
              .map((f, i) => ({ ...f, orderIndex: i }));
            const first = reindexed[0];
            return {
              formations: reindexed,
              positions,
              // The old formations are gone — every comment/annotation was
              // pinned to one, so they go too (undo restores them).
              comments: [],
              annotations: [],
              ...(first !== undefined ? { selectedFormationId: first.id } : {}),
            };
          }),

        setCurveControl: (formationId, performerId, x, y) =>
          mutateDoc((s) => {
            const existing = s.positions[formationId]?.[performerId];
            if (existing === undefined) return {};
            return {
              positions: {
                ...s.positions,
                [formationId]: {
                  ...s.positions[formationId],
                  [performerId]: {
                    ...existing,
                    curveControlPoints: [
                      {
                        x: clamp(x, 0, s.performance.stageWidth),
                        y: clamp(y, 0, s.performance.stageHeight),
                      },
                    ],
                  },
                },
              },
            };
          }),

        setRotation: (formationId, performerId, rotation) =>
          mutateDoc((s) => {
            const existing = s.positions[formationId]?.[performerId];
            if (existing === undefined) return {};
            const normalized = ((rotation % 360) + 360) % 360;
            return {
              positions: {
                ...s.positions,
                [formationId]: {
                  ...s.positions[formationId],
                  [performerId]: { ...existing, rotation: normalized },
                },
              },
            };
          }),

        setMarker: (formationId, performerId, marker) =>
          mutateDoc((s) => {
            const existing = s.positions[formationId]?.[performerId];
            if (existing === undefined) return {};
            const updated = { ...existing };
            if (marker === null) delete updated.marker;
            else updated.marker = marker;
            return {
              positions: {
                ...s.positions,
                [formationId]: { ...s.positions[formationId], [performerId]: updated },
              },
            };
          }),

        nudgeSelected: (dx, dy) => {
          const s = get();
          for (const pid of s.selectedPerformerIds) {
            const pos = s.positions[s.selectedFormationId]?.[pid];
            if (pos !== undefined) {
              get().setPosition(s.selectedFormationId, pid, pos.x + dx, pos.y + dy);
            }
          }
        },

        rotateSelected: (deltaDeg) => {
          const s = get();
          for (const pid of s.selectedPerformerIds) {
            const pos = s.positions[s.selectedFormationId]?.[pid];
            if (pos !== undefined) {
              get().setRotation(s.selectedFormationId, pid, pos.rotation + deltaDeg);
            }
          }
        },

        selectFormation: (id) => set({ selectedFormationId: id }),

        setPerformerSelection: (ids) =>
          set({
            selectedPerformerIds: ids,
            selectedPropId: null,
            selectedFixtureId: null,
            selectedCaptionId: null,
          }),

        copyPositionsFrom: (sourceFormationId) =>
          mutateDoc((s) => {
            const source = s.positions[sourceFormationId];
            const targetId = s.selectedFormationId;
            if (source === undefined || targetId === '' || sourceFormationId === targetId)
              return {};
            const copied = Object.fromEntries(
              Object.entries(source).map(([pid, pos]) => [pid, { ...pos, formationId: targetId }]),
            );
            return { positions: { ...s.positions, [targetId]: copied } };
          }),

        copyPositions: () => {
          const s = get();
          const current = s.positions[s.selectedFormationId] ?? {};
          const ids =
            s.selectedPerformerIds.length > 0 ? s.selectedPerformerIds : Object.keys(current);
          const copied: NonNullable<typeof positionsClipboard> = {};
          for (const pid of ids) {
            const pos = current[pid];
            if (pos !== undefined) copied[pid] = { x: pos.x, y: pos.y, rotation: pos.rotation };
          }
          if (Object.keys(copied).length > 0) positionsClipboard = copied;
        },

        pastePositions: () => {
          const clip = positionsClipboard;
          if (clip === null) return;
          mutateDoc((s) => {
            const fid = s.selectedFormationId;
            const current = { ...(s.positions[fid] ?? {}) };
            let changed = false;
            for (const [pid, spot] of Object.entries(clip)) {
              if (!s.performers.some((p) => p.id === pid)) continue;
              const existing = current[pid];
              const x = clamp(spot.x, 0, s.performance.stageWidth);
              const y = clamp(spot.y, 0, s.performance.stageHeight);
              current[pid] =
                existing !== undefined
                  ? { ...existing, x, y, rotation: spot.rotation }
                  : { formationId: fid, performerId: pid, x, y, rotation: spot.rotation };
              changed = true;
            }
            return changed ? { positions: { ...s.positions, [fid]: current } } : {};
          });
        },

        pathPerformerId: null,
        setPathPerformer: (id) => set({ pathPerformerId: id }),

        selectPerformer: (id, additive) =>
          set((s) => ({
            selectedPropId: null,
            selectedFixtureId: null,
            selectedCaptionId: null,
            selectedPerformerIds: additive
              ? s.selectedPerformerIds.includes(id)
                ? s.selectedPerformerIds.filter((p) => p !== id)
                : [...s.selectedPerformerIds, id]
              : [id],
          })),

        clearPerformerSelection: () =>
          set({
            selectedPerformerIds: [],
            selectedPropId: null,
            selectedFixtureId: null,
            selectedCaptionId: null,
          }),

        addBeatMarker: (ms) =>
          mutateDoc((s) => ({
            performance: {
              ...s.performance,
              beatMarkersMs: [...s.performance.beatMarkersMs, Math.max(0, Math.round(ms))].sort(
                (a, b) => a - b,
              ),
            },
          })),

        removeBeatMarker: (ms) =>
          mutateDoc((s) => ({
            performance: {
              ...s.performance,
              beatMarkersMs: s.performance.beatMarkersMs.filter((m) => m !== ms),
            },
          })),

        addSection: (ms, name) => {
          const id = newId();
          mutateDoc((s) => ({
            performance: {
              ...s.performance,
              sections: [
                ...s.performance.sections,
                { id, timeMs: Math.max(0, Math.round(ms)), name },
              ].sort((a, b) => a.timeMs - b.timeMs),
            },
          }));
          return id;
        },

        renameSection: (id, name) =>
          mutateDoc((s) => ({
            performance: {
              ...s.performance,
              sections: s.performance.sections.map((sec) =>
                sec.id === id ? { ...sec, name } : sec,
              ),
            },
          })),

        removeSection: (id) =>
          mutateDoc((s) => ({
            performance: {
              ...s.performance,
              sections: s.performance.sections.filter((sec) => sec.id !== id),
            },
          })),

        addCountSegment: (startMs, endMs) =>
          mutateDoc((s) => ({
            performance: {
              ...s.performance,
              countSegments: [
                ...s.performance.countSegments,
                { id: newId(), startMs: Math.max(0, startMs), endMs: Math.max(0, endMs) },
              ].sort((a, b) => a.startMs - b.startMs),
            },
          })),

        updateCountSegment: (id, patch) =>
          mutateDoc((s) => ({
            performance: {
              ...s.performance,
              countSegments: s.performance.countSegments
                .map((seg) => (seg.id === id ? { ...seg, ...patch } : seg))
                .sort((a, b) => a.startMs - b.startMs),
            },
          })),

        removeCountSegment: (id) =>
          mutateDoc((s) => ({
            performance: {
              ...s.performance,
              countSegments: s.performance.countSegments.filter((seg) => seg.id !== id),
            },
          })),

        addComment: (text, performerId, authorName) =>
          mutateDoc((s) => {
            const trimmed = text.trim();
            if (trimmed === '') return {};
            const comment: DocComment = {
              id: newId(),
              formationId: s.selectedFormationId,
              performerId,
              authorName,
              text: trimmed,
              createdAt: new Date().toISOString(),
            };
            return { comments: [...s.comments, comment] };
          }),

        removeComment: (id) =>
          mutateDoc((s) => ({ comments: s.comments.filter((c) => c.id !== id) })),

        toggleCommentResolved: (id) =>
          mutateDoc((s) => ({
            comments: s.comments.map((c) =>
              c.id === id ? { ...c, resolved: c.resolved !== true } : c,
            ),
          })),

        setPlayhead: (ms) => set({ playheadMs: Math.max(0, ms) }),
        setIsPlaying: (playing) => set({ isPlaying: playing }),
        setPlaybackRate: (rate) => set({ playbackRate: Math.min(2, Math.max(0.5, rate)) }),
        setMetronomeOn: (on) => set({ metronomeOn: on }),
        setLoopOn: (on) => set({ loopOn: on }),
        setLoopRange: (startMs, endMs) => {
          const start = Math.max(0, startMs);
          set({ loopStartMs: start, loopEndMs: Math.max(start + 200, endMs) });
        },
        setAnnotateMode: (mode) => set({ annotateMode: mode }),

        addAnnotation: (a) =>
          mutateDoc((s) => ({
            annotations: [...s.annotations, { ...a, id: newId(), performanceId: s.performance.id }],
          })),

        removeAnnotation: (id) =>
          mutateDoc((s) => ({ annotations: s.annotations.filter((a) => a.id !== id) })),

        restoreDoc: (doc) =>
          mutateDoc(() => ({
            ...snapshotDoc(doc),
            selectedPerformerIds: [],
          })),

        loadDoc: (doc) => {
          undoStack.length = 0;
          redoStack.length = 0;
          const first = [...doc.formations].sort((a, b) => a.orderIndex - b.orderIndex)[0];
          set({
            ...snapshotDoc(doc),
            selectedFormationId: first?.id ?? '',
            selectedPerformerIds: [],
            selectedPropId: null,
            selectedFixtureId: null,
            selectedCaptionId: null,
            playheadMs: 0,
            isPlaying: false,
          });
        },

        undo: () => {
          if (undoOverride.undo !== null) {
            undoOverride.undo();
            return;
          }
          const prev = undoStack.pop();
          if (prev === undefined) return;
          redoStack.push(snapshotDoc(get()));
          set(prev);
        },

        redo: () => {
          if (undoOverride.redo !== null) {
            undoOverride.redo();
            return;
          }
          const next = redoStack.pop();
          if (next === undefined) return;
          undoStack.push(snapshotDoc(get()));
          set(next);
        },
      };
    },
    {
      name: 'gridstage-doc',
      partialize: (s) => ({
        performance: s.performance,
        performers: s.performers,
        props: s.props,
        formations: s.formations,
        positions: s.positions,
        comments: s.comments,
        annotations: s.annotations,
        fixtures: s.fixtures,
        captions: s.captions,
      }),
      // Docs saved before the comments feature have no `comments` key —
      // default it so actions never see undefined.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<DocState>;
        // Old docs predate `sections`/`countSegments`; default them so
        // actions never see undefined.
        const performance =
          p.performance !== undefined
            ? {
                ...p.performance,
                sections: p.performance.sections ?? [],
                countSegments: p.performance.countSegments ?? [],
              }
            : current.performance;
        return {
          ...current,
          ...p,
          performance,
          comments: p.comments ?? [],
          props: p.props ?? [],
          annotations: p.annotations ?? [],
          fixtures: p.fixtures ?? [],
          captions: p.captions ?? [],
        };
      },
    },
  ),
);

// Persist the fresh doc immediately: audio and background images are keyed by
// performance.id, so a reload BEFORE the first edit must not regenerate the id
// (zustand-persist only writes on the first set() otherwise).
if (typeof localStorage !== 'undefined' && localStorage.getItem('gridstage-doc') === null) {
  useEditor.setState({});
}

/** Ensure a valid formation is always selected (after load or deletion). */
function healFormationSelection(s: EditorState): void {
  if (s.formations.length > 0 && !s.formations.some((f) => f.id === s.selectedFormationId)) {
    const first = [...s.formations].sort((a, b) => a.orderIndex - b.orderIndex)[0];
    if (first !== undefined) {
      useEditor.setState({ selectedFormationId: first.id });
    }
  }
}
useEditor.subscribe(healFormationSelection);
// Rehydration happens inside create(), BEFORE the subscriber above exists, so
// a reloaded doc sits with a stale selection until the first set() — the stage
// looks empty and drags write nowhere. Heal once at boot as well.
healFormationSelection(useEditor.getState());

/**
 * Doc state as every export should see it: understudies (active === false)
 * removed from the cast. Their positions stay in the maps but nothing
 * iterates them once the performer list is filtered.
 */
export function exportableState(): ReturnType<typeof useEditor.getState> {
  const s = useEditor.getState();
  return { ...s, performers: s.performers.filter(isPerformerActive) };
}
