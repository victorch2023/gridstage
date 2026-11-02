import { describe, expect, it } from 'vitest';
import { docFileName, parseDocFile, serializeDoc } from './docFile';
import { createInitialDoc } from './store';

describe('docFileName', () => {
  it('uses the single-segment .gridstage extension (Windows associations)', () => {
    expect(docFileName('My Show')).toBe('my-show.gridstage');
  });
});

describe('parseDocFile', () => {
  it('round-trips a serialized doc', () => {
    const doc = createInitialDoc();
    const parsed = parseDocFile(serializeDoc(doc));
    expect(parsed).toEqual(doc);
  });

  it('rejects non-JSON text', () => {
    expect(parseDocFile('not json')).toBeNull();
  });

  it('rejects JSON that is not a GridStage doc', () => {
    expect(parseDocFile('{"foo": 1}')).toBeNull();
    expect(parseDocFile('[]')).toBeNull();
    expect(parseDocFile('null')).toBeNull();
    // performance present but missing required fields
    expect(parseDocFile('{"performance": {"id": "x"}}')).toBeNull();
  });

  it('rejects a doc whose positions is an array', () => {
    const doc = createInitialDoc();
    const broken = { ...doc, positions: [] };
    expect(parseDocFile(JSON.stringify(broken))).toBeNull();
  });

  it('defaults optional collections missing from old files', () => {
    const doc = createInitialDoc();
    const legacy: Record<string, unknown> = {
      performance: {
        ...doc.performance,
        sections: undefined,
        countSegments: undefined,
      },
      performers: doc.performers,
      formations: doc.formations,
      positions: doc.positions,
      // props / comments / annotations absent, as in pre-feature files
    };
    const parsed = parseDocFile(JSON.stringify(legacy));
    expect(parsed).not.toBeNull();
    expect(parsed?.props).toEqual([]);
    expect(parsed?.comments).toEqual([]);
    expect(parsed?.annotations).toEqual([]);
    expect(parsed?.fixtures).toEqual([]);
    expect(parsed?.captions).toEqual([]);
    expect(parsed?.performance.sections).toEqual([]);
    expect(parsed?.performance.countSegments).toEqual([]);
  });
});
