import type { ReactElement } from 'react';
import { Circle, Ellipse, Group, Line, Rect, Text } from 'react-konva';
import type Konva from 'konva';
import type { ShapeEdge } from '../state/shapeEdit';

export type HandleKind = ShapeEdge | 'rotate';

const HANDLE = 10;
const KNOB = 22;

/**
 * Edge squares and a rotation knob, drawn in the piece's local pixel space
 * so they turn with the footprint.
 */
export function ShapeHandles({
  widthPx,
  heightPx,
  onDown,
}: {
  widthPx: number;
  heightPx: number;
  onDown: (which: HandleKind, e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
}): ReactElement {
  const halfW = widthPx / 2;
  const halfH = heightPx / 2;
  const edges: { id: ShapeEdge; x: number; y: number }[] = [
    { id: 'n', x: 0, y: -halfH },
    { id: 'e', x: halfW, y: 0 },
    { id: 's', x: 0, y: halfH },
    { id: 'w', x: -halfW, y: 0 },
  ];
  const stop = (which: HandleKind, e: Konva.KonvaEventObject<MouseEvent | TouchEvent>): void => {
    e.cancelBubble = true;
    e.evt.preventDefault();
    e.target.getParent()?.stopDrag();
    onDown(which, e);
  };
  return (
    <>
      <Line
        points={[0, -halfH, 0, -halfH - KNOB]}
        stroke="#1a73e8"
        strokeWidth={1.5}
        listening={false}
      />
      {edges.map((edge) => (
        <Rect
          key={edge.id}
          x={edge.x - HANDLE / 2}
          y={edge.y - HANDLE / 2}
          width={HANDLE}
          height={HANDLE}
          fill="#ffffff"
          stroke="#1a73e8"
          strokeWidth={1.5}
          onMouseDown={(e) => stop(edge.id, e)}
          onTouchStart={(e) => stop(edge.id, e)}
        />
      ))}
      <Circle
        x={0}
        y={-halfH - KNOB}
        radius={6}
        fill="#ffffff"
        stroke="#1a73e8"
        strokeWidth={1.5}
        onMouseDown={(e) => stop('rotate', e)}
        onTouchStart={(e) => stop('rotate', e)}
      />
    </>
  );
}

/**
 * One footprint on the plan: the shape, its label, and (when selected) the
 * edge and rotation handles. The group origin is the center, in screen pixels.
 */
export function EditableShape({
  x,
  y,
  rotation,
  widthPx,
  heightPx,
  kind,
  points,
  fill,
  stroke,
  opacity,
  label,
  labelFill,
  labelRotation = 0,
  fontSize,
  corner,
  selected,
  draggable,
  dragBound,
  onDragStart,
  onDragMove,
  onDragEnd,
  onSelect,
  showHandles,
  onHandleDown,
}: {
  x: number;
  y: number;
  rotation: number;
  widthPx: number;
  heightPx: number;
  kind: 'rect' | 'ellipse' | 'polygon';
  points?: number[];
  fill: string;
  stroke: string;
  opacity: number;
  label: string;
  labelFill: string;
  /** Extra turn so the words stay readable when the plan is flipped. */
  labelRotation?: number;
  fontSize: number;
  corner?: boolean;
  selected: boolean;
  draggable: boolean;
  dragBound: (pos: { x: number; y: number }) => { x: number; y: number };
  onDragStart: () => void;
  onDragMove?: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onSelect: () => void;
  showHandles: boolean;
  onHandleDown: (which: HandleKind, e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
}): ReactElement {
  const outline = selected ? '#1a73e8' : stroke;
  return (
    <Group
      x={x}
      y={y}
      rotation={rotation}
      draggable={draggable}
      dragBoundFunc={dragBound}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onMouseDown={(e) => {
        e.cancelBubble = true;
        onSelect();
      }}
      onTouchStart={(e) => {
        e.cancelBubble = true;
        onSelect();
      }}
    >
      {kind === 'ellipse' ? (
        <Ellipse
          radiusX={widthPx / 2}
          radiusY={heightPx / 2}
          fill={fill}
          opacity={opacity}
          stroke={outline}
          strokeWidth={selected ? 2 : 1.5}
        />
      ) : kind === 'polygon' ? (
        <Line
          points={points ?? []}
          closed
          fill={fill}
          opacity={opacity}
          stroke={outline}
          strokeWidth={2}
        />
      ) : (
        <Rect
          x={-widthPx / 2}
          y={-heightPx / 2}
          width={widthPx}
          height={heightPx}
          cornerRadius={corner === true ? 3 : 0}
          fill={fill}
          opacity={opacity}
          stroke={outline}
          strokeWidth={selected ? 2 : 1.5}
        />
      )}
      <Group rotation={labelRotation} listening={false}>
        <Text
          x={-widthPx / 2}
          y={-fontSize / 2}
          width={widthPx}
          align="center"
          text={label}
          fontFamily="'Roboto Mono', monospace"
          fontSize={fontSize}
          fill={labelFill}
          listening={false}
        />
      </Group>
      {showHandles && <ShapeHandles widthPx={widthPx} heightPx={heightPx} onDown={onHandleDown} />}
    </Group>
  );
}
