import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react';
import type { Formation } from '@gridstage/shared-types';
import { useEditor } from '../state/store';
import {
  byOrder,
  effectiveCountSegments,
  eightCountMarks,
  showEndMs,
  snapToFormationEdges,
  timeRulerTicks,
} from '../state/interpolate';
import { audioDurationMs, getAudioElement, getWaveformPeaks } from '../audio/audioPlayer';
import { useRefVideo } from '../state/refVideo';
import { BeatDialog } from './BeatDialog';
import { useT } from '../i18n';

const MIN_TIMELINE_MS = 30_000;
const WAVEFORM_BINS = 600;
const MIN_ZOOM = 1;
const MAX_ZOOM = 24;
const DRAG_THRESHOLD_PX = 4;

const clampZoom = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/** 0.5×–2.0× in 0.1 steps ((5+i)/10 avoids float drift like 0.7000…01). */
const PLAYBACK_SPEEDS = Array.from({ length: 16 }, (_, i) => (5 + i) / 10);

interface TimelineProps {
  /** Bumped by the app whenever audio is loaded/cleared, to redraw the waveform. */
  audioVersion: number;
  onTogglePlay: () => void;
  onUploadAudio: () => void;
  onClearAudio: () => void;
}

interface DragState {
  id: string;
  /** Pointer-time minus formation start at grab, so the block doesn't jump. */
  grabOffsetMs: number;
  downX: number;
  moved: boolean;
}

export function Timeline({
  audioVersion,
  onTogglePlay,
  onUploadAudio,
  onClearAudio,
}: TimelineProps): ReactElement {
  const t = useT();
  const formations = useEditor((s) => s.formations);
  const playbackRate = useEditor((s) => s.playbackRate);
  const setPlaybackRate = useEditor((s) => s.setPlaybackRate);
  const metronomeOn = useEditor((s) => s.metronomeOn);
  const setMetronomeOn = useEditor((s) => s.setMetronomeOn);
  const loopOn = useEditor((s) => s.loopOn);
  const setLoopOn = useEditor((s) => s.setLoopOn);
  const loopStartMs = useEditor((s) => s.loopStartMs);
  const loopEndMs = useEditor((s) => s.loopEndMs);
  const setLoopRange = useEditor((s) => s.setLoopRange);
  const beatMarkersMs = useEditor((s) => s.performance.beatMarkersMs);
  const bpm = useEditor((s) => s.performance.bpm);
  const selectedFormationId = useEditor((s) => s.selectedFormationId);
  const playheadMs = useEditor((s) => s.playheadMs);
  const isPlaying = useEditor((s) => s.isPlaying);
  const addFormation = useEditor((s) => s.addFormation);
  const selectFormation = useEditor((s) => s.selectFormation);
  const setPlayhead = useEditor((s) => s.setPlayhead);
  const addBeatMarker = useEditor((s) => s.addBeatMarker);
  const removeBeatMarker = useEditor((s) => s.removeBeatMarker);
  const sections = useEditor((s) => s.performance.sections);
  const countSegments = useEditor((s) => s.performance.countSegments);
  const addSection = useEditor((s) => s.addSection);
  const renameSection = useEditor((s) => s.renameSection);
  const removeSection = useEditor((s) => s.removeSection);
  const [editingSection, setEditingSection] = useState<string | null>(null);

  const bodyRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const waveformRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const refVideoInputRef = useRef<HTMLInputElement>(null);
  // When a zoom changes, keep this time anchored under this viewport-x pixel.
  const anchorRef = useRef<{ ms: number; px: number } | null>(null);

  const [bodyWidth, setBodyWidth] = useState(0);
  const [hasAudio, setHasAudio] = useState(false);
  const [zoom, setZoom] = useState(1);
  // A loaded reference video is the playback clock AND the sound — uploading
  // separate music alongside it would fight it, so the button locks.
  const hasRefVideo = useRefVideo((s) => s.objectUrl !== null);

  const totalMs = Math.max(showEndMs(formations), audioDurationMs(), MIN_TIMELINE_MS);
  const contentWidth = Math.max(bodyWidth * zoom, bodyWidth);
  const msToPx = useCallback(
    (ms: number): number => (totalMs > 0 ? (ms / totalMs) * contentWidth : 0),
    [contentWidth, totalMs],
  );

  /** Viewport-relative pointer x → time (accounts for zoom and scroll). */
  const clientXToMs = useCallback(
    (clientX: number): number => {
      const el = contentRef.current;
      if (el === null) return 0;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0) return 0;
      return Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1) * totalMs;
    },
    [totalMs],
  );

  useEffect(() => {
    const el = bodyRef.current;
    if (el === null) return;
    const observer = new ResizeObserver(() => setBodyWidth(el.clientWidth));
    observer.observe(el);
    setBodyWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  // Ctrl + wheel zooms, anchored on the cursor. Native non-passive listener so
  // preventDefault stops the browser's page zoom.
  useEffect(() => {
    const viewport = bodyRef.current;
    if (viewport === null) return;
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const cursorPx = e.clientX - rect.left;
      const spanPx = viewport.clientWidth * zoom;
      const ms = spanPx > 0 ? ((viewport.scrollLeft + cursorPx) / spanPx) * totalMs : 0;
      anchorRef.current = { ms, px: cursorPx };
      setZoom((z) => clampZoom(z * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, [zoom, totalMs]);

  // Apply the pending zoom anchor after the width changes.
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const viewport = bodyRef.current;
    if (anchor === null || viewport === null) return;
    const spanPx = viewport.clientWidth * zoom;
    viewport.scrollLeft = Math.max(0, (anchor.ms / totalMs) * spanPx - anchor.px);
    anchorRef.current = null;
  }, [zoom, totalMs, bodyWidth]);

  // Keep the playhead on screen while playing and zoomed in.
  useEffect(() => {
    if (!isPlaying) return;
    const viewport = bodyRef.current;
    if (viewport === null) return;
    const px = msToPx(playheadMs);
    const left = viewport.scrollLeft;
    const right = left + viewport.clientWidth;
    if (px < left || px > right - 24) {
      viewport.scrollLeft = Math.max(0, px - viewport.clientWidth * 0.3);
    }
  }, [playheadMs, isPlaying, msToPx]);

  // Waveform: painted on audio or width change, sized to the zoomed content.
  useEffect(() => {
    setHasAudio(getAudioElement() !== null);
    const canvas = waveformRef.current;
    if (canvas === null || contentWidth === 0) return;
    canvas.width = Math.round(contentWidth);
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (getAudioElement() === null) return;

    let cancelled = false;
    void getWaveformPeaks(WAVEFORM_BINS).then((peaks) => {
      if (cancelled || peaks.length === 0) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(26, 115, 232, 0.45)';
      const mid = canvas.height / 2;
      // Waveform spans only the audio's share of the timeline.
      const audioPx = (audioDurationMs() / totalMs) * canvas.width;
      const binW = audioPx / peaks.length;
      peaks.forEach((peak, i) => {
        const h = Math.max(peak * (canvas.height - 8), 1);
        ctx.fillRect(i * binW, mid - h / 2, Math.max(binW - 0.5, 0.5), h);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [audioVersion, contentWidth, totalMs]);

  const scrubTo = useCallback(
    (clientX: number): void => {
      const ms = clientXToMs(clientX);
      setPlayhead(ms);
      const audio = getAudioElement();
      if (audio !== null) audio.currentTime = ms / 1000;
    },
    [clientXToMs, setPlayhead],
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.target instanceof HTMLElement && e.target.dataset['skipScrub'] === 'true') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubTo(e.clientX);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) scrubTo(e.clientX);
  };

  // Loop posts: drag either post; edges of formations magnetize (~8px).
  const onLoopPostPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onLoopPostPointerMove = (
    e: ReactPointerEvent<HTMLDivElement>,
    which: 'start' | 'end',
  ): void => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    if (loopStartMs === null || loopEndMs === null) return;
    const toleranceMs = contentWidth > 0 ? (8 / contentWidth) * totalMs : 0;
    const ms = snapToFormationEdges(clientXToMs(e.clientX), formations, toleranceMs);
    if (which === 'start') setLoopRange(Math.min(ms, loopEndMs - 200), loopEndMs);
    else setLoopRange(loopStartMs, Math.max(ms, loopStartMs + 200));
  };

  const beatMs = bpm !== null ? 60_000 / bpm : null;

  const onFormationPointerDown = (e: ReactPointerEvent<HTMLDivElement>, f: Formation): void => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      id: f.id,
      grabOffsetMs: clientXToMs(e.clientX) - f.startTimeMs,
      downX: e.clientX,
      moved: false,
    };
  };

  const onFormationPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (drag === null) return;
    if (!drag.moved) {
      if (Math.abs(e.clientX - drag.downX) < DRAG_THRESHOLD_PX) return;
      drag.moved = true;
      // One undo step for the whole drag, captured before the first move.
      useEditor.getState().pushHistory();
    }
    let start = clientXToMs(e.clientX) - drag.grabOffsetMs;
    // Snap to the nearest beat when BPM is known; hold Alt for free placement.
    // The beat grid anchors on the containing count segment's start (count 1
    // rarely lands on 0:00), falling back to 0 outside every segment.
    if (beatMs !== null && !e.altKey) {
      let anchorMs = 0;
      for (const seg of effectiveCountSegments(countSegments, totalMs)) {
        if (start >= seg.startMs) anchorMs = seg.startMs;
      }
      start = anchorMs + Math.round((start - anchorMs) / beatMs) * beatMs;
    }
    useEditor.getState().setFormationStartLive(drag.id, start);
  };

  const onFormationPointerUp = (f: Formation): void => {
    dragRef.current = null;
    selectFormation(f.id);
  };

  // Resize a formation by dragging its left/right edge. Live changes show via
  // resizePreview (no store churn); the store commits once on pointer up.
  const resizeRef = useRef<{
    id: string;
    edge: 'left' | 'right';
    downX: number;
    origStart: number;
    origDur: number;
  } | null>(null);
  const [resizePreview, setResizePreview] = useState<{
    id: string;
    startMs: number;
    durMs: number;
  } | null>(null);
  const MIN_HOLD_MS = 500;

  const onResizeDown = (
    e: ReactPointerEvent<HTMLDivElement>,
    f: Formation,
    edge: 'left' | 'right',
  ): void => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    selectFormation(f.id);
    resizeRef.current = {
      id: f.id,
      edge,
      downX: e.clientX,
      origStart: f.startTimeMs,
      origDur: f.durationMs,
    };
  };
  const onResizeMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const r = resizeRef.current;
    if (r === null || contentWidth <= 0) return;
    const deltaMs = ((e.clientX - r.downX) / contentWidth) * totalMs;
    if (r.edge === 'right') {
      setResizePreview({
        id: r.id,
        startMs: r.origStart,
        durMs: Math.max(MIN_HOLD_MS, r.origDur + deltaMs),
      });
    } else {
      const end = r.origStart + r.origDur;
      const startMs = Math.min(Math.max(0, r.origStart + deltaMs), end - MIN_HOLD_MS);
      setResizePreview({ id: r.id, startMs, durMs: end - startMs });
    }
  };
  const onResizeUp = (): void => {
    const r = resizeRef.current;
    resizeRef.current = null;
    const preview = resizePreview;
    setResizePreview(null);
    if (r === null || preview === null) return;
    useEditor.getState().updateFormation(r.id, { durationMs: preview.durMs });
    if (r.edge === 'left') useEditor.getState().setFormationStart(r.id, preview.startMs);
  };

  const zoomBy = (factor: number): void => {
    const viewport = bodyRef.current;
    if (viewport !== null) {
      const centerPx = viewport.clientWidth / 2;
      const spanPx = viewport.clientWidth * zoom;
      anchorRef.current = {
        ms: spanPx > 0 ? ((viewport.scrollLeft + centerPx) / spanPx) * totalMs : 0,
        px: centerPx,
      };
    }
    setZoom((z) => clampZoom(z * factor));
  };

  const ordered = byOrder(formations);
  const eightMarks = bpm !== null ? eightCountMarks(totalMs, bpm, countSegments) : [];

  const rulerTicks = timeRulerTicks(totalMs, contentWidth);

  return (
    <section className="timeline-panel" aria-label={t.timeline.panelAria}>
      <h2 className="timeline-heading">{t.timeline.panelAria}</h2>
      <div className="timeline-toolbar">
        <button type="button" className="btn edit-only" onClick={addFormation}>
          {t.timeline.addFormation}
        </button>
        <button
          type="button"
          className="btn edit-only"
          disabled={hasRefVideo}
          title={hasRefVideo ? t.timeline.audioLockedByVideo : undefined}
          onClick={onUploadAudio}
        >
          {hasAudio ? t.timeline.replaceAudio : t.timeline.uploadAudio}
        </button>
        {hasAudio && (
          <button type="button" className="btn btn-danger edit-only" onClick={onClearAudio}>
            {t.timeline.removeAudio}
          </button>
        )}
        <button
          type="button"
          className="btn edit-only expert-only-ui"
          title={t.timeline.refVideoTitle}
          onClick={() => refVideoInputRef.current?.click()}
        >
          {t.timeline.refVideo}
        </button>
        <input
          ref={refVideoInputRef}
          type="file"
          accept="video/*"
          aria-label={t.timeline.refVideoFileAria}
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file !== undefined) useRefVideo.getState().load(file);
          }}
        />
        <button
          type="button"
          className="btn edit-only expert-only-ui"
          title={t.timeline.tapBeatTitle}
          onClick={() => addBeatMarker(useEditor.getState().playheadMs)}
        >
          {t.timeline.tapBeat}
        </button>
        <BeatDialog />
        <button
          type="button"
          className="btn edit-only"
          title={t.timeline.addSectionTitle}
          onClick={() => {
            const id = addSection(useEditor.getState().playheadMs, t.timeline.sectionDefault);
            setEditingSection(id);
          }}
        >
          {t.timeline.addSection}
        </button>
        <button type="button" className="btn btn-primary" onClick={onTogglePlay}>
          {isPlaying ? t.topbar.pause : t.topbar.play}
        </button>
        <button
          type="button"
          className={`btn${loopOn ? ' btn-active' : ''}`}
          aria-pressed={loopOn}
          title={t.timeline.loopTitle}
          onClick={() => {
            if (loopOn) {
              setLoopOn(false);
              return;
            }
            // Fresh posts around the playhead (±4s), clamped into the show.
            const ph = useEditor.getState().playheadMs;
            const end = Math.min(ph + 4000, totalMs);
            setLoopRange(Math.max(0, Math.min(ph - 4000, end - 500)), end);
            setLoopOn(true);
          }}
        >
          {t.timeline.loop}
        </button>
        <button
          type="button"
          className={`btn${metronomeOn ? ' btn-active' : ''}`}
          disabled={bpm === null}
          aria-pressed={metronomeOn}
          title={bpm === null ? t.timeline.metronomeNeedsBpm : t.timeline.metronomeTitle}
          onClick={() => setMetronomeOn(!metronomeOn)}
        >
          {t.timeline.metronome}
        </button>
        <select
          aria-label={t.topbar.playbackSpeedAria}
          title={t.topbar.playbackSpeedAria}
          className="expert-only-ui"
          value={playbackRate.toFixed(1)}
          style={{ width: 66 }}
          onChange={(e) => setPlaybackRate(Number(e.target.value))}
        >
          {PLAYBACK_SPEEDS.map((rate) => (
            <option key={rate} value={rate.toFixed(1)}>
              {rate.toFixed(1)}×
            </option>
          ))}
        </select>
        <div className="zoom-controls">
          <button
            type="button"
            className="btn"
            aria-label={t.timeline.zoomOut}
            disabled={zoom <= MIN_ZOOM}
            onClick={() => zoomBy(1 / 1.5)}
          >
            −
          </button>
          <span className="mono" style={{ minWidth: 46, textAlign: 'center' }}>
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            className="btn"
            aria-label={t.timeline.zoomIn}
            disabled={zoom >= MAX_ZOOM}
            onClick={() => zoomBy(1.5)}
          >
            +
          </button>
        </div>
        <span className="mono" style={{ marginLeft: 'auto' }}>
          {isPlaying ? t.timeline.playing : t.timeline.hint}
        </span>
      </div>
      <div ref={bodyRef} className="timeline-body">
        <div
          ref={contentRef}
          className="timeline-content"
          style={{ width: contentWidth }}
          role="slider"
          aria-label={t.timeline.playheadAria}
          aria-valuemin={0}
          aria-valuemax={Math.round(totalMs)}
          aria-valuenow={Math.round(playheadMs)}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 5000 : 500;
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault();
              const next = playheadMs + (e.key === 'ArrowRight' ? step : -step);
              const clamped = Math.min(Math.max(next, 0), totalMs);
              setPlayhead(clamped);
              const audio = getAudioElement();
              if (audio !== null) audio.currentTime = clamped / 1000;
            }
          }}
        >
          {/* waveform */}
          <canvas
            ref={waveformRef}
            height={52}
            style={{ position: 'absolute', left: 0, top: 16, width: '100%', height: 52 }}
          />
          <div className="timeline-ruler" aria-hidden="true">
            {rulerTicks.map((tick) => (
              <div
                key={tick.ms}
                className={`timeline-tick${tick.major ? ' major' : ''}`}
                style={{ left: msToPx(tick.ms) }}
              >
                {tick.label !== null && <span className="timeline-tick-label">{tick.label}</span>}
              </div>
            ))}
          </div>
          {/* 8-count ruler — marks restart per count segment */}
          {eightMarks.map((mark, i) => (
            <div
              key={`${i}-${mark.ms}`}
              style={{
                position: 'absolute',
                left: msToPx(mark.ms),
                top: 0,
                bottom: 0,
                width: 1,
                background: 'rgba(32, 33, 36, 0.12)',
              }}
            >
              <span
                className="mono"
                style={{ position: 'absolute', top: 2, left: 3, fontSize: 10, opacity: 0.6 }}
              >
                {mark.label}
              </span>
            </div>
          ))}
          {/* loop range — blue band between two draggable posts */}
          {loopOn && loopStartMs !== null && loopEndMs !== null && (
            <>
              <div
                className="loop-band"
                style={{
                  left: msToPx(loopStartMs),
                  width: Math.max(0, msToPx(loopEndMs) - msToPx(loopStartMs)),
                }}
              />
              {(['start', 'end'] as const).map((which) => (
                <div
                  key={which}
                  className="loop-post"
                  data-skip-scrub="true"
                  role="slider"
                  aria-label={which === 'start' ? t.timeline.loopStartAria : t.timeline.loopEndAria}
                  aria-valuemin={0}
                  aria-valuemax={Math.round(totalMs)}
                  aria-valuenow={Math.round(which === 'start' ? loopStartMs : loopEndMs)}
                  style={{ left: msToPx(which === 'start' ? loopStartMs : loopEndMs) - 5 }}
                  onPointerDown={onLoopPostPointerDown}
                  onPointerMove={(e) => onLoopPostPointerMove(e, which)}
                >
                  <div className="loop-post-line" data-skip-scrub="true" />
                </div>
              ))}
            </>
          )}
          {/* section markers — faint full-height divider + a small top label */}
          {sections.map((sec) => (
            <div
              key={sec.id}
              data-skip-scrub="true"
              style={{
                position: 'absolute',
                left: msToPx(sec.timeMs),
                top: 0,
                bottom: 0,
                zIndex: 3,
              }}
            >
              <div
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  top: 18,
                  bottom: 0,
                  left: 0,
                  width: 1,
                  background: 'rgba(88, 181, 164, 0.35)',
                }}
              />
              {editingSection === sec.id ? (
                <input
                  data-skip-scrub="true"
                  aria-label={t.timeline.renameSectionAria}
                  defaultValue={sec.name}
                  autoFocus
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 1,
                    width: 84,
                    fontSize: 11,
                    padding: '1px 3px',
                  }}
                  onBlur={(e) => {
                    renameSection(sec.id, e.target.value.trim() || t.timeline.sectionDefault);
                    setEditingSection(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                    if (e.key === 'Escape') setEditingSection(null);
                  }}
                />
              ) : (
                <span data-skip-scrub="true" className="section-flag">
                  <span
                    data-skip-scrub="true"
                    onClick={() => setEditingSection(sec.id)}
                    style={{ cursor: 'text' }}
                  >
                    {sec.name}
                  </span>
                  <button
                    type="button"
                    data-skip-scrub="true"
                    className="section-flag-x"
                    aria-label={t.timeline.removeSectionAria(sec.name)}
                    onClick={() => removeSection(sec.id)}
                  >
                    ×
                  </button>
                </span>
              )}
            </div>
          ))}
          {/* beat markers */}
          {beatMarkersMs.map((markMs) => (
            <button
              key={markMs}
              type="button"
              data-skip-scrub="true"
              aria-label={t.timeline.removeBeatAria((markMs / 1000).toFixed(1))}
              onClick={() => removeBeatMarker(markMs)}
              style={{
                position: 'absolute',
                left: msToPx(markMs) - 2,
                top: 30,
                width: 5,
                height: 82,
                padding: 0,
                border: 'none',
                cursor: 'pointer',
                background: 'transparent',
              }}
            >
              <span
                data-skip-scrub="true"
                style={{
                  display: 'block',
                  width: 1.5,
                  height: '100%',
                  margin: '0 auto',
                  background: '#1a73e8',
                  opacity: 0.85,
                }}
              />
            </button>
          ))}
          {/* formation blocks */}
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 8, height: 44 }}>
            {ordered.map((f, i) => {
              const selected = f.id === selectedFormationId;
              const next = ordered[i + 1];
              const resizing = resizePreview?.id === f.id ? resizePreview : null;
              const startMs = resizing?.startMs ?? f.startTimeMs;
              const durMs = resizing?.durMs ?? f.durationMs;
              const holdEnd = startMs + durMs;
              const edgeStyle = {
                position: 'absolute' as const,
                top: 0,
                bottom: 0,
                width: 7,
                cursor: 'ew-resize' as const,
                touchAction: 'none' as const,
              };
              return (
                <div key={f.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    aria-pressed={selected}
                    aria-label={t.timeline.formationAria(f.name, (f.startTimeMs / 1000).toFixed(1))}
                    data-skip-scrub="true"
                    onPointerDown={(e) => onFormationPointerDown(e, f)}
                    onPointerMove={onFormationPointerMove}
                    onPointerUp={() => onFormationPointerUp(f)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        selectFormation(f.id);
                      }
                    }}
                    style={{
                      position: 'absolute',
                      left: msToPx(startMs),
                      width: Math.max(msToPx(durMs), 34),
                      height: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      background: selected ? '#e8f0fe' : '#ffffff',
                      border: `1px solid ${selected ? '#1a73e8' : '#dadce0'}`,
                      // The formation's label color, as a flag along the left edge.
                      ...(f.color !== undefined && { borderLeft: `4px solid ${f.color}` }),
                      borderRadius: 4,
                      color: '#202124',
                      fontFamily: "'Roboto Variable', sans-serif",
                      fontSize: 11,
                      cursor: 'grab',
                      touchAction: 'none',
                      overflow: 'hidden',
                      whiteSpace: 'nowrap',
                      textOverflow: 'ellipsis',
                      padding: '0 6px',
                    }}
                  >
                    {f.name}
                    {/* drag the edges to lengthen/shorten the hold */}
                    <div
                      data-skip-scrub="true"
                      aria-label={t.timeline.resizeStartAria}
                      onPointerDown={(e) => onResizeDown(e, f, 'left')}
                      onPointerMove={onResizeMove}
                      onPointerUp={onResizeUp}
                      style={{ ...edgeStyle, left: 0 }}
                    />
                    <div
                      data-skip-scrub="true"
                      aria-label={t.timeline.resizeEndAria}
                      onPointerDown={(e) => onResizeDown(e, f, 'right')}
                      onPointerMove={onResizeMove}
                      onPointerUp={onResizeUp}
                      style={{ ...edgeStyle, right: 0 }}
                    />
                  </div>
                  {next !== undefined && next.startTimeMs > holdEnd && (
                    <div
                      aria-hidden="true"
                      style={{
                        position: 'absolute',
                        left: msToPx(holdEnd),
                        width: msToPx(next.startTimeMs - holdEnd),
                        top: '50%',
                        borderTop: '1px dashed rgba(95, 99, 104, 0.55)',
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
          {/* playhead */}
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: msToPx(playheadMs),
              top: 0,
              bottom: 0,
              width: 1.5,
              background: '#1a73e8',
              pointerEvents: 'none',
            }}
          />
        </div>
      </div>
    </section>
  );
}
