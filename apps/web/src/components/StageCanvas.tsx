import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import {
  Stage,
  Layer,
  Rect,
  Line,
  Group,
  Wedge,
  Circle,
  Ellipse,
  Text,
  Shape,
  RegularPolygon,
  Image as KonvaImage,
} from 'react-konva';
import type Konva from 'konva';
import { useEditor } from '../state/store';
import { isPerformerActive } from '@gridstage/shared-types';
import { byOrder, posesAtTime } from '../state/interpolate';
import type { StagePose } from '../state/interpolate';
import { findCrossings } from '@gridstage/path-planner';
import { isCollabActive, setAwarenessCursor } from '../collab/collab';
import { usePeers } from '../hooks/usePeers';
import { useReadOnly } from '../state/viewMode';
import { useLayout } from '../state/layout';
import { useStageBackground } from '../state/stageBackground';
import { propOutline } from '../state/props';
import { IDENTITY_STAGE_VIEW, wheelZoomFactor, zoomViewAt } from '../state/stageView';
import type { StageZoomLayout } from '../state/stageView';
import { useT } from '../i18n';

const CURSOR_BROADCAST_MS = 80;

const MARGIN_PX = 44;
const CROSS_ARM_M = 0.26;
const WEDGE_RADIUS_M = 0.85;
const WEDGE_ANGLE_DEG = 56;
const HIT_RADIUS_M = 0.45;
/** Rehearsal notes draw in spike-tape amber. */
const ANNOTATION_COLOR = '#1a73e8';

/**
 * rotation 0 = facing the audience (downstage = screen bottom), degrees
 * clockwise on the plan view. Konva angle 0 points screen-right, so the
 * facing direction on screen is rotation + 90. With the audience drawn at
 * the top the whole plan is rotated 180°, so the angle shifts by 180 too.
 */
function facingToScreenDeg(rotation: number, flip: boolean): number {
  return rotation + (flip ? 270 : 90);
}

interface CanvasSize {
  width: number;
  height: number;
}

export function StageCanvas(): ReactElement {
  const t = useT();
  const readOnly = useReadOnly((s) => s.readOnly);
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const [size, setSize] = useState<CanvasSize>({ width: 0, height: 0 });
  const viewRef = useRef(IDENTITY_STAGE_VIEW);
  const [view, setView] = useState(viewRef.current);
  const geomRef = useRef<StageZoomLayout>({
    width: 0,
    height: 0,
    basePpm: 0,
    totalW: 1,
    totalH: 1,
    wingX: 0,
    wingY: 0,
  });
  const pinchRef = useRef<{ dist: number } | null>(null);

  const performance = useEditor((s) => s.performance);
  const allPerformers = useEditor((s) => s.performers);
  // Understudies stay in the cast but never on the stage.
  const performers = useMemo(() => allPerformers.filter(isPerformerActive), [allPerformers]);
  const props = useEditor((s) => s.props);
  const selectedPropId = useEditor((s) => s.selectedPropId);
  const selectProp = useEditor((s) => s.selectProp);
  const fixtures = useEditor((s) => s.fixtures);
  const captions = useEditor((s) => s.captions);
  const selectedFixtureId = useEditor((s) => s.selectedFixtureId);
  const selectedCaptionId = useEditor((s) => s.selectedCaptionId);
  const selectFixture = useEditor((s) => s.selectFixture);
  const selectCaption = useEditor((s) => s.selectCaption);
  const moveFixture = useEditor((s) => s.moveFixture);
  const moveCaption = useEditor((s) => s.moveCaption);
  const formations = useEditor((s) => s.formations);
  const positions = useEditor((s) => s.positions);
  const selectedFormationId = useEditor((s) => s.selectedFormationId);
  const selectedPerformerIds = useEditor((s) => s.selectedPerformerIds);
  const isPlaying = useEditor((s) => s.isPlaying);
  const playheadMs = useEditor((s) => s.playheadMs);
  const setPositionLive = useEditor((s) => s.setPositionLive);
  const setCurveControl = useEditor((s) => s.setCurveControl);
  const pushHistory = useEditor((s) => s.pushHistory);
  const selectPerformer = useEditor((s) => s.selectPerformer);
  const setPerformerSelection = useEditor((s) => s.setPerformerSelection);
  const clearPerformerSelection = useEditor((s) => s.clearPerformerSelection);
  const pathPerformerId = useEditor((s) => s.pathPerformerId);
  const annotations = useEditor((s) => s.annotations);
  const annotateMode = useEditor((s) => s.annotateMode);
  const addAnnotation = useEditor((s) => s.addAnnotation);
  const removeAnnotation = useEditor((s) => s.removeAnnotation);
  const peers = usePeers();
  const backgroundImage = useStageBackground((s) => s.image);
  const snapToGrid = useLayout((s) => s.snapToGrid);
  const lastCursorSentRef = useRef(0);

  // Marquee (rubber-band) selection: press on empty floor, drag, release.
  // A plain click (no movement past the threshold) still just deselects.
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(
    null,
  );
  const marqueeRef = useRef<{ x0: number; y0: number; moved: boolean } | null>(null);
  // Group drag: where every OTHER selected performer stood when the drag began.
  const groupDragRef = useRef<{
    startM: { x: number; y: number };
    origins: Map<string, { x: number; y: number }>;
  } | null>(null);
  // Pen stroke in progress (meters, flattened) — committed on pointer up.
  const penRef = useRef<number[] | null>(null);
  const [penPreview, setPenPreview] = useState<number[] | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (el === null) return;
    const observer = new ResizeObserver(() => {
      setSize({ width: el.clientWidth, height: el.clientHeight });
    });
    observer.observe(el);
    setSize({ width: el.clientWidth, height: el.clientHeight });
    return () => observer.disconnect();
  }, []);

  // Scroll zooms the plan (the stage itself does not scroll). A two-finger
  // pinch does the same on a touchscreen; trackpad pinch arrives as a wheel
  // event. The point under the cursor stays put.
  useEffect(() => {
    const el = containerRef.current;
    if (el === null) return;
    const zoomBy = (sx: number, sy: number, factor: number): void => {
      const next = zoomViewAt(viewRef.current, sx, sy, factor, geomRef.current);
      if (next === viewRef.current) return;
      viewRef.current = next;
      setView(next);
    };
    const localPoint = (clientX: number, clientY: number): { x: number; y: number } => {
      const rect = el.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    };
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const at = localPoint(e.clientX, e.clientY);
      zoomBy(at.x, at.y, wheelZoomFactor(e.deltaY, e.deltaMode));
    };
    const pinchDistance = (touches: TouchList): number => {
      const a = touches[0];
      const b = touches[1];
      if (a === undefined || b === undefined) return 0;
      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    };
    const onTouchStart = (e: TouchEvent): void => {
      if (e.touches.length < 2) return;
      pinchRef.current = { dist: pinchDistance(e.touches) };
      stageRef.current?.stopDrag();
      marqueeRef.current = null;
      setMarquee(null);
    };
    const onTouchMove = (e: TouchEvent): void => {
      if (e.touches.length < 2) return;
      e.preventDefault();
      const dist = pinchDistance(e.touches);
      const prev = pinchRef.current;
      const a = e.touches[0];
      const b = e.touches[1];
      if (prev === null || prev.dist <= 0 || dist <= 0 || a === undefined || b === undefined) {
        pinchRef.current = { dist };
        return;
      }
      const at = localPoint((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
      zoomBy(at.x, at.y, dist / prev.dist);
      pinchRef.current = { dist };
    };
    const onTouchEnd = (e: TouchEvent): void => {
      if (e.touches.length < 2) pinchRef.current = null;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onTouchStart, { capture: true });
    el.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart, { capture: true });
      el.removeEventListener('touchmove', onTouchMove, { capture: true });
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, []);

  const { stageWidth, stageHeight } = performance;
  // Audience at the top = the plan rotated 180° (performers' perspective).
  // Only the toPx/toMeters mappings flip; stored coordinates never change.
  const flip = performance.audienceAt === 'top';
  // Wings/backstage extend the drawable extent around the floor.
  const wings = performance.wings ?? { left: 0, right: 0, back: 0 };
  const totalW = stageWidth + wings.left + wings.right;
  const totalH = stageHeight + wings.back;
  const basePpm =
    size.width > 0
      ? Math.min((size.width - MARGIN_PX * 2) / totalW, (size.height - MARGIN_PX * 2) / totalH)
      : 0;
  // Wings swap screen edges when the plan is flipped. Zoom multiplies the
  // fitted scale; pan keeps the point under the cursor (or pinch) fixed.
  const wingX = flip ? wings.right : wings.left;
  const wingY = flip ? 0 : wings.back;
  geomRef.current = {
    width: size.width,
    height: size.height,
    basePpm,
    totalW,
    totalH,
    wingX,
    wingY,
  };
  const pxPerMeter = basePpm * view.zoom;
  const floorW = stageWidth * pxPerMeter;
  const floorH = stageHeight * pxPerMeter;
  const offsetX = view.panX + (size.width - totalW * pxPerMeter) / 2 + wingX * pxPerMeter;
  const offsetY = view.panY + (size.height - totalH * pxPerMeter) / 2 + wingY * pxPerMeter;
  const toPx = (xM: number, yM: number): { x: number; y: number } => ({
    x: offsetX + (flip ? stageWidth - xM : xM) * pxPerMeter,
    y: offsetY + (flip ? stageHeight - yM : yM) * pxPerMeter,
  });
  const toMeters = (xPx: number, yPx: number): { x: number; y: number } => {
    const x = (xPx - offsetX) / pxPerMeter;
    const y = (yPx - offsetY) / pxPerMeter;
    return flip ? { x: stageWidth - x, y: stageHeight - y } : { x, y };
  };

  // While playing (or scrubbing), poses come from the timeline; while editing,
  // straight from the selected formation.
  const livePoses: ReadonlyMap<string, StagePose> | null = isPlaying
    ? posesAtTime(formations, positions, playheadMs)
    : null;
  const editPositions = positions[selectedFormationId] ?? {};

  const ordered = byOrder(formations);
  const selectedIndex = ordered.findIndex((f) => f.id === selectedFormationId);
  const previous = selectedIndex > 0 ? ordered[selectedIndex - 1] : undefined;
  const previousPositions = previous !== undefined ? (positions[previous.id] ?? {}) : {};

  if (pxPerMeter <= 0 || !Number.isFinite(pxPerMeter)) {
    return (
      <div
        ref={containerRef}
        title={t.stage.zoomHint}
        style={{ position: 'absolute', inset: 0, touchAction: 'none' }}
      />
    );
  }

  // Clamp drags to the floor plus wings; with snap on, land on the 0.5m
  // lattice. Working in METERS keeps the bounds correct under flip (the
  // left wing renders on the right of the screen in performer view).
  const dragBound = (pos: { x: number; y: number }): { x: number; y: number } => {
    const m = toMeters(pos.x, pos.y);
    let x = Math.min(stageWidth + wings.right, Math.max(-wings.left, m.x));
    let y = Math.min(stageHeight, Math.max(-wings.back, m.y));
    if (snapToGrid) {
      x = Math.round(x / 0.5) * 0.5;
      y = Math.round(y / 0.5) * 0.5;
    }
    return toPx(x, y);
  };

  // Stage-level pointer handlers, shared by mouse and touch (touch-action is
  // disabled on the container so one-finger drags stay on the canvas).
  const onStagePointerDown = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>): void => {
    if ('touches' in e.evt && e.evt.touches.length > 1) return;
    if (annotateMode !== 'off' && !isPlaying && !readOnly) {
      const pointer = e.target.getStage()?.getPointerPosition();
      if (pointer == null) return;
      // Deleting an existing note is handled by the note's own handler.
      if (e.target.name() === 'annotation') return;
      const m = toMeters(pointer.x, pointer.y);
      if (annotateMode === 'pen') {
        penRef.current = [m.x, m.y];
        setPenPreview([m.x, m.y]);
      } else {
        const text = window.prompt(t.stage.pinPrompt, '');
        if (text !== null && text.trim() !== '') {
          addAnnotation({
            formationId: selectedFormationId,
            kind: 'pin',
            color: ANNOTATION_COLOR,
            x: m.x,
            y: m.y,
            text: text.trim(),
          });
        }
      }
      return;
    }
    if (e.target === e.target.getStage() || e.target.name() === 'floor') {
      // Clicking empty floor deselects the prop, re-enabling dancer editing
      // (dancers stop listening while a prop is selected, so it stays grabbable
      // even under a dancer).
      selectProp(null);
      const pointer = e.target.getStage()?.getPointerPosition();
      if (pointer != null && !isPlaying) {
        marqueeRef.current = { x0: pointer.x, y0: pointer.y, moved: false };
      } else {
        clearPerformerSelection();
      }
    }
  };

  const onStagePointerMove = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>): void => {
    const pointer = e.target.getStage()?.getPointerPosition();
    if (penRef.current !== null && pointer != null) {
      const m = toMeters(pointer.x, pointer.y);
      penRef.current.push(m.x, m.y);
      setPenPreview([...penRef.current]);
      return;
    }
    const drag = marqueeRef.current;
    if (drag !== null && pointer != null) {
      if (drag.moved || Math.abs(pointer.x - drag.x0) > 4 || Math.abs(pointer.y - drag.y0) > 4) {
        drag.moved = true;
        setMarquee({ x0: drag.x0, y0: drag.y0, x1: pointer.x, y1: pointer.y });
      }
    }
    if (!isCollabActive()) return;
    const now = Date.now();
    if (now - lastCursorSentRef.current < CURSOR_BROADCAST_MS) return;
    lastCursorSentRef.current = now;
    if (pointer == null) return;
    const m = toMeters(pointer.x, pointer.y);
    setAwarenessCursor(m.x >= 0 && m.x <= stageWidth && m.y >= 0 && m.y <= stageHeight ? m : null);
  };

  const onStagePointerUp = (): void => {
    if (penRef.current !== null) {
      const points = penRef.current;
      penRef.current = null;
      setPenPreview(null);
      if (points.length >= 4) {
        addAnnotation({
          formationId: selectedFormationId,
          kind: 'stroke',
          color: ANNOTATION_COLOR,
          points,
        });
      }
      return;
    }
    const drag = marqueeRef.current;
    marqueeRef.current = null;
    setMarquee(null);
    if (drag === null) return;
    if (!drag.moved) {
      clearPerformerSelection();
      return;
    }
    if (readOnly || marquee === null) return;
    // Corners land swapped when the plan is flipped — sort in meters.
    const c1 = toMeters(Math.min(marquee.x0, marquee.x1), Math.min(marquee.y0, marquee.y1));
    const c2 = toMeters(Math.max(marquee.x0, marquee.x1), Math.max(marquee.y0, marquee.y1));
    const a = { x: Math.min(c1.x, c2.x), y: Math.min(c1.y, c2.y) };
    const b = { x: Math.max(c1.x, c2.x), y: Math.max(c1.y, c2.y) };
    const inside = performers
      .filter((p) => {
        const pos = editPositions[p.id];
        return pos !== undefined && pos.x >= a.x && pos.x <= b.x && pos.y >= a.y && pos.y <= b.y;
      })
      .map((p) => p.id);
    setPerformerSelection(inside);
  };

  return (
    <div
      ref={containerRef}
      title={t.stage.zoomHint}
      style={{ position: 'absolute', inset: 0, touchAction: 'none' }}
    >
      <Stage
        ref={stageRef}
        width={size.width}
        height={size.height}
        onMouseDown={onStagePointerDown}
        onTouchStart={onStagePointerDown}
        onMouseMove={onStagePointerMove}
        onTouchMove={onStagePointerMove}
        onMouseUp={onStagePointerUp}
        onTouchEnd={onStagePointerUp}
        onMouseLeave={() => {
          marqueeRef.current = null;
          setMarquee(null);
          if (isCollabActive()) setAwarenessCursor(null);
        }}
      >
        <Layer listening={false}>
          {/* Wings/backstage: dim holding zones hugging the floor. */}
          {[
            { w: wings.left, x0: -wings.left, y0: -wings.back, x1: 0, y1: stageHeight },
            {
              w: wings.right,
              x0: stageWidth,
              y0: -wings.back,
              x1: stageWidth + wings.right,
              y1: stageHeight,
            },
            { w: wings.back, x0: 0, y0: -wings.back, x1: stageWidth, y1: 0 },
          ]
            .filter((zone) => zone.w > 0)
            .map((zone, i) => {
              const a = toPx(zone.x0, zone.y0);
              const b = toPx(zone.x1, zone.y1);
              return (
                <Rect
                  key={`wing${i}`}
                  x={Math.min(a.x, b.x)}
                  y={Math.min(a.y, b.y)}
                  width={Math.abs(b.x - a.x)}
                  height={Math.abs(b.y - a.y)}
                  fill="#f1f3f4"
                  stroke="#dadce0"
                  strokeWidth={1}
                  dash={[4, 4]}
                />
              );
            })}
          {/* Marley floor under a warm wash — the one lit surface. */}
          <Rect
            name="floor"
            x={offsetX}
            y={offsetY}
            width={floorW}
            height={floorH}
            fillRadialGradientStartPoint={{ x: floorW / 2, y: floorH * 0.35 }}
            fillRadialGradientEndPoint={{ x: floorW / 2, y: floorH * 0.35 }}
            fillRadialGradientStartRadius={0}
            fillRadialGradientEndRadius={Math.max(floorW, floorH) * 0.75}
            fillRadialGradientColorStops={[0, '#ffffff', 0.72, '#ffffff', 1, '#f8f9fa']}
            stroke="#dadce0"
            strokeWidth={1.5}
          />
          {/* Venue photo stretched onto the floor, under the grid; rotates
              with the plan when the audience is drawn at the top. */}
          {backgroundImage !== null && (
            <KonvaImage
              image={backgroundImage}
              x={offsetX + floorW / 2}
              y={offsetY + floorH / 2}
              offsetX={floorW / 2}
              offsetY={floorH / 2}
              width={floorW}
              height={floorH}
              rotation={flip ? 180 : 0}
              opacity={performance.stageBackgroundOpacity ?? 0.5}
            />
          )}
          {/* 1-meter grid */}
          {Array.from({ length: Math.floor(stageWidth) + 1 }, (_, i) => (
            <Line
              key={`v${i}`}
              points={[
                offsetX + i * pxPerMeter,
                offsetY,
                offsetX + i * pxPerMeter,
                offsetY + floorH,
              ]}
              stroke="#dadce0"
              opacity={1}
              strokeWidth={1}
            />
          ))}
          {Array.from({ length: Math.floor(stageHeight) + 1 }, (_, i) => (
            <Line
              key={`h${i}`}
              points={[
                offsetX,
                offsetY + i * pxPerMeter,
                offsetX + floorW,
                offsetY + i * pxPerMeter,
              ]}
              stroke="#dadce0"
              opacity={1}
              strokeWidth={1}
            />
          ))}
          {/* Center line — the center spike every stage has. */}
          <Line
            points={[offsetX + floorW / 2, offsetY, offsetX + floorW / 2, offsetY + floorH]}
            stroke="#1a73e8"
            opacity={0.45}
            strokeWidth={1}
            dash={[6, 8]}
          />
          <Text
            x={offsetX}
            y={flip ? offsetY - 21 : offsetY + floorH + 10}
            width={floorW}
            align="center"
            text={t.stage.audience}
            fontFamily="'Roboto Mono', monospace"
            fontSize={11}
            letterSpacing={4}
            fill="#5f6368"
          />
        </Layer>

        {/* Fixed set pieces and text. They do not move between formations. */}
        <Layer listening={annotateMode === 'off'}>
          {fixtures.map((piece) => {
            const px = toPx(piece.x, piece.y);
            const wPx = piece.width * pxPerMeter;
            const hPx = piece.height * pxPerMeter;
            const selected = selectedFixtureId === piece.id;
            return (
              <Group
                key={piece.id}
                x={px.x}
                y={px.y}
                draggable={!isPlaying && !readOnly}
                dragBoundFunc={dragBound}
                onDragStart={() => {
                  pushHistory();
                  selectFixture(piece.id);
                }}
                onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
                  const m = toMeters(e.target.x(), e.target.y());
                  moveFixture(piece.id, m.x, m.y);
                }}
                onMouseDown={(e) => {
                  e.cancelBubble = true;
                  selectFixture(piece.id);
                }}
                onTouchStart={(e) => {
                  e.cancelBubble = true;
                  selectFixture(piece.id);
                }}
              >
                <Rect
                  x={-wPx / 2}
                  y={-hPx / 2}
                  width={wPx}
                  height={hPx}
                  fill={piece.color}
                  opacity={0.35}
                  stroke={piece.color}
                  strokeWidth={2}
                />
                {selected && (
                  <Rect
                    x={-wPx / 2 - 4}
                    y={-hPx / 2 - 4}
                    width={wPx + 8}
                    height={hPx + 8}
                    stroke="#1a73e8"
                    strokeWidth={1.5}
                    dash={[4, 4]}
                    listening={false}
                  />
                )}
                <Text
                  x={-wPx / 2}
                  y={-7}
                  width={wPx}
                  align="center"
                  text={piece.label}
                  fontFamily="'Roboto Mono', monospace"
                  fontSize={12}
                  fill="#202124"
                  listening={false}
                />
              </Group>
            );
          })}
          {captions.map((piece) => {
            const px = toPx(piece.x, piece.y);
            const box = Math.max(48, piece.text.length * 8);
            const selected = selectedCaptionId === piece.id;
            return (
              <Group
                key={piece.id}
                x={px.x}
                y={px.y}
                draggable={!isPlaying && !readOnly}
                dragBoundFunc={dragBound}
                onDragStart={() => {
                  pushHistory();
                  selectCaption(piece.id);
                }}
                onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
                  const m = toMeters(e.target.x(), e.target.y());
                  moveCaption(piece.id, m.x, m.y);
                }}
                onMouseDown={(e) => {
                  e.cancelBubble = true;
                  selectCaption(piece.id);
                }}
                onTouchStart={(e) => {
                  e.cancelBubble = true;
                  selectCaption(piece.id);
                }}
              >
                <Rect
                  x={-box / 2}
                  y={-12}
                  width={box}
                  height={24}
                  fill="#ffffff"
                  opacity={0.94}
                  cornerRadius={3}
                  stroke={selected ? '#1a73e8' : piece.color}
                  strokeWidth={selected ? 1.5 : 1}
                />
                <Text
                  x={-box / 2}
                  y={-7}
                  width={box}
                  align="center"
                  text={piece.text}
                  fontFamily="'Roboto Mono', monospace"
                  fontSize={13}
                  fill={piece.color}
                  listening={false}
                />
              </Group>
            );
          })}
        </Layer>

        {/* Props: scenery footprints under the dancers. The outer group
            carries position + drag; only the inner group rotates, so the
            name label stays readable. */}
        <Layer listening={annotateMode === 'off'}>
          {props.map((prop) => {
            const pose: StagePose = livePoses?.get(prop.id) ?? {
              x: editPositions[prop.id]?.x ?? NaN,
              y: editPositions[prop.id]?.y ?? NaN,
              rotation: editPositions[prop.id]?.rotation ?? 0,
            };
            if (!Number.isFinite(pose.x) || !Number.isFinite(pose.y)) return null;
            const px = toPx(pose.x, pose.y);
            const selected = selectedPropId === prop.id;
            const wPx = prop.width * pxPerMeter;
            const hPx = prop.height * pxPerMeter;
            return (
              <Group
                key={prop.id}
                x={px.x}
                y={px.y}
                draggable={!isPlaying && !readOnly}
                dragBoundFunc={dragBound}
                onDragStart={() => {
                  pushHistory();
                  selectProp(prop.id);
                }}
                onDragMove={(e: Konva.KonvaEventObject<DragEvent>) => {
                  if (!isCollabActive()) return;
                  const now = Date.now();
                  if (now - lastCursorSentRef.current < CURSOR_BROADCAST_MS) return;
                  lastCursorSentRef.current = now;
                  const m = toMeters(e.target.x(), e.target.y());
                  setPositionLive(selectedFormationId, prop.id, m.x, m.y);
                }}
                onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
                  const m = toMeters(e.target.x(), e.target.y());
                  setPositionLive(selectedFormationId, prop.id, m.x, m.y);
                }}
                onMouseDown={(e) => {
                  e.cancelBubble = true;
                  selectProp(prop.id);
                }}
                onTouchStart={(e) => {
                  e.cancelBubble = true;
                  selectProp(prop.id);
                }}
              >
                <Group rotation={pose.rotation + (flip ? 180 : 0)}>
                  {prop.kind === 'circle' ? (
                    <Ellipse
                      radiusX={wPx / 2}
                      radiusY={hPx / 2}
                      fill={prop.color}
                      opacity={0.25}
                      stroke={prop.color}
                      strokeWidth={2}
                    />
                  ) : (
                    <Line
                      points={propOutline(prop.kind, prop.width, prop.height).flatMap(
                        ([xM, yM]) => [xM * pxPerMeter, yM * pxPerMeter],
                      )}
                      closed
                      fill={prop.color}
                      opacity={0.25}
                      stroke={prop.color}
                      strokeWidth={2}
                    />
                  )}
                </Group>
                {selected && (
                  <Rect
                    x={-wPx / 2 - 4}
                    y={-hPx / 2 - 4}
                    width={wPx + 8}
                    height={hPx + 8}
                    stroke="#1a73e8"
                    strokeWidth={1.5}
                    dash={[4, 4]}
                    listening={false}
                  />
                )}
                <Text
                  x={-wPx / 2}
                  y={-6}
                  width={wPx}
                  align="center"
                  text={prop.name}
                  fontFamily="'Roboto Mono', monospace"
                  fontSize={11}
                  fill={prop.color}
                  listening={false}
                />
              </Group>
            );
          })}
        </Layer>

        {/* Ghosts: where everyone stood in the previous formation. Linear
            transitions get crossing warnings; curve transitions draw the
            Bézier and (for selected performers) a draggable control handle. */}
        {!isPlaying &&
          previous !== undefined &&
          (() => {
            const isCurve = previous.transitionType === 'curve';
            const walkers = performers.filter(
              (p) => previousPositions[p.id] !== undefined && editPositions[p.id] !== undefined,
            );
            const paths = walkers.map((p) => {
              const from = previousPositions[p.id];
              const to = editPositions[p.id];
              const control = isCurve ? from?.curveControlPoints?.[0] : undefined;
              return {
                from: { x: from?.x ?? 0, y: from?.y ?? 0 },
                to: { x: to?.x ?? 0, y: to?.y ?? 0 },
                // No control point = the curve renders as its straight chord.
                ...(control !== undefined ? { control: { x: control.x, y: control.y } } : {}),
              };
            });
            const crossing = new Set(findCrossings(paths).flat());
            return (
              <>
                <Layer listening={false}>
                  {performers.map((p) => {
                    const prev = previousPositions[p.id];
                    if (prev === undefined) return null;
                    const prevPx = toPx(prev.x, prev.y);
                    const walkerIndex = walkers.findIndex((w) => w.id === p.id);
                    const curr = editPositions[p.id];
                    const currPx = curr !== undefined ? toPx(curr.x, curr.y) : null;
                    const collides = walkerIndex !== -1 && crossing.has(walkerIndex);
                    const control = prev.curveControlPoints?.[0];
                    const controlPx =
                      isCurve && currPx !== null
                        ? control !== undefined
                          ? toPx(control.x, control.y)
                          : { x: (prevPx.x + currPx.x) / 2, y: (prevPx.y + currPx.y) / 2 }
                        : null;
                    return (
                      <Group key={p.id} opacity={collides ? 0.9 : 0.35}>
                        {currPx !== null &&
                          (isCurve && controlPx !== null ? (
                            <Shape
                              stroke={collides ? '#d95f5f' : p.color}
                              strokeWidth={collides ? 2 : 1}
                              dash={collides ? undefined : [3, 5]}
                              opacity={0.8}
                              sceneFunc={(ctx, shape) => {
                                ctx.beginPath();
                                ctx.moveTo(prevPx.x, prevPx.y);
                                ctx.quadraticCurveTo(controlPx.x, controlPx.y, currPx.x, currPx.y);
                                ctx.fillStrokeShape(shape);
                              }}
                            />
                          ) : (
                            <Line
                              points={[prevPx.x, prevPx.y, currPx.x, currPx.y]}
                              stroke={collides ? '#d95f5f' : p.color}
                              strokeWidth={collides ? 2 : 1}
                              dash={collides ? undefined : [3, 5]}
                              opacity={0.8}
                            />
                          ))}
                        <Circle
                          x={prevPx.x}
                          y={prevPx.y}
                          radius={4}
                          stroke={collides ? '#d95f5f' : p.color}
                          strokeWidth={1.5}
                        />
                      </Group>
                    );
                  })}
                </Layer>
                {/* Curve control handles: draggable, for selected performers. */}
                {isCurve && !readOnly && (
                  <Layer>
                    {performers
                      .filter((p) => selectedPerformerIds.includes(p.id))
                      .map((p) => {
                        const prev = previousPositions[p.id];
                        const curr = editPositions[p.id];
                        if (prev === undefined || curr === undefined) return null;
                        const prevPx = toPx(prev.x, prev.y);
                        const currPx = toPx(curr.x, curr.y);
                        const control = prev.curveControlPoints?.[0];
                        const handlePx =
                          control !== undefined
                            ? toPx(control.x, control.y)
                            : { x: (prevPx.x + currPx.x) / 2, y: (prevPx.y + currPx.y) / 2 };
                        return (
                          <Circle
                            key={`handle-${p.id}`}
                            x={handlePx.x}
                            y={handlePx.y}
                            radius={6}
                            fill="#1a73e8"
                            stroke="#ffffff"
                            strokeWidth={1.5}
                            draggable
                            onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
                              const m = toMeters(e.target.x(), e.target.y());
                              setCurveControl(previous.id, p.id, m.x, m.y);
                            }}
                          />
                        );
                      })}
                  </Layer>
                )}
              </>
            );
          })()}

        <Layer
          listening={
            annotateMode === 'off' &&
            selectedPropId === null &&
            selectedFixtureId === null &&
            selectedCaptionId === null
          }
        >
          {performers.map((p) => {
            const pose: StagePose | undefined = livePoses?.get(p.id) ?? {
              x: editPositions[p.id]?.x ?? NaN,
              y: editPositions[p.id]?.y ?? NaN,
              rotation: editPositions[p.id]?.rotation ?? 0,
            };
            if (!Number.isFinite(pose.x) || !Number.isFinite(pose.y)) return null;
            const px = toPx(pose.x, pose.y);
            const selected = selectedPerformerIds.includes(p.id);
            const arm = CROSS_ARM_M * pxPerMeter;
            return (
              <Group
                key={p.id}
                x={px.x}
                y={px.y}
                draggable={!isPlaying && !readOnly}
                dragBoundFunc={dragBound}
                onDragStart={(e: Konva.KonvaEventObject<DragEvent>) => {
                  // One undo step per drag; frames below skip history.
                  pushHistory();
                  // Dragging a member of a multi-selection moves the group.
                  if (selectedPerformerIds.includes(p.id) && selectedPerformerIds.length > 1) {
                    const origins = new Map<string, { x: number; y: number }>();
                    for (const id of selectedPerformerIds) {
                      if (id === p.id) continue;
                      const pos = editPositions[id];
                      if (pos !== undefined) origins.set(id, { x: pos.x, y: pos.y });
                    }
                    groupDragRef.current = {
                      startM: toMeters(e.target.x(), e.target.y()),
                      origins,
                    };
                  } else {
                    groupDragRef.current = null;
                  }
                }}
                onDragMove={(e: Konva.KonvaEventObject<DragEvent>) => {
                  const m = toMeters(e.target.x(), e.target.y());
                  const group = groupDragRef.current;
                  if (group !== null) {
                    const dx = m.x - group.startM.x;
                    const dy = m.y - group.startM.y;
                    setPositionLive(selectedFormationId, p.id, m.x, m.y);
                    for (const [id, origin] of group.origins) {
                      setPositionLive(selectedFormationId, id, origin.x + dx, origin.y + dy);
                    }
                    return;
                  }
                  // Solo drag: live-sync only for collaborators (local render
                  // follows the Konva node, no store churn needed).
                  if (!isCollabActive()) return;
                  const now = Date.now();
                  if (now - lastCursorSentRef.current < CURSOR_BROADCAST_MS) return;
                  lastCursorSentRef.current = now;
                  setPositionLive(selectedFormationId, p.id, m.x, m.y);
                }}
                onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
                  const m = toMeters(e.target.x(), e.target.y());
                  const group = groupDragRef.current;
                  if (group !== null) {
                    const dx = m.x - group.startM.x;
                    const dy = m.y - group.startM.y;
                    for (const [id, origin] of group.origins) {
                      setPositionLive(selectedFormationId, id, origin.x + dx, origin.y + dy);
                    }
                    groupDragRef.current = null;
                  }
                  setPositionLive(selectedFormationId, p.id, m.x, m.y);
                }}
                onMouseDown={(e) => {
                  e.cancelBubble = true;
                  // Clicking an already-selected mark keeps the selection, so
                  // grabbing one member drags the whole group.
                  if (e.evt.shiftKey) selectPerformer(p.id, true);
                  else if (!selectedPerformerIds.includes(p.id)) selectPerformer(p.id, false);
                }}
                onTouchStart={(e) => {
                  e.cancelBubble = true;
                  if (!selectedPerformerIds.includes(p.id)) selectPerformer(p.id, false);
                }}
              >
                {/* Facing wedge — a light cone showing orientation. */}
                <Wedge
                  radius={WEDGE_RADIUS_M * pxPerMeter}
                  angle={WEDGE_ANGLE_DEG}
                  rotation={facingToScreenDeg(pose.rotation, flip) - WEDGE_ANGLE_DEG / 2}
                  fill={p.color}
                  opacity={0.22}
                />
                {/* State marker: a shape ring flagging kneel/jump/prop-style
                    states in THIS formation. Hidden while playing (a state is
                    per-formation; mid-transition it is ambiguous). */}
                {!isPlaying && editPositions[p.id]?.marker === 'square' && (
                  <Rect
                    x={-0.42 * pxPerMeter}
                    y={-0.42 * pxPerMeter}
                    width={0.84 * pxPerMeter}
                    height={0.84 * pxPerMeter}
                    stroke={p.color}
                    strokeWidth={2}
                    listening={false}
                  />
                )}
                {!isPlaying && editPositions[p.id]?.marker === 'triangle' && (
                  <RegularPolygon
                    sides={3}
                    radius={0.52 * pxPerMeter}
                    stroke={p.color}
                    strokeWidth={2}
                    listening={false}
                  />
                )}
                {!isPlaying && editPositions[p.id]?.marker === 'diamond' && (
                  <RegularPolygon
                    sides={4}
                    radius={0.55 * pxPerMeter}
                    stroke={p.color}
                    strokeWidth={2}
                    listening={false}
                  />
                )}
                {selected && (
                  <Circle
                    radius={HIT_RADIUS_M * pxPerMeter}
                    stroke="#1a73e8"
                    strokeWidth={1.5}
                    dash={[4, 4]}
                  />
                )}
                {peers
                  .filter((peer) => peer.selectedPerformerIds.includes(p.id))
                  .map((peer) => (
                    <Circle
                      key={peer.clientId}
                      radius={(HIT_RADIUS_M + 0.12) * pxPerMeter}
                      stroke={peer.color}
                      strokeWidth={1.5}
                      dash={[2, 4]}
                      listening={false}
                    />
                  ))}
                {/* Mark: a circled badge when one is set, else spike-tape cross. */}
                {(p.badge ?? '') !== '' ? (
                  <>
                    <Circle
                      radius={0.32 * pxPerMeter}
                      fill="#ffffff"
                      stroke={p.color}
                      strokeWidth={2.5}
                    />
                    <Text
                      x={-0.32 * pxPerMeter}
                      y={-0.32 * pxPerMeter}
                      width={0.64 * pxPerMeter}
                      height={0.64 * pxPerMeter}
                      align="center"
                      verticalAlign="middle"
                      text={p.badge ?? ''}
                      fontStyle="bold"
                      fontFamily="'Roboto Variable', sans-serif"
                      fontSize={
                        (p.badge ?? '').length <= 1
                          ? 0.36 * pxPerMeter
                          : (p.badge ?? '').length <= 2
                            ? 0.27 * pxPerMeter
                            : 0.17 * pxPerMeter
                      }
                      fill={p.color}
                      listening={false}
                    />
                  </>
                ) : (
                  <>
                    <Line
                      points={[-arm, -arm, arm, arm]}
                      stroke={p.color}
                      strokeWidth={3}
                      lineCap="round"
                    />
                    <Line
                      points={[-arm, arm, arm, -arm]}
                      stroke={p.color}
                      strokeWidth={3}
                      lineCap="round"
                    />
                  </>
                )}
                {/* Invisible hit area so small crosses stay grabbable. */}
                <Circle radius={HIT_RADIUS_M * pxPerMeter} fill="transparent" />
                <Text
                  x={-60}
                  y={arm + 6}
                  width={120}
                  align="center"
                  text={p.name}
                  fontFamily="'Roboto Variable', sans-serif"
                  fontSize={11}
                  fill="#202124"
                  stroke="#ffffff"
                  strokeWidth={3}
                  fillAfterStrokeEnabled
                  listening={false}
                />
              </Group>
            );
          })}
        </Layer>

        {/* Rehearsal notes on the selected formation: pen strokes and text
            pins, stored in stage meters. In pen/pin mode a note is a click
            target for deletion. */}
        {!isPlaying && (
          <Layer listening={annotateMode !== 'off'}>
            {annotations
              .filter((a) => a.formationId === selectedFormationId)
              .map((a) => {
                const remove = (): void => {
                  if (annotateMode !== 'off') removeAnnotation(a.id);
                };
                if (a.kind === 'stroke') {
                  const flat: number[] = [];
                  const pts = a.points ?? [];
                  for (let i = 0; i + 1 < pts.length; i += 2) {
                    const px = toPx(pts[i] ?? 0, pts[i + 1] ?? 0);
                    flat.push(px.x, px.y);
                  }
                  return (
                    <Line
                      key={a.id}
                      name="annotation"
                      points={flat}
                      stroke={a.color}
                      strokeWidth={2.5}
                      lineCap="round"
                      lineJoin="round"
                      tension={0.3}
                      opacity={0.9}
                      hitStrokeWidth={14}
                      onClick={remove}
                      onTap={remove}
                    />
                  );
                }
                const at = toPx(a.x ?? 0, a.y ?? 0);
                return (
                  <Group
                    key={a.id}
                    name="annotation"
                    x={at.x}
                    y={at.y}
                    onClick={remove}
                    onTap={remove}
                  >
                    <Circle name="annotation" radius={4} fill={a.color} />
                    <Text
                      name="annotation"
                      x={8}
                      y={-7}
                      text={a.text ?? ''}
                      fontFamily="'Roboto Mono', monospace"
                      fontSize={12}
                      fill={a.color}
                    />
                  </Group>
                );
              })}
            {penPreview !== null &&
              (() => {
                const flat: number[] = [];
                for (let i = 0; i + 1 < penPreview.length; i += 2) {
                  const px = toPx(penPreview[i] ?? 0, penPreview[i + 1] ?? 0);
                  flat.push(px.x, px.y);
                }
                return (
                  <Line
                    points={flat}
                    stroke={ANNOTATION_COLOR}
                    strokeWidth={2.5}
                    lineCap="round"
                    dash={[6, 4]}
                    listening={false}
                  />
                );
              })()}
          </Layer>
        )}

        {/* Whole-show walk path for one performer: numbered stops, dashed legs. */}
        {!isPlaying &&
          pathPerformerId !== null &&
          (() => {
            const walker = performers.find((p) => p.id === pathPerformerId);
            if (walker === undefined) return null;
            const stops: {
              formationId: string;
              pos: NonNullable<(typeof editPositions)[string]>;
            }[] = [];
            for (const f of ordered) {
              const pos = positions[f.id]?.[walker.id];
              if (pos !== undefined) stops.push({ formationId: f.id, pos });
            }
            if (stops.length === 0) return null;
            return (
              <Layer listening={false}>
                {stops.slice(0, -1).map((stop, i) => {
                  const next = stops[i + 1];
                  if (next === undefined) return null;
                  const fromPx = toPx(stop.pos.x, stop.pos.y);
                  const nextPx = toPx(next.pos.x, next.pos.y);
                  const formation = ordered.find((f) => f.id === stop.formationId);
                  const control =
                    formation?.transitionType === 'curve'
                      ? stop.pos.curveControlPoints?.[0]
                      : undefined;
                  const controlPx = control !== undefined ? toPx(control.x, control.y) : null;
                  return controlPx !== null ? (
                    <Shape
                      key={`leg-${stop.formationId}`}
                      stroke={walker.color}
                      strokeWidth={2}
                      dash={[7, 5]}
                      opacity={0.9}
                      sceneFunc={(ctx, shape) => {
                        ctx.beginPath();
                        ctx.moveTo(fromPx.x, fromPx.y);
                        ctx.quadraticCurveTo(controlPx.x, controlPx.y, nextPx.x, nextPx.y);
                        ctx.fillStrokeShape(shape);
                      }}
                    />
                  ) : (
                    <Line
                      key={`leg-${stop.formationId}`}
                      points={[fromPx.x, fromPx.y, nextPx.x, nextPx.y]}
                      stroke={walker.color}
                      strokeWidth={2}
                      dash={[7, 5]}
                      opacity={0.9}
                    />
                  );
                })}
                {stops.map((stop, i) => {
                  const px = toPx(stop.pos.x, stop.pos.y);
                  return (
                    <Group key={`stop-${stop.formationId}`} x={px.x} y={px.y}>
                      <Circle radius={9} fill="#ffffff" stroke={walker.color} strokeWidth={1.5} />
                      <Text
                        x={-9}
                        y={-9}
                        width={18}
                        height={18}
                        align="center"
                        verticalAlign="middle"
                        text={String(i + 1)}
                        fontFamily="'Roboto Mono', monospace"
                        fontSize={10}
                        fill="#202124"
                      />
                    </Group>
                  );
                })}
              </Layer>
            );
          })()}

        {/* Marquee selection rectangle */}
        {marquee !== null && (
          <Layer listening={false}>
            <Rect
              x={Math.min(marquee.x0, marquee.x1)}
              y={Math.min(marquee.y0, marquee.y1)}
              width={Math.abs(marquee.x1 - marquee.x0)}
              height={Math.abs(marquee.y1 - marquee.y0)}
              fill="rgba(26, 115, 232, 0.12)"
              stroke="#1a73e8"
              strokeWidth={1}
              dash={[4, 4]}
            />
          </Layer>
        )}

        {/* Remote collaborators' cursors */}
        {peers.length > 0 && (
          <Layer listening={false}>
            {peers.map((peer) => {
              if (peer.cursor === null) return null;
              const px = toPx(peer.cursor.x, peer.cursor.y);
              return (
                <Group key={peer.clientId} x={px.x} y={px.y}>
                  <Circle radius={4} fill={peer.color} stroke="#ffffff" strokeWidth={1} />
                  <Text
                    x={7}
                    y={-5}
                    text={peer.name}
                    fontFamily="'Roboto Variable', sans-serif"
                    fontSize={10}
                    fill={peer.color}
                  />
                </Group>
              );
            })}
          </Layer>
        )}
      </Stage>
    </div>
  );
}
