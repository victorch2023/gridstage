import type { PropKind, StageProp } from '@gridstage/shared-types';
import { messages } from '../i18n';

/** Palette for new props — earthy tones that read as "scenery, not dancer". */
const PROP_COLORS = ['#8fb98f', '#b8863b', '#7a9cc6', '#c67a7a', '#9b8fb9'];

export function newProp(
  id: string,
  performanceId: string,
  index: number,
  kind: PropKind,
  textOnly = false,
): StageProp {
  return {
    id,
    performanceId,
    name: textOnly ? messages().defaults.caption(index + 1) : messages().defaults.prop(index + 1),
    kind: textOnly ? 'rect' : kind,
    color: PROP_COLORS[index % PROP_COLORS.length] ?? '#8fb98f',
    width: textOnly || kind === 'rect' ? 2 : 1,
    height: textOnly ? 0.6 : 1,
    ...(textOnly ? { textOnly: true } : {}),
  };
}

/**
 * Polygon outline of a prop in LOCAL meters, centered on its position.
 * Circles are not polygons — callers draw an ellipse for those.
 */
export function propOutline(kind: PropKind, width: number, height: number): [number, number][] {
  const w = width / 2;
  const h = height / 2;
  if (kind === 'triangle') {
    return [
      [0, -h],
      [w, h],
      [-w, h],
    ];
  }
  return [
    [-w, -h],
    [w, -h],
    [w, h],
    [-w, h],
  ];
}

/** Rotate local points by rotation° (clockwise) and translate to (cx, cy). */
export function placeOutline(
  points: readonly [number, number][],
  cx: number,
  cy: number,
  rotationDeg: number,
): [number, number][] {
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return points.map(([x, y]) => [cx + x * cos - y * sin, cy + x * sin + y * cos]);
}
