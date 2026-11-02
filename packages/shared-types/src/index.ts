/**
 * GridStage domain model.
 *
 * Conventions:
 * - All ids are UUIDs (string).
 * - Stage coordinates are in meters. Origin is the upstage-left corner of the
 *   stage; x grows stage-right, y grows downstage (toward the audience).
 * - `rotation` is the performer's facing in degrees, 0 = facing the audience
 *   (downstage), clockwise positive on the top-down plan view.
 * - Times are milliseconds from the start of the performance audio.
 */

export type TransitionType = 'linear' | 'curve';

export type MemberRole = 'owner' | 'editor' | 'viewer';

export type MediaAssetType = 'audio' | 'image' | 'video';

export interface Organization {
  id: string;
  name: string;
  createdAt: string;
}

export interface User {
  id: string;
  orgId: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface Performance {
  id: string;
  orgId: string;
  title: string;
  /** Stage width in meters (x axis). */
  stageWidth: number;
  /** Stage depth in meters (y axis). */
  stageHeight: number;
  bpm: number | null;
  audioAssetId: string | null;
  /** Manual beat markers, ms from audio start. Stored as JSONB server-side. */
  beatMarkersMs: number[];
  /** Named timeline sections (verse, chorus…), independent of formations. */
  sections: PerformanceSection[];
  /**
   * Ranges of the piece that are counted in 8-counts. Music rarely starts on
   * count 1, and some passages aren't counted at all, so each segment anchors
   * count 1 at its own startMs. EMPTY = the default: count the whole piece
   * from 0 (also what docs saved before this field existed mean).
   */
  countSegments: CountSegment[];
  /**
   * Which screen edge the audience sits on in the 2D plan and exports.
   * 'top' renders the plan rotated 180° (the performers' own perspective);
   * stored coordinates are unaffected. Absent = 'bottom' (director view).
   */
  audienceAt?: 'top' | 'bottom';
  /**
   * Opacity of the venue photo drawn under the grid, 0–1. The image itself
   * is a local blob (IndexedDB, keyed per document) — it does not travel
   * with the doc. Absent = 0.5.
   */
  stageBackgroundOpacity?: number;
  /**
   * Offstage holding zones in meters (absent or 0 = none). Dancers can be
   * placed there while waiting to enter: left/right wings extend the x
   * axis (x < 0 / x > stageWidth), backstage extends upstage (y < 0).
   */
  wings?: { left: number; right: number; back: number };
}

/** One counted passage: count 1 lands on startMs, counting stops at endMs. */
export interface CountSegment {
  id: string;
  startMs: number;
  endMs: number;
}

/** A named label on the timeline at a point in time (not tied to a formation). */
export interface PerformanceSection {
  id: string;
  /** Milliseconds from audio start. */
  timeMs: number;
  name: string;
}

export type PropKind = 'rect' | 'circle' | 'triangle';

/**
 * A stage prop (box, platform, banner…). Its footprint is a simple shape in
 * meters; each formation stores its own position/rotation for it in the same
 * per-formation position map the performers use (keyed by the prop's id).
 */
export interface StageProp {
  id: string;
  performanceId: string;
  name: string;
  kind: PropKind;
  /** Display color, hex like "#8fb98f". */
  color: string;
  /** Footprint in meters ('circle' draws an ellipse inside width × height). */
  width: number;
  height: number;
}

/**
 * Furniture or a fixed set piece. Same place in every formation.
 * x/y is the center, in stage meters. width is along x, height along y.
 */
export interface StageFixture {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  color: string;
}

/** A text mark glued to the stage, the same place in every formation. */
export interface StageCaption {
  id: string;
  x: number;
  y: number;
  text: string;
  color: string;
}

/**
 * A rehearsal note drawn on one formation's stage plan: a freehand pen
 * stroke or a text pin. Coordinates are stage meters, so notes stay glued
 * to the spot they mark on any screen size.
 */
export interface Annotation {
  id: string;
  performanceId: string;
  formationId: string;
  kind: 'stroke' | 'pin';
  /** Display color, hex. */
  color: string;
  /** stroke: flattened [x0, y0, x1, y1, …]. */
  points?: number[];
  /** pin anchor. */
  x?: number;
  y?: number;
  /** pin label. */
  text?: string;
}

export interface Formation {
  id: string;
  performanceId: string;
  orderIndex: number;
  /** When this formation is fully assembled, ms from audio start. */
  startTimeMs: number;
  /** How long the formation holds before transitioning to the next one. */
  durationMs: number;
  /** How performers travel to the NEXT formation. */
  transitionType: TransitionType;
  name: string;
  /** Optional label color for the timeline card (hex), e.g. per song section. */
  color?: string;
}

export interface Performer {
  id: string;
  performanceId: string;
  name: string;
  /** Display color, hex like "#e05252". */
  color: string;
  role: string;
  avatarUrl: string | null;
  /**
   * Short tag drawn inside the performer's mark (2D) and on their face (3D):
   * one CJK/fullwidth character or up to four ASCII characters. Optional —
   * absent means no badge.
   */
  badge?: string;
  /**
   * Free-form group names ("front row", "flyers"…) for selecting several
   * performers at once. Optional — absent means ungrouped.
   */
  tags?: string[];
  /**
   * False = understudy/absent this run: kept in the cast with all their
   * positions, but hidden from the stage, exports and analysis.
   * Absent means active.
   */
  active?: boolean;
}

export interface FormationPosition {
  formationId: string;
  performerId: string;
  x: number;
  y: number;
  /** Facing in degrees, 0 = facing audience. */
  rotation: number;
  /** Elevation in meters (lifts, platforms). Optional. */
  z?: number;
  /**
   * Bézier control points for a 'curve' transition OUT of this formation,
   * in stage meters. Absent or empty = straight line.
   */
  curveControlPoints?: readonly { x: number; y: number }[];
  /**
   * State marker drawn around the mark in THIS formation (kneel, jump,
   * holding a prop… — the team assigns the meaning). Absent = plain mark.
   */
  marker?: PositionMarker;
}

/** Shape vocabulary for per-formation state markers. */
export type PositionMarker = 'square' | 'triangle' | 'diamond';

export interface Comment {
  id: string;
  formationId: string;
  /** Null = comment on the whole formation, otherwise on one performer. */
  performerId: string | null;
  authorId: string;
  text: string;
  createdAt: string;
}

/**
 * Comment as carried in the editor document (local doc / Yjs). Uses a free
 * author display name because the client may have no authenticated user;
 * the API maps this to `Comment.authorId` once accounts exist.
 */
export interface DocComment {
  id: string;
  formationId: string;
  /** Null = comment on the whole formation, otherwise on one performer. */
  performerId: string | null;
  authorName: string;
  text: string;
  createdAt: string;
  /** Resolved notes collapse out of the way instead of drowning new ones. */
  resolved?: boolean;
}

export interface VersionSnapshot {
  id: string;
  performanceId: string;
  /** Base64-encoded Yjs document state. */
  yjsState: string;
  createdBy: string;
  createdAt: string;
}

export interface MediaAsset {
  id: string;
  performanceId: string;
  type: MediaAssetType;
  url: string;
  metadata: Record<string, unknown>;
}

/** Stage defaults used when creating a new performance (typical dance studio). */
/** Absent flag = active; only an explicit false hides the performer. */
export const isPerformerActive = (p: Performer): boolean => p.active !== false;

export const DEFAULT_STAGE_WIDTH_M = 12;
export const DEFAULT_STAGE_HEIGHT_M = 8;
export const DEFAULT_FORMATION_DURATION_MS = 8_000;
export const DEFAULT_TRANSITION_MS = 4_000;

/** Palette assigned to performers in creation order (colorblind-safe). */
export const PERFORMER_COLORS: readonly string[] = [
  '#e8843c', // orange
  '#5b8ff0', // blue
  '#58b5a4', // teal
  '#d0668f', // pink
  '#8f7ee0', // violet
  '#b0a13f', // olive
  '#d95f5f', // red
  '#4fa3d1', // sky
  '#9d8556', // tan
  '#7f9e58', // green
];
