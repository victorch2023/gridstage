import { describe, expect, it } from 'vitest';
import type { Formation } from '@gridstage/shared-types';
import type { PositionMap } from './store';
import {
  eightCountMarks,
  formatEightCount,
  formatTimecode,
  timeRulerTicks,
  lerpAngle,
  posesAtTime,
  showEndMs,
  snapToFormationEdges,
} from './interpolate';

function formation(partial: Partial<Formation> & Pick<Formation, 'id' | 'orderIndex'>): Formation {
  return {
    performanceId: 'perf',
    startTimeMs: 0,
    durationMs: 1000,
    transitionType: 'linear',
    name: partial.id,
    ...partial,
  };
}

const f1 = formation({ id: 'f1', orderIndex: 0, startTimeMs: 0, durationMs: 1000 });
const f2 = formation({ id: 'f2', orderIndex: 1, startTimeMs: 3000, durationMs: 1000 });

const positions: PositionMap = {
  f1: { alice: { formationId: 'f1', performerId: 'alice', x: 0, y: 0, rotation: 350 } },
  f2: { alice: { formationId: 'f2', performerId: 'alice', x: 4, y: 2, rotation: 10 } },
};

describe('posesAtTime', () => {
  it('holds the formation position inside its window', () => {
    const poses = posesAtTime([f1, f2], positions, 500);
    expect(poses.get('alice')).toEqual({ x: 0, y: 0, rotation: 350 });
  });

  it('interpolates midway through a transition, rotation via shortest arc', () => {
    // transition runs 1000ms (f1 hold end) -> 3000ms (f2 start); midpoint 2000ms
    const poses = posesAtTime([f1, f2], positions, 2000);
    const alice = poses.get('alice');
    expect(alice).toBeDefined();
    expect(alice?.x).toBeCloseTo(2);
    expect(alice?.y).toBeCloseTo(1);
    // 350° -> 10° crosses 0°, midpoint is 0°, NOT 180°
    expect(alice?.rotation).toBeCloseTo(0);
  });

  it('pins before the first and after the last formation', () => {
    expect(posesAtTime([f1, f2], positions, -50)?.get('alice')?.x).toBe(0);
    expect(posesAtTime([f1, f2], positions, 99_999)?.get('alice')?.x).toBe(4);
  });

  it('returns an empty map with no formations', () => {
    expect(posesAtTime([], {}, 0).size).toBe(0);
  });

  it('handles a zero-length transition without NaN', () => {
    const g2 = formation({ id: 'f2', orderIndex: 1, startTimeMs: 1000, durationMs: 1000 });
    const poses = posesAtTime([f1, g2], positions, 1000);
    const alice = poses.get('alice');
    expect(alice?.x).not.toBeNaN();
  });

  it('keeps a performer missing from the next formation at their current spot', () => {
    const sparse: PositionMap = { f1: positions['f1'] ?? {}, f2: {} };
    const poses = posesAtTime([f1, f2], sparse, 2000);
    expect(poses.get('alice')?.x).toBe(0);
  });

  it("travels a quadratic Bézier when the transition is 'curve'", () => {
    const curveF1 = { ...f1, transitionType: 'curve' as const };
    const curved: PositionMap = {
      f1: {
        alice: {
          formationId: 'f1',
          performerId: 'alice',
          x: 0,
          y: 0,
          rotation: 0,
          curveControlPoints: [{ x: 2, y: 6 }],
        },
      },
      f2: positions['f2'] ?? {},
    };
    // midpoint of transition: B(0.5) = 0.25*P0 + 0.5*C + 0.25*P1
    const poses = posesAtTime([curveF1, f2], curved, 2000);
    expect(poses.get('alice')?.x).toBeCloseTo(0.25 * 0 + 0.5 * 2 + 0.25 * 4); // 2
    expect(poses.get('alice')?.y).toBeCloseTo(0.25 * 0 + 0.5 * 6 + 0.25 * 2); // 3.5
    // endpoints unchanged
    expect(posesAtTime([curveF1, f2], curved, 1000).get('alice')?.x).toBeCloseTo(0);
    expect(posesAtTime([curveF1, f2], curved, 3000).get('alice')?.x).toBeCloseTo(4);
  });

  it("'curve' without a control point falls back to a straight line", () => {
    const curveF1 = { ...f1, transitionType: 'curve' as const };
    const poses = posesAtTime([curveF1, f2], positions, 2000);
    expect(poses.get('alice')?.x).toBeCloseTo(2);
    expect(poses.get('alice')?.y).toBeCloseTo(1);
  });
});

describe('helpers', () => {
  it('lerpAngle picks the short way around', () => {
    expect(lerpAngle(350, 10, 0.5)).toBeCloseTo(0);
    expect(lerpAngle(0, 180, 0.5)).toBeCloseTo(90);
  });

  it('showEndMs is the last hold end', () => {
    expect(showEndMs([f1, f2])).toBe(4000);
    expect(showEndMs([])).toBe(0);
  });

  it('formats timecodes', () => {
    expect(formatTimecode(0)).toBe('0:00.0');
    expect(formatTimecode(61_500)).toBe('1:01.5');
    expect(formatTimecode(-5)).toBe('0:00.0');
  });

  it('formats eight-counts at 120 BPM', () => {
    expect(formatEightCount(0, 120)).toBe('8ct 1 · 1');
    // 120 BPM -> 500ms/beat; 4000ms = beat 8 -> second eight, count 1
    expect(formatEightCount(4000, 120)).toBe('8ct 2 · 1');
  });

  it('anchors count 1 on the segment start', () => {
    const segments = [{ id: 'a', startMs: 2000, endMs: 10_000 }];
    expect(formatEightCount(2000, 120, segments)).toBe('8ct 1 · 1');
    expect(formatEightCount(2500, 120, segments)).toBe('8ct 1 · 2');
    expect(formatEightCount(6000, 120, segments)).toBe('8ct 2 · 1');
  });

  it('returns null outside every segment, and restarts in the next one', () => {
    const segments = [
      { id: 'a', startMs: 2000, endMs: 6000 },
      { id: 'b', startMs: 10_000, endMs: 14_000 },
    ];
    expect(formatEightCount(1000, 120, segments)).toBeNull(); // before
    expect(formatEightCount(8000, 120, segments)).toBeNull(); // the gap
    expect(formatEightCount(10_000, 120, segments)).toBe('8ct 1 · 1'); // restarted
    expect(formatEightCount(20_000, 120, segments)).toBeNull(); // after
  });

  it('ignores degenerate segments (end <= start)', () => {
    expect(formatEightCount(0, 120, [{ id: 'x', startMs: 5000, endMs: 5000 }])).toBeNull();
  });
});

describe('snapToFormationEdges', () => {
  // f1 edges: 0 and 1000; f2 edges: 3000 and 4000.
  it('snaps to the nearest edge within tolerance', () => {
    expect(snapToFormationEdges(1080, [f1, f2], 100)).toBe(1000);
    expect(snapToFormationEdges(2930, [f1, f2], 100)).toBe(3000);
  });

  it('passes the time through outside every tolerance', () => {
    expect(snapToFormationEdges(2000, [f1, f2], 100)).toBe(2000);
  });

  it('handles no formations', () => {
    expect(snapToFormationEdges(1234, [], 100)).toBe(1234);
  });
});

describe('timeRulerTicks', () => {
  it('labels every 2s when a second is about 33px wide', () => {
    const ticks = timeRulerTicks(30_000, 1000);
    const labels = ticks.filter((tick) => tick.label !== null).map((tick) => tick.label);
    expect(labels.slice(0, 4)).toEqual(['0s', '2s', '4s', '6s']);
    expect(ticks.some((tick) => !tick.major && tick.ms === 1000)).toBe(true);
  });

  it('switches to minutes once the marks pass a minute', () => {
    const ticks = timeRulerTicks(180_000, 900);
    const labels = ticks.filter((tick) => tick.label !== null).map((tick) => tick.label);
    expect(labels).toContain('0s');
    expect(labels).toContain('1:00');
    expect(labels).toContain('1:30');
  });

  it('returns nothing for an empty span', () => {
    expect(timeRulerTicks(0, 800)).toEqual([]);
  });
});

describe('eightCountMarks', () => {
  it('defaults to marks from 0 across the whole span', () => {
    // 120 BPM -> one eight = 4000ms
    expect(eightCountMarks(12_000, 120, [])).toEqual([
      { ms: 0, label: 1 },
      { ms: 4000, label: 2 },
      { ms: 8000, label: 3 },
    ]);
  });

  it('marks each segment separately, restarting labels', () => {
    const segments = [
      { id: 'a', startMs: 2000, endMs: 10_000 },
      { id: 'b', startMs: 20_000, endMs: 24_000 },
    ];
    expect(eightCountMarks(30_000, 120, segments)).toEqual([
      { ms: 2000, label: 1 },
      { ms: 6000, label: 2 },
      { ms: 20_000, label: 1 },
    ]);
  });
});
