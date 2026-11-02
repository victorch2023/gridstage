import { describe, expect, it } from 'vitest';
import { resizeFromEdge, rotationFromPointer } from './shapeEdit';

const box = { x: 4, y: 3, width: 2, height: 1, rotation: 0 };

describe('resizeFromEdge', () => {
  it('pulls the east edge and keeps the west edge put', () => {
    const next = resizeFromEdge(box, 'e', 6, 3, false);
    expect(next.width).toBeCloseTo(3);
    expect(next.x).toBeCloseTo(4.5);
    expect(next.y).toBeCloseTo(3);
  });

  it('turns a circle into an ellipse by pulling one side', () => {
    const circle = { x: 0, y: 0, width: 2, height: 2, rotation: 0 };
    const next = resizeFromEdge(circle, 'e', 2, 0, false);
    expect(next.width).toBeCloseTo(3);
    expect(next.height).toBeCloseTo(2);
    expect(next.x).toBeCloseTo(0.5);
  });

  it('follows a rotated edge: 90° clockwise, east is downstage', () => {
    const turned = { x: 0, y: 0, width: 2, height: 1, rotation: 90 };
    const next = resizeFromEdge(turned, 'e', 0, 2, false);
    expect(next.width).toBeCloseTo(3);
    expect(next.x).toBeCloseTo(0);
    expect(next.y).toBeCloseTo(0.5);
  });

  it('snaps the new size to the 0.5 m lattice', () => {
    const next = resizeFromEdge(box, 's', 4, 4.2, true);
    expect(next.height).toBe(1.5);
  });

  it('does not shrink past the minimum', () => {
    const next = resizeFromEdge(box, 'e', 0, 3, false);
    expect(next.width).toBeCloseTo(0.3);
  });
});

describe('rotationFromPointer', () => {
  it('is 0 when the pointer is straight upstage', () => {
    expect(rotationFromPointer(1, 1, 1, 0, false)).toBeCloseTo(0);
  });

  it('is 90 when the pointer is stage-right of the center', () => {
    expect(rotationFromPointer(0, 0, 2, 0, false)).toBeCloseTo(90);
  });

  it('snaps to 15° steps', () => {
    expect(rotationFromPointer(0, 0, 2, 0.4, true)).toBe(105);
  });
});
