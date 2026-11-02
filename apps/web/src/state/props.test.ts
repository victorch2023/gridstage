import { describe, expect, it } from 'vitest';
import { newProp, placeOutline, propOutline } from './props';

describe('propOutline', () => {
  it('rect: four corners centered on the origin', () => {
    expect(propOutline('rect', 2, 1)).toEqual([
      [-1, -0.5],
      [1, -0.5],
      [1, 0.5],
      [-1, 0.5],
    ]);
  });

  it('triangle: apex upstage (negative y), base downstage', () => {
    const pts = propOutline('triangle', 2, 1);
    expect(pts).toHaveLength(3);
    expect(pts[0]).toEqual([0, -0.5]);
  });
});

describe('placeOutline', () => {
  it('translates without rotation', () => {
    expect(placeOutline([[1, 0]], 5, 3, 0)[0]?.[0]).toBeCloseTo(6);
    expect(placeOutline([[1, 0]], 5, 3, 0)[0]?.[1]).toBeCloseTo(3);
  });

  it('rotates 90° clockwise: +x becomes +y', () => {
    const [pt] = placeOutline([[1, 0]], 0, 0, 90);
    expect(pt?.[0]).toBeCloseTo(0);
    expect(pt?.[1]).toBeCloseTo(1);
  });
});

describe('newProp', () => {
  it('rect defaults to 2x1m, others to 1x1m', () => {
    expect(newProp('a', 'p', 0, 'rect').width).toBe(2);
    expect(newProp('a', 'p', 0, 'circle').width).toBe(1);
    expect(newProp('a', 'p', 2, 'triangle').name).toBe('Objeto 3');
  });

  it('a formation text is a short rectangle named like a caption', () => {
    const text = newProp('a', 'p', 0, 'rect', true);
    expect(text.textOnly).toBe(true);
    expect(text.kind).toBe('rect');
    expect(text.name).toBe('Texto 1');
    expect(text.height).toBe(0.6);
  });
});
