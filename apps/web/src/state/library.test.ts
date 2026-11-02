import { describe, expect, it } from 'vitest';
import { cloneDocAs } from './library';
import type { DocState } from './store';

const doc: DocState = {
  performance: {
    id: 'perf-1',
    orgId: 'local',
    title: 'Spring show',
    stageWidth: 12,
    stageHeight: 8,
    bpm: 120,
    audioAssetId: null,
    beatMarkersMs: [500],
    sections: [],
    countSegments: [],
  },
  performers: [
    { id: 'p1', performanceId: 'perf-1', name: 'Amy', role: '', color: '#fff', avatarUrl: null },
  ],
  props: [
    {
      id: 'prop1',
      performanceId: 'perf-1',
      name: 'Box',
      kind: 'rect',
      color: '#8fb98f',
      width: 2,
      height: 1,
    },
  ],
  formations: [
    {
      id: 'f1',
      performanceId: 'perf-1',
      orderIndex: 0,
      startTimeMs: 0,
      durationMs: 4000,
      transitionType: 'linear',
      name: 'Formation 1',
    },
  ],
  positions: { f1: { p1: { formationId: 'f1', performerId: 'p1', x: 1, y: 2, rotation: 0 } } },
  comments: [],
  annotations: [
    {
      id: 'n1',
      performanceId: 'perf-1',
      formationId: 'f1',
      kind: 'pin',
      color: '#fff',
      text: 'hi',
    },
  ],
  fixtures: [],
  captions: [],
};

describe('cloneDocAs', () => {
  it('gives the copy a new performance id and title', () => {
    const copy = cloneDocAs(doc, 'perf-2', 'Spring show (copy)');
    expect(copy.performance.id).toBe('perf-2');
    expect(copy.performance.title).toBe('Spring show (copy)');
  });

  it('re-points formations and props at the new performance, keeping their own ids', () => {
    const copy = cloneDocAs(doc, 'perf-2', 't');
    expect(copy.formations[0]?.performanceId).toBe('perf-2');
    expect(copy.formations[0]?.id).toBe('f1');
    expect(copy.props[0]?.performanceId).toBe('perf-2');
    expect(copy.props[0]?.id).toBe('prop1');
    expect(copy.annotations[0]?.performanceId).toBe('perf-2');
    // positions stay keyed by the unchanged formation/performer ids
    expect(copy.positions['f1']?.['p1']?.x).toBe(1);
  });

  it('does not mutate the source doc', () => {
    cloneDocAs(doc, 'perf-2', 't');
    expect(doc.performance.id).toBe('perf-1');
    expect(doc.formations[0]?.performanceId).toBe('perf-1');
  });
});
