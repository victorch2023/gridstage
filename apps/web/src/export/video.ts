import { exportableState } from '../state/store';
import { formatEightCount, formatTimecode, posesAtTime, showEndMs } from '../state/interpolate';
import { propOutline } from '../state/props';
import { timelineMsToVideoSeconds, useRefVideo } from '../state/refVideo';
import { safeFilename } from './filename';
import { messages } from '../i18n';
import type { Messages } from '../i18n';
import { recordCanvas } from './videoRecorder';
import type { SceneDoc } from './stage3dRenderer';

// 720p — plenty for sharing a formation preview in a group chat.
const W = 1280;
const H = 720;

const BG = '#f8f9fa';
const FLOOR = '#ffffff';
const INK = '#202124';
const DIM = '#5f6368';
const EDGE = '#1a73e8';
const SANS = '"Roboto Variable", system-ui, sans-serif';
const MONO = '"Roboto Mono", monospace';

export type VideoMode = '2d' | '3d';
/** How the loaded reference video appears in the exported movie (2D only). */
export type RefVideoInExport = 'off' | 'pip' | 'side';

export interface VideoExportOptions {
  /** '2d' = top-down plan, '3d' = the perspective preview. */
  mode: VideoMode;
  /** Ignored when no reference video is loaded. Defaults to 'off'. */
  refVideo?: RefVideoInExport;
  onProgress: (fraction: number) => void;
  signal?: AbortSignal;
}

/**
 * Records the playback animation to a movie file and triggers a download.
 * The 2D plan is drawn here on a canvas; the 3D view renders through a
 * dynamically-imported three renderer so its ~900KB only loads for 3D.
 * The uploaded music is mixed into the file (silently). Document state is
 * snapshotted once at the start, so edits during the export don't leak in.
 *
 * ponytail: realtime capture — the export takes as long as the show and the
 * tab must stay visible. Upgrade path: WebCodecs VideoEncoder + an mp4 muxer.
 */
export async function exportPerformanceVideo({
  mode,
  refVideo = 'off',
  onProgress,
  signal,
}: VideoExportOptions): Promise<void> {
  const s = exportableState();
  const msg = messages();
  const durationMs = showEndMs(s.formations);
  if (durationMs <= 0) throw new Error(msg.videoExport.errNothingToExport);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  // Chrome only delivers captureStream frames reliably for in-document canvases.
  canvas.style.cssText = 'position:fixed;left:-99999px;top:0';
  document.body.appendChild(canvas);

  const doc: SceneDoc = {
    performance: s.performance,
    performers: s.performers,
    props: s.props,
    fixtures: s.fixtures,
    captions: s.captions,
    formations: s.formations,
    positions: s.positions,
  };

  // A loaded reference video is the export's SOUND (same clock ladder as
  // playback) via its own hidden element — the visible one keeps playing for
  // the user. Its picture is composited only for 'pip'/'side' in 2D.
  const refState = useRefVideo.getState();
  const refEl = refState.objectUrl !== null ? await loadHiddenVideo(refState.objectUrl) : null;
  if (refEl !== null) {
    refEl.currentTime = timelineMsToVideoSeconds(0, refState.offsetMs);
  }
  const composite = refEl !== null && mode === '2d' && refVideo !== 'off' ? refVideo : null;

  let dispose: (() => void) | null = null;
  try {
    let renderFrame: (tMs: number) => void;
    if (mode === '3d') {
      const { buildStage3dRenderer } = await import('./stage3dRenderer');
      const renderer = buildStage3dRenderer(canvas, doc);
      renderFrame = renderer.renderFrame;
      dispose = renderer.dispose;
    } else if (composite !== null && refEl !== null) {
      renderFrame = buildCompositeRenderer(canvas, doc, msg, refEl, composite);
    } else {
      renderFrame = build2dRenderer(canvas, doc, msg);
    }

    const result = await recordCanvas({
      canvas,
      durationMs,
      renderFrame,
      onProgress,
      signal,
      ...(refEl !== null ? { audioElement: refEl, onRecordStart: () => void refEl.play() } : {}),
    });
    if (result === null) return; // aborted

    const url = URL.createObjectURL(result.blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    const suffix = mode === '3d' ? '3d' : 'preview';
    anchor.download = `${safeFilename(s.performance.title)}-${suffix}.${result.ext}`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } finally {
    dispose?.();
    canvas.remove();
    refEl?.remove();
  }
}

/** Off-DOM video element for the export, resolved once it can be drawn. */
function loadHiddenVideo(src: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const el = document.createElement('video');
    el.preload = 'auto';
    el.playsInline = true;
    el.src = src;
    el.addEventListener('loadeddata', () => resolve(el), { once: true });
    el.addEventListener('error', () => reject(new Error('reference video failed to load')), {
      once: true,
    });
  });
}

/** Fit a source rectangle into a box, preserving aspect ratio (centered). */
function fitRect(
  srcW: number,
  srcH: number,
  boxX: number,
  boxY: number,
  boxW: number,
  boxH: number,
): { x: number; y: number; w: number; h: number } {
  const scale = srcW > 0 && srcH > 0 ? Math.min(boxW / srcW, boxH / srcH) : 1;
  const w = srcW * scale;
  const h = srcH * scale;
  return { x: boxX + (boxW - w) / 2, y: boxY + (boxH - h) / 2, w, h };
}

/**
 * 2D chart + the reference video on one canvas: 'pip' = video in the top
 * right (~1/4 width), 'side' = video left half, chart right half.
 */
function buildCompositeRenderer(
  canvas: HTMLCanvasElement,
  doc: SceneDoc,
  msg: Messages,
  refEl: HTMLVideoElement,
  layout: 'pip' | 'side',
): (tMs: number) => void {
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('Canvas 2D unavailable');
  // The chart draws at its fixed 1280x720 on a base canvas, then lands here.
  const base = document.createElement('canvas');
  base.width = W;
  base.height = H;
  const drawBase = build2dRenderer(base, doc, msg);

  return (tMs: number): void => {
    drawBase(tMs);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    const vw = refEl.videoWidth;
    const vh = refEl.videoHeight;
    if (layout === 'side') {
      const video = fitRect(vw, vh, 0, 0, W / 2, H);
      ctx.drawImage(refEl, video.x, video.y, video.w, video.h);
      const chart = fitRect(W, H, W / 2, 0, W / 2, H);
      ctx.drawImage(base, chart.x, chart.y, chart.w, chart.h);
    } else {
      ctx.drawImage(base, 0, 0);
      const pipW = W / 4;
      const video = fitRect(vw, vh, W - pipW - 16, 16, pipW, (pipW * 3) / 4);
      ctx.drawImage(refEl, video.x, video.y, video.w, video.h);
      ctx.strokeStyle = DIM;
      ctx.lineWidth = 1;
      ctx.strokeRect(video.x, video.y, video.w, video.h);
    }
  };
}

/**
 * Top-down plan renderer: closes over the layout, returns a per-frame draw.
 * Draws at the module's fixed 1280x720 — the canvas must match W/H.
 * Also reused by the PNG snapshot exporter.
 */
export function build2dRenderer(
  canvas: HTMLCanvasElement,
  doc: SceneDoc,
  msg: Messages,
): (tMs: number) => void {
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('Canvas 2D unavailable');

  const { stageWidth, stageHeight, title, bpm } = doc.performance;
  const headerH = 72;
  const footerH = 56;
  const sideM = 72;
  const scale = Math.min((W - sideM * 2) / stageWidth, (H - headerH - footerH) / stageHeight);
  const stageW = stageWidth * scale;
  const stageH = stageHeight * scale;
  const originX = (W - stageW) / 2;
  const originY = headerH + (H - headerH - footerH - stageH) / 2;
  const markR = Math.max(0.3 * scale, 7);
  // Audience at the top = the plan rotated 180° (performer view).
  const flip = doc.performance.audienceAt === 'top';

  return (tMs: number): void => {
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);

    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = INK;
    ctx.font = `600 26px ${SANS}`;
    ctx.textAlign = 'left';
    ctx.fillText(title, sideM, 46);
    ctx.fillStyle = DIM;
    ctx.font = `16px ${MONO}`;
    ctx.textAlign = 'right';
    const eightCount =
      bpm !== null ? formatEightCount(tMs, bpm, doc.performance.countSegments) : null;
    const counts = eightCount !== null ? `  ${eightCount}` : '';
    ctx.fillText(`${formatTimecode(tMs)}${counts}`, W - sideM, 46);

    ctx.fillStyle = FLOOR;
    ctx.fillRect(originX, originY, stageW, stageH);
    ctx.strokeStyle = DIM;
    ctx.lineWidth = 1;
    ctx.strokeRect(originX, originY, stageW, stageH);

    // 1-meter grid — same reference lines the editor canvas shows.
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.beginPath();
    for (let m = 1; m < stageWidth; m++) {
      ctx.moveTo(originX + m * scale, originY);
      ctx.lineTo(originX + m * scale, originY + stageH);
    }
    for (let m = 1; m < stageHeight; m++) {
      ctx.moveTo(originX, originY + m * scale);
      ctx.lineTo(originX + stageW, originY + m * scale);
    }
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = EDGE;
    ctx.setLineDash([6, 6]);
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.moveTo(originX + stageW / 2, originY);
    ctx.lineTo(originX + stageW / 2, originY + stageH);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = EDGE;
    ctx.fillRect(originX, flip ? originY - 7 : originY + stageH + 4, stageW, 3);
    ctx.fillStyle = DIM;
    ctx.font = `13px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.fillText(msg.stage.audience, W / 2, flip ? originY - 14 : originY + stageH + 28);

    const poses = posesAtTime(doc.formations, doc.positions, tMs);

    for (const piece of doc.fixtures ?? []) {
      const x = originX + (flip ? stageWidth - piece.x : piece.x) * scale;
      const y = originY + (flip ? stageHeight - piece.y : piece.y) * scale;
      const wPx = piece.width * scale;
      const hPx = piece.height * scale;
      ctx.save();
      ctx.translate(x, y);
      if (flip) ctx.rotate(Math.PI);
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = piece.color;
      ctx.fillRect(-wPx / 2, -hPx / 2, wPx, hPx);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = piece.color;
      ctx.lineWidth = 2;
      ctx.strokeRect(-wPx / 2, -hPx / 2, wPx, hPx);
      ctx.fillStyle = INK;
      ctx.font = `12px ${MONO}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(piece.label, 0, 0);
      ctx.restore();
    }
    for (const piece of doc.captions ?? []) {
      const x = originX + (flip ? stageWidth - piece.x : piece.x) * scale;
      const y = originY + (flip ? stageHeight - piece.y : piece.y) * scale;
      ctx.save();
      ctx.translate(x, y);
      if (flip) ctx.rotate(Math.PI);
      ctx.fillStyle = piece.color;
      ctx.font = `16px ${SANS}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(piece.text, 0, 0);
      ctx.restore();
    }

    // Props: scenery footprints under the dancers.
    for (const prop of doc.props ?? []) {
      const pose = poses.get(prop.id);
      if (pose === undefined) continue;
      const x = originX + (flip ? stageWidth - pose.x : pose.x) * scale;
      const y = originY + (flip ? stageHeight - pose.y : pose.y) * scale;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(((pose.rotation + (flip ? 180 : 0)) * Math.PI) / 180);
      ctx.strokeStyle = prop.color;
      ctx.fillStyle = prop.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (prop.kind === 'circle') {
        ctx.ellipse(0, 0, (prop.width / 2) * scale, (prop.height / 2) * scale, 0, 0, Math.PI * 2);
      } else {
        const pts = propOutline(prop.kind, prop.width, prop.height);
        const [x0, y0] = pts[0] ?? [0, 0];
        ctx.moveTo(x0 * scale, y0 * scale);
        for (const [px, py] of pts.slice(1)) ctx.lineTo(px * scale, py * scale);
        ctx.closePath();
      }
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.fill();
      ctx.restore();
      ctx.stroke();
      ctx.restore();
    }

    for (const performer of doc.performers) {
      const pose = poses.get(performer.id);
      if (pose === undefined) continue;
      const x = originX + (flip ? stageWidth - pose.x : pose.x) * scale;
      const y = originY + (flip ? stageHeight - pose.y : pose.y) * scale;
      // rotation 0 = facing the audience (downstage, +y on the plan;
      // -y when flipped).
      const angleRad = ((pose.rotation + (flip ? 270 : 90)) * Math.PI) / 180;

      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(angleRad) * markR * 1.7, y + Math.sin(angleRad) * markR * 1.7);
      ctx.stroke();

      ctx.fillStyle = performer.color;
      ctx.beginPath();
      ctx.arc(x, y, markR, 0, Math.PI * 2);
      ctx.fill();

      const badge = performer.badge ?? '';
      if (badge !== '') {
        ctx.fillStyle = BG;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const badgePx =
          badge.length <= 1 ? markR * 1.1 : badge.length <= 2 ? markR * 0.8 : markR * 0.5;
        ctx.font = `bold ${badgePx}px ${SANS}`;
        ctx.fillText(badge, x, y + 1);
        ctx.textBaseline = 'alphabetic';
      }

      ctx.fillStyle = INK;
      ctx.font = `12px ${SANS}`;
      ctx.textAlign = 'center';
      ctx.fillText(performer.name, x, y + markR + 16);
    }
  };
}
