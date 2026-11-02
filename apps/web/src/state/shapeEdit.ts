import type { PieceShape, StageCaption, StageFixture } from '@gridstage/shared-types';

/** Which side of the footprint the pointer is pulling. */
export type ShapeEdge = 'n' | 'e' | 's' | 'w';

export interface ShapeBox {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Degrees clockwise, y down, same convention as a formation pose. */
  rotation: number;
}

const MIN_M = 0.3;

function axes(rotationDeg: number): { ux: [number, number]; uy: [number, number] } {
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // Clockwise on a y-down plan: local +x and local +y (downstage).
  return { ux: [cos, sin], uy: [-sin, cos] };
}

function snapLen(value: number, snap: boolean, min: number): number {
  const clamped = Math.max(min, value);
  if (!snap) return clamped;
  return Math.max(min, Math.round(clamped / 0.5) * 0.5);
}

/**
 * Pull one edge. The opposite edge stays put, so a circle stretched on one
 * side becomes an ellipse and the center follows the moving edge.
 * `start` is the box at pointer-down; call this with that same box on every
 * move so the anchor does not drift.
 */
export function resizeFromEdge(
  start: ShapeBox,
  edge: ShapeEdge,
  pointerX: number,
  pointerY: number,
  snap: boolean,
  min = MIN_M,
): ShapeBox {
  const { ux, uy } = axes(start.rotation);
  const center: [number, number] = [start.x, start.y];
  const pointer: [number, number] = [pointerX, pointerY];
  const add = (p: [number, number], v: [number, number], scale: number): [number, number] => [
    p[0] + v[0] * scale,
    p[1] + v[1] * scale,
  ];
  const dot = (a: [number, number], b: [number, number]): number => a[0] * b[0] + a[1] * b[1];

  if (edge === 'e' || edge === 'w') {
    const sign = edge === 'e' ? 1 : -1;
    const anchor = add(center, ux, -sign * (start.width / 2));
    const along = dot([pointer[0] - anchor[0], pointer[1] - anchor[1]], ux) * sign;
    const width = snapLen(along, snap, min);
    const next = add(anchor, ux, sign * (width / 2));
    return { ...start, x: next[0], y: next[1], width };
  }

  const sign = edge === 's' ? 1 : -1;
  const anchor = add(center, uy, -sign * (start.height / 2));
  const along = dot([pointer[0] - anchor[0], pointer[1] - anchor[1]], uy) * sign;
  const height = snapLen(along, snap, min);
  const next = add(anchor, uy, sign * (height / 2));
  return { ...start, x: next[0], y: next[1], height };
}

/**
 * Angle that puts the rotation handle (local upstage, -y) under the pointer.
 * 0 means the handle is straight upstage. With snap, the angle lands on 15°.
 */
export function rotationFromPointer(
  cx: number,
  cy: number,
  pointerX: number,
  pointerY: number,
  snap: boolean,
): number {
  const ang = Math.atan2(pointerY - cy, pointerX - cx);
  let deg = (ang * 180) / Math.PI + 90;
  deg = ((deg % 360) + 360) % 360;
  if (snap) deg = Math.round(deg / 15) * 15;
  return deg % 360;
}

/** Screen angle of a footprint. Audience-at-top flips the plan by 180°. */
export function shapeScreenDeg(rotation: number, flip: boolean): number {
  return rotation + (flip ? 180 : 0);
}

export function fixtureShape(piece: { shape?: PieceShape }): PieceShape {
  return piece.shape === 'ellipse' ? 'ellipse' : 'rect';
}

export function pieceRotation(piece: { rotation?: number }): number {
  return piece.rotation ?? 0;
}

/** A caption with no stored size still gets a box big enough to grab. */
export function captionSize(piece: { text: string; width?: number; height?: number }): {
  width: number;
  height: number;
} {
  return {
    width: piece.width ?? Math.max(1.6, piece.text.length * 0.18),
    height: piece.height ?? 0.6,
  };
}

export function fixtureBox(piece: StageFixture): ShapeBox {
  return {
    x: piece.x,
    y: piece.y,
    width: piece.width,
    height: piece.height,
    rotation: pieceRotation(piece),
  };
}

export function captionBox(piece: StageCaption): ShapeBox {
  const size = captionSize(piece);
  return {
    x: piece.x,
    y: piece.y,
    width: size.width,
    height: size.height,
    rotation: pieceRotation(piece),
  };
}
