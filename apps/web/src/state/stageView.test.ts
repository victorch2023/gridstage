import { describe, expect, it } from 'vitest';
import { IDENTITY_STAGE_VIEW, panView, wheelZoomFactor, zoomViewAt } from './stageView';
import type { StageZoomLayout } from './stageView';

const layout: StageZoomLayout = {
  width: 800,
  height: 600,
  basePpm: 40,
  totalW: 12,
  totalH: 8,
  wingX: 0,
  wingY: 0,
};

describe('zoomViewAt', () => {
  it('keeps a centered stage centered when zooming at the middle', () => {
    const next = zoomViewAt(IDENTITY_STAGE_VIEW, 400, 300, 2, layout);
    expect(next.zoom).toBe(2);
    expect(next.panX).toBeCloseTo(0);
    expect(next.panY).toBeCloseTo(0);
  });

  it('holds the meter under the cursor when zooming off-center', () => {
    const sx = 200;
    const sy = 180;
    const next = zoomViewAt(IDENTITY_STAGE_VIEW, sx, sy, 2, layout);
    const oldPpm = layout.basePpm;
    const oldOx = (layout.width - layout.totalW * oldPpm) / 2;
    const oldOy = (layout.height - layout.totalH * oldPpm) / 2;
    const mx = (sx - oldOx) / oldPpm;
    const my = (sy - oldOy) / oldPpm;
    const newPpm = layout.basePpm * next.zoom;
    const newOx = next.panX + (layout.width - layout.totalW * newPpm) / 2;
    const newOy = next.panY + (layout.height - layout.totalH * newPpm) / 2;
    expect(newOx + mx * newPpm).toBeCloseTo(sx);
    expect(newOy + my * newPpm).toBeCloseTo(sy);
  });

  it('refuses to zoom past the limits', () => {
    const inn = zoomViewAt({ zoom: 8, panX: 0, panY: 0 }, 400, 300, 2, layout);
    expect(inn.zoom).toBe(8);
    const out = zoomViewAt({ zoom: 0.4, panX: 0, panY: 0 }, 400, 300, 0.5, layout);
    expect(out.zoom).toBe(0.4);
  });
});

describe('panView', () => {
  it('slides the plan by the pointer delta and leaves the zoom alone', () => {
    const next = panView({ zoom: 2, panX: 10, panY: -4 }, 12, -3);
    expect(next).toEqual({ zoom: 2, panX: 22, panY: -7 });
  });

  it('returns the same view when nothing moved', () => {
    const view = { zoom: 1, panX: 4, panY: 5 };
    expect(panView(view, 0, 0)).toBe(view);
    expect(panView(view, Number.NaN, 2)).toBe(view);
  });
});

describe('wheelZoomFactor', () => {
  it('zooms in when the wheel scrolls up', () => {
    expect(wheelZoomFactor(-100, 0)).toBeGreaterThan(1);
    expect(wheelZoomFactor(100, 0)).toBeLessThan(1);
  });
});
