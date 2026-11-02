import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import { exportableState } from '../state/store';
import { showEndMs } from '../state/interpolate';
import { messages } from '../i18n';
import { build2dRenderer } from './video';
import { safeFilename } from './filename';

// Rendered offline (no realtime capture): small and low-fps on purpose —
// a GIF is for the group chat, the video export is the full-quality path.
const GIF_W = 640;
const GIF_H = 360;
const FPS = 8;
// build2dRenderer draws at a fixed 1280x720 layout.
const SRC_W = 1280;
const SRC_H = 720;

/**
 * Whole-show animated GIF of the 2D plan. Rendered faster than realtime;
 * progress is reported per frame and the signal cancels between frames.
 */
export async function exportPerformanceGif({
  onProgress,
  signal,
}: {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
} = {}): Promise<void> {
  const s = exportableState();
  const endMs = showEndMs(s.formations);
  if (endMs <= 0) return;

  const full = document.createElement('canvas');
  full.width = SRC_W;
  full.height = SRC_H;
  const draw = build2dRenderer(
    full,
    {
      performance: s.performance,
      performers: s.performers,
      props: s.props,
      fixtures: s.fixtures,
      captions: s.captions,
      formations: s.formations,
      positions: s.positions,
    },
    messages(),
  );
  const small = document.createElement('canvas');
  small.width = GIF_W;
  small.height = GIF_H;
  const ctx = small.getContext('2d', { willReadFrequently: true });
  if (ctx === null) throw new Error('canvas 2d context unavailable');

  const gif = GIFEncoder();
  const delayMs = 1000 / FPS;
  const frameCount = Math.ceil(endMs / delayMs);
  for (let i = 0; i <= frameCount; i++) {
    if (signal?.aborted === true) return;
    draw(Math.min(endMs, i * delayMs));
    ctx.drawImage(full, 0, 0, GIF_W, GIF_H);
    const { data } = ctx.getImageData(0, 0, GIF_W, GIF_H);
    const palette = quantize(data, 256);
    gif.writeFrame(applyPalette(data, palette), GIF_W, GIF_H, { palette, delay: delayMs });
    onProgress?.(i / frameCount);
    // Yield so the dialog's progress and cancel button stay responsive.
    if (i % 4 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  gif.finish();

  const url = URL.createObjectURL(new Blob([gif.bytes()], { type: 'image/gif' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${safeFilename(s.performance.title)}.gif`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
