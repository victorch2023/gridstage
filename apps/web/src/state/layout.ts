import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Sidebar widths, draggable like an IDE and persisted per browser.
 *
 * The DEFAULTS must stay 216 / 248: e2e/editor.spec.ts mirrors the app's
 * layout math (meterToPx) with these numbers, and tests run on a fresh
 * localStorage so they always see the defaults.
 */
export const DEFAULT_CAST_W = 216;
export const DEFAULT_PROPS_W = 248;
export const DEFAULT_TIMELINE_H = 210;
const MIN_PANEL_W = 160;
const MAX_PANEL_W = 420;
const MIN_TIMELINE_H = 130;
const MAX_TIMELINE_H = 520;

const clampWidth = (px: number): number => Math.min(MAX_PANEL_W, Math.max(MIN_PANEL_W, px));
const clampTimelineH = (px: number): number =>
  Math.min(MAX_TIMELINE_H, Math.max(MIN_TIMELINE_H, px));

interface LayoutState {
  castWidth: number;
  propsWidth: number;
  timelineHeight: number;
  /** Drags land on the 0.5m lattice (grid corners and cell centers). */
  snapToGrid: boolean;
  /**
   * 'easy' hides the power tools (crews, badges, untangle, presets, tap tempo…)
   * 'expert' shows everything. New features default to expert-only.
   */
  uiMode: 'easy' | 'expert';
  setCastWidth: (px: number) => void;
  setPropsWidth: (px: number) => void;
  setTimelineHeight: (px: number) => void;
  setSnapToGrid: (on: boolean) => void;
  setUiMode: (mode: 'easy' | 'expert') => void;
}

export const useLayout = create<LayoutState>()(
  persist(
    (set) => ({
      castWidth: DEFAULT_CAST_W,
      propsWidth: DEFAULT_PROPS_W,
      timelineHeight: DEFAULT_TIMELINE_H,
      snapToGrid: false,
      uiMode: 'easy',
      setCastWidth: (px) => set({ castWidth: clampWidth(px) }),
      setPropsWidth: (px) => set({ propsWidth: clampWidth(px) }),
      setTimelineHeight: (px) => set({ timelineHeight: clampTimelineH(px) }),
      setSnapToGrid: (on) => set({ snapToGrid: on }),
      setUiMode: (mode) => set({ uiMode: mode }),
    }),
    { name: 'gridstage-layout' },
  ),
);
