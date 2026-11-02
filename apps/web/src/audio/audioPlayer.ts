/**
 * Singleton audio playback + persistence.
 *
 * The uploaded audio file lives in IndexedDB (localStorage can't hold blobs),
 * so a reload keeps the music. One HTMLAudioElement drives playback; waveform
 * peaks are decoded lazily via the Web Audio API and cached.
 */

import { idbGet, idbPut } from '../media/blobStore';

/** Docs saved before the library feature shared this single key. */
const LEGACY_AUDIO_KEY = 'audio';

const audioKeyFor = (docId: string): string => `audio:${docId}`;

/** Which library document the singleton currently plays for. */
let currentDocId: string | null = null;

let audioEl: HTMLAudioElement | null = null;
let audioBlob: Blob | null = null;
let objectUrl: string | null = null;
let peaksCache: readonly number[] | null = null;
let peaksCacheBins = 0;

function attach(blob: Blob): void {
  if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
  audioBlob = blob;
  objectUrl = URL.createObjectURL(blob);
  audioEl = new Audio(objectUrl);
  audioEl.preload = 'auto';
  peaksCache = null;
}

function detach(): void {
  if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
  audioEl = null;
  audioBlob = null;
  objectUrl = null;
  peaksCache = null;
}

export async function setAudioBlob(blob: Blob): Promise<void> {
  attach(blob);
  await idbPut(currentDocId !== null ? audioKeyFor(currentDocId) : LEGACY_AUDIO_KEY, blob);
}

let loadPromise: Promise<boolean> | null = null;

/**
 * Point the audio singleton at a library document, restoring its persisted
 * track (each choreography keeps its own audio). Resolves true if audio
 * exists. Concurrent calls for the SAME doc (React StrictMode double-mounts
 * effects) share one in-flight load, otherwise the second attach() would
 * revoke the blob URL the first Audio element is still reading.
 */
export function switchAudioToDoc(docId: string): Promise<boolean> {
  if (currentDocId === docId && loadPromise !== null) return loadPromise;
  currentDocId = docId;
  loadPromise = (async (): Promise<boolean> => {
    detach();
    let blob = await idbGet(audioKeyFor(docId));
    if (blob === null) {
      // Pre-library audio lived under one shared key — adopt it into the
      // first doc that loads after the upgrade (the doc that owned it).
      const legacy = await idbGet(LEGACY_AUDIO_KEY);
      if (legacy !== null) {
        await idbPut(audioKeyFor(docId), legacy);
        await idbPut(LEGACY_AUDIO_KEY, null);
        blob = legacy;
      }
    }
    if (currentDocId !== docId) return false; // a newer switch won the race
    if (blob === null) return false;
    attach(blob);
    return true;
  })();
  return loadPromise;
}

export async function clearAudio(): Promise<void> {
  detach();
  await idbPut(currentDocId !== null ? audioKeyFor(currentDocId) : LEGACY_AUDIO_KEY, null);
}

/** Library duplicate: give the new doc its own reference to the same track. */
export async function copyAudioBetweenDocs(fromDocId: string, toDocId: string): Promise<void> {
  const blob =
    fromDocId === currentDocId && audioBlob !== null
      ? audioBlob
      : await idbGet(audioKeyFor(fromDocId));
  if (blob !== null) await idbPut(audioKeyFor(toDocId), blob);
}

export async function deleteAudioForDoc(docId: string): Promise<void> {
  await idbPut(audioKeyFor(docId), null);
}

/** Store a track before the document that owns it becomes the open one. */
export async function primeAudioForDoc(docId: string, blob: Blob): Promise<void> {
  await idbPut(audioKeyFor(docId), blob);
}

export function getAudioElement(): HTMLAudioElement | null {
  return audioEl;
}

/** Raw uploaded audio, for consumers that need to decode it (video export). */
export function getAudioBlob(): Blob | null {
  return audioBlob;
}

export function audioDurationMs(): number {
  if (audioEl === null || !Number.isFinite(audioEl.duration)) return 0;
  return audioEl.duration * 1000;
}

/** Max-abs amplitude per bin, normalized to [0, 1]. */
export async function getWaveformPeaks(bins: number): Promise<readonly number[]> {
  if (audioBlob === null) return [];
  if (peaksCache !== null && peaksCacheBins === bins) return peaksCache;

  const arrayBuffer = await audioBlob.arrayBuffer();
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(arrayBuffer);
    const channel = decoded.getChannelData(0);
    const perBin = Math.max(Math.floor(channel.length / bins), 1);
    const peaks: number[] = new Array<number>(bins).fill(0);
    for (let bin = 0; bin < bins; bin++) {
      let max = 0;
      const start = bin * perBin;
      const end = Math.min(start + perBin, channel.length);
      for (let i = start; i < end; i++) {
        const v = Math.abs(channel[i] ?? 0);
        if (v > max) max = v;
      }
      peaks[bin] = max;
    }
    const top = Math.max(...peaks, 1e-6);
    const normalized = peaks.map((p) => p / top);
    peaksCache = normalized;
    peaksCacheBins = bins;
    return normalized;
  } finally {
    void ctx.close();
  }
}
