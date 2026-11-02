import { describe, expect, it } from 'vitest';
import { joinAudio, packShare, ShareAudioTooLargeError, splitUtf8 } from './pack';
import type { DocState } from '../state/store';

function docWithTitle(title: string): DocState {
  return {
    performance: {
      id: 'perf',
      orgId: 'local',
      title,
      stageWidth: 12,
      stageHeight: 8,
      bpm: null,
      audioAssetId: null,
      beatMarkersMs: [],
      sections: [],
      countSegments: [],
    },
    performers: [],
    props: [],
    formations: [],
    positions: {},
    comments: [],
    annotations: [],
  };
}

describe('splitUtf8', () => {
  it('rejoins accented text split mid-string', () => {
    const text = 'áéíóú'.repeat(20);
    const parts = splitUtf8(text, 8);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join('')).toBe(text);
    for (const part of parts) {
      expect(new TextEncoder().encode(part).byteLength).toBeLessThanOrEqual(8);
    }
  });
});

describe('packShare', () => {
  it('round-trips the document JSON and the audio bytes', () => {
    const doc = docWithTitle('Función');
    const audio = new Uint8Array([1, 2, 3, 4, 5, 6, 7]);
    const packed = packShare(doc, audio, 'audio/mpeg', { partBytes: 4, maxAudioBytes: 20 });
    expect(JSON.parse(packed.docParts.join(''))).toMatchObject({
      performance: { title: 'Función' },
    });
    expect(joinAudio(packed.audioParts)).toEqual(audio);
    expect(packed.audioParts.length).toBe(2);
    expect(packed.audioContentType).toBe('audio/mpeg');
  });

  it('refuses audio over the cap', () => {
    const audio = new Uint8Array(8);
    expect(() => packShare(docWithTitle('x'), audio, 'audio/mpeg', { maxAudioBytes: 4 })).toThrow(
      ShareAudioTooLargeError,
    );
  });
});
