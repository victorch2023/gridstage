import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactElement, RefObject } from 'react';
import { useRefVideo } from '../state/refVideo';
import { useEditor } from '../state/store';
import { applyHomography, invertHomography, solveHomography } from '../vision/homography';
import type { Point2 } from '../vision/homography';
import { useT } from '../i18n';

/**
 * Stage-corner calibration on top of the reference video: four draggable
 * pins (stored in video-intrinsic pixels) and a live 1m grid reprojected
 * back onto the frame — the grid hugging the floor IS the proof the
 * calibration is right, so the user trusts their eyes, not a black box.
 * Homographies map straight lines to straight lines, so every grid line
 * needs only its two endpoints.
 */
export function CalibrationOverlay({
  videoRef,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
}): ReactElement | null {
  const t = useT();
  const corners = useRefVideo((s) => s.corners);
  const setCorners = useRefVideo((s) => s.setCorners);
  const stageWidth = useEditor((s) => s.performance.stageWidth);
  const stageHeight = useEditor((s) => s.performance.stageHeight);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dragIndexRef = useRef<number | null>(null);
  // The video's displayed content box (object-fit: contain letterboxing),
  // in OVERLAY coordinates — while calibrating the video is shrunk and
  // centered inside the frame, so the overlay extends beyond the picture
  // and pins may sit outside it (off-frame stage corners).
  const [fit, setFit] = useState({ scale: 1, offsetX: 0, offsetY: 0, w: 0, h: 0 });

  useEffect(() => {
    const video = videoRef.current;
    const overlay = overlayRef.current;
    if (video === null || overlay === null) return;
    const measure = (): void => {
      const vw = video.videoWidth || 1;
      const vh = video.videoHeight || 1;
      const cw = video.clientWidth;
      const ch = video.clientHeight;
      const scale = Math.min(cw / vw, ch / vh);
      // offsetLeft/Top are relative to .ref-video-frame, which is also the
      // overlay's origin (both are positioned by it).
      setFit({
        scale,
        offsetX: video.offsetLeft + (cw - vw * scale) / 2,
        offsetY: video.offsetTop + (ch - vh * scale) / 2,
        w: overlay.clientWidth,
        h: overlay.clientHeight,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(video);
    observer.observe(overlay);
    video.addEventListener('loadedmetadata', measure);
    return () => {
      observer.disconnect();
      video.removeEventListener('loadedmetadata', measure);
    };
  }, [videoRef]);

  const video = videoRef.current;
  if (video === null) return null;
  const vw = video.videoWidth || 1;
  const vh = video.videoHeight || 1;

  // Default pins: a centered trapezoid, roughly how an elevated camera
  // sees a stage — recognizable as "grab these and drag them to the corners".
  const pins: Point2[] = corners ?? [
    { x: vw * 0.3, y: vh * 0.35 },
    { x: vw * 0.7, y: vh * 0.35 },
    { x: vw * 0.85, y: vh * 0.85 },
    { x: vw * 0.15, y: vh * 0.85 },
  ];

  const toOverlay = (p: Point2): Point2 => ({
    x: p.x * fit.scale + fit.offsetX,
    y: p.y * fit.scale + fit.offsetY,
  });
  const toIntrinsic = (p: Point2): Point2 => ({
    x: (p.x - fit.offsetX) / fit.scale,
    y: (p.y - fit.offsetY) / fit.scale,
  });

  // Grid: stage meters -> video intrinsic px via the INVERSE homography.
  const stageCorners: Point2[] = [
    { x: 0, y: 0 },
    { x: stageWidth, y: 0 },
    { x: stageWidth, y: stageHeight },
    { x: 0, y: stageHeight },
  ];
  const h = solveHomography(pins, stageCorners);
  const inv = h === null ? null : invertHomography(h);
  const gridLines: { a: Point2; b: Point2 }[] = [];
  if (inv !== null) {
    const project = (mx: number, my: number): Point2 =>
      toOverlay(applyHomography(inv, { x: mx, y: my }));
    for (let gx = 0; gx <= stageWidth; gx += 1) {
      gridLines.push({ a: project(gx, 0), b: project(gx, stageHeight) });
    }
    for (let gy = 0; gy <= stageHeight; gy += 1) {
      gridLines.push({ a: project(0, gy), b: project(stageWidth, gy) });
    }
  }

  const onPointerDown = (index: number) => (e: ReactPointerEvent<SVGCircleElement>) => {
    dragIndexRef.current = index;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.stopPropagation();
  };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>): void => {
    const index = dragIndexRef.current;
    if (index === null) return;
    const rect = e.currentTarget.getBoundingClientRect();
    // Deliberately unclamped: a camera often cuts off a stage corner, so a
    // pin must be allowed to sit outside the picture — the homography is
    // just as valid there.
    const intrinsic = toIntrinsic({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    const next = pins.map((p, i) => (i === index ? intrinsic : p));
    setCorners(next);
  };
  const onPointerUp = (): void => {
    dragIndexRef.current = null;
    // First interaction materializes the default pins into the store.
    if (useRefVideo.getState().corners === null) setCorners(pins);
  };

  const cornerLabels = [
    t.refVideo.cornerUpLeft,
    t.refVideo.cornerUpRight,
    t.refVideo.cornerDownRight,
    t.refVideo.cornerDownLeft,
  ];

  return (
    <div ref={overlayRef} className="calibration-overlay">
      <svg
        width={fit.w}
        height={fit.h}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        role="application"
        aria-label={t.refVideo.calibrationAria}
      >
        {gridLines.map((line, i) => (
          <line
            key={i}
            x1={line.a.x}
            y1={line.a.y}
            x2={line.b.x}
            y2={line.b.y}
            stroke="#4cc38a"
            strokeWidth={1}
            opacity={0.55}
          />
        ))}
        {h === null && fit.w > 0 && (
          <text x={12} y={24} fill="#e05252" fontSize={13}>
            {t.refVideo.degenerateCorners}
          </text>
        )}
        {pins.map((p, i) => {
          const o = toOverlay(p);
          return (
            <g key={i}>
              <circle
                cx={o.x}
                cy={o.y}
                r={14}
                fill="rgba(26,115,232,0.16)"
                stroke="#1a73e8"
                strokeWidth={2}
                style={{ cursor: 'grab', touchAction: 'none' }}
                onPointerDown={onPointerDown(i)}
                aria-label={cornerLabels[i]}
              />
              <text x={o.x + 16} y={o.y + 4} fill="#1a73e8" fontSize={11}>
                {cornerLabels[i]}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
