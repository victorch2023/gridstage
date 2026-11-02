/** On-screen zoom of the 2D plan. Stored meters never change. */

export interface StageView {
  zoom: number;
  /** Extra pixels added to the fitted origin. */
  panX: number;
  panY: number;
}

export interface StageZoomLayout {
  width: number;
  height: number;
  /** Pixels per meter when zoom is 1 (the fit-to-panel scale). */
  basePpm: number;
  totalW: number;
  totalH: number;
  /** Meters of offstage that land on the screen-left and screen-top edges. */
  wingX: number;
  wingY: number;
}

export const MIN_STAGE_ZOOM = 0.4;
export const MAX_STAGE_ZOOM = 8;

export const IDENTITY_STAGE_VIEW: StageView = { zoom: 1, panX: 0, panY: 0 };

/** Slide the plan by a screen delta, in pixels. Stored meters never change. */
export function panView(view: StageView, dx: number, dy: number): StageView {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) return view;
  return { ...view, panX: view.panX + dx, panY: view.panY + dy };
}

function clampZoom(zoom: number): number {
  return Math.min(MAX_STAGE_ZOOM, Math.max(MIN_STAGE_ZOOM, zoom));
}

/**
 * Zoom by `factor`, keeping the stage point under (sx, sy) — canvas pixels —
 * fixed on screen. Scroll up and a pinch-out both pass a factor greater than 1.
 */
export function zoomViewAt(
  view: StageView,
  sx: number,
  sy: number,
  factor: number,
  layout: StageZoomLayout,
): StageView {
  if (!(layout.basePpm > 0) || !Number.isFinite(factor) || factor <= 0) return view;
  const zoom = clampZoom(view.zoom * factor);
  if (zoom === view.zoom) return view;
  const oldPpm = layout.basePpm * view.zoom;
  const newPpm = layout.basePpm * zoom;
  const oldOriginX =
    view.panX + (layout.width - layout.totalW * oldPpm) / 2 + layout.wingX * oldPpm;
  const oldOriginY =
    view.panY + (layout.height - layout.totalH * oldPpm) / 2 + layout.wingY * oldPpm;
  const mx = (sx - oldOriginX) / oldPpm;
  const my = (sy - oldOriginY) / oldPpm;
  const newOriginX = sx - mx * newPpm;
  const newOriginY = sy - my * newPpm;
  return {
    zoom,
    panX: newOriginX - (layout.width - layout.totalW * newPpm) / 2 - layout.wingX * newPpm,
    panY: newOriginY - (layout.height - layout.totalH * newPpm) / 2 - layout.wingY * newPpm,
  };
}

/**
 * Wheel delta → zoom factor. Negative deltaY (scroll up, or a pinch outward
 * on a trackpad) zooms in. deltaMode 1 is lines, 2 is pages.
 */
export function wheelZoomFactor(deltaY: number, deltaMode: number): number {
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp(-pixels * 0.002);
}
