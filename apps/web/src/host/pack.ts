import type { DocState } from '../state/store';

/**
 * Firestore rejects a document over 1 MiB. Parts stay at 700 KB so field
 * names and the Bytes wrapper still fit. Four MP3 songs fit under the audio
 * cap; a WAV of that length does not, on purpose — Spark storage is 1 GiB
 * for the whole project.
 */
export const PART_BYTES = 700_000;
export const MAX_AUDIO_BYTES = 40 * 1024 * 1024;

export class ShareAudioTooLargeError extends Error {
  readonly bytes: number;
  constructor(bytes: number) {
    super('audio too large');
    this.name = 'ShareAudioTooLargeError';
    this.bytes = bytes;
  }
}

export interface PackedShare {
  docParts: string[];
  audioParts: Uint8Array[];
  audioContentType: string | null;
}

/** UTF-8 byte length of one code point, without allocating a TextEncoder. */
function utf8Length(ch: string): number {
  const c = ch.codePointAt(0) ?? 0;
  if (c <= 0x7f) return 1;
  if (c <= 0x7ff) return 2;
  if (c <= 0xffff) return 3;
  return 4;
}

/** Split on code-point boundaries so rejoining is the original string. */
export function splitUtf8(text: string, maxBytes: number): string[] {
  if (maxBytes < 4) throw new Error('maxBytes');
  const parts: string[] = [];
  let chunk = '';
  let size = 0;
  for (const ch of text) {
    const n = utf8Length(ch);
    if (chunk !== '' && size + n > maxBytes) {
      parts.push(chunk);
      chunk = ch;
      size = n;
    } else {
      chunk += ch;
      size += n;
    }
  }
  if (chunk !== '') parts.push(chunk);
  return parts.length === 0 ? [''] : parts;
}

export function joinAudio(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, part) => n + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

export function packShare(
  doc: DocState,
  audio: Uint8Array | null,
  contentType: string | null,
  limits?: { partBytes?: number; maxAudioBytes?: number },
): PackedShare {
  const partBytes = limits?.partBytes ?? PART_BYTES;
  const maxAudio = limits?.maxAudioBytes ?? MAX_AUDIO_BYTES;
  if (audio !== null && audio.byteLength > maxAudio) {
    throw new ShareAudioTooLargeError(audio.byteLength);
  }
  const audioParts: Uint8Array[] = [];
  if (audio !== null && audio.byteLength > 0) {
    for (let i = 0; i < audio.byteLength; i += partBytes) {
      // Copy: a subarray keeps the whole buffer, and Firestore would upload it.
      audioParts.push(new Uint8Array(audio.subarray(i, i + partBytes)));
    }
  }
  return {
    docParts: splitUtf8(JSON.stringify(doc), partBytes),
    audioParts,
    audioContentType: audioParts.length === 0 ? null : (contentType ?? 'audio/mpeg'),
  };
}
