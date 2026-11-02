import * as THREE from 'three';
import type {
  Formation,
  Performer,
  Performance,
  StageCaption,
  StageFixture,
  StageProp,
} from '@gridstage/shared-types';
import { posesAtTime } from '../state/interpolate';
import type { PositionMap } from '../state/store';

export interface FrameRenderer {
  renderFrame: (tMs: number) => void;
  dispose: () => void;
}

export interface SceneDoc {
  performance: Performance;
  performers: readonly Performer[];
  /** Stage props; drawn by the 2D renderer only (3D skips them for now). */
  props?: readonly StageProp[];
  /** Fixed furniture. Drawn as boxes in 3D. */
  fixtures?: readonly StageFixture[];
  /** Fixed text marks. Drawn on the 2D plan. */
  captions?: readonly StageCaption[];
  formations: readonly Formation[];
  positions: PositionMap;
}

/**
 * A framework-free rebuild of the Stage3D scene that the video exporter can
 * drive frame by frame (react-three-fiber can't be pumped headlessly during
 * capture). Kept in its own module so `import('three')` only loads when a 3D
 * export actually runs — the 2D export stays light. Mirrors Stage3D's mapping:
 * stage x→x, downstage y→+z, height→y; the audience-preset camera framing.
 */
export function buildStage3dRenderer(canvas: HTMLCanvasElement, doc: SceneDoc): FrameRenderer {
  const { performance, performers, formations, positions } = doc;
  const w = performance.stageWidth;
  const h = performance.stageHeight;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(canvas.width, canvas.height, false);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#f8f9fa');

  const camera = new THREE.PerspectiveCamera(50, canvas.width / canvas.height, 0.1, 1000);
  // audienceAt 'top' = performer view: same framing from the upstage side.
  // The audience edge strip stays on the physical audience edge and shows up
  // at the far side of the frame, matching the 2D plan's orientation.
  const cameraSide = performance.audienceAt === 'top' ? -1 : 1;
  camera.position.set(0, h * 0.6 + 2, cameraSide * (h * 1.1 + 4)); // audience preset
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(2, 10, 8);
  scene.add(key);

  // Everything relative to stage center, matching Stage3D's group offset.
  const group = new THREE.Group();
  group.position.set(-w / 2, 0, -h / 2);
  scene.add(group);

  const disposables: { dispose: () => void }[] = [];
  const mesh = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    pos: [number, number, number],
  ): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(pos[0], pos[1], pos[2]);
    group.add(m);
    disposables.push(geo, mat);
    return m;
  };

  mesh(new THREE.BoxGeometry(w, 0.1, h), new THREE.MeshStandardMaterial({ color: '#ffffff' }), [
    w / 2,
    -0.05,
    h / 2,
  ]);
  mesh(
    new THREE.BoxGeometry(w, 0.02, 0.08),
    new THREE.MeshStandardMaterial({
      color: '#1a73e8',
      emissive: new THREE.Color('#1a73e8'),
      emissiveIntensity: 0.4,
    }),
    [w / 2, 0.02, h + 0.15],
  );
  mesh(
    new THREE.BoxGeometry(0.02, 0.02, h),
    new THREE.MeshStandardMaterial({ color: '#1a73e8', transparent: true, opacity: 0.35 }),
    [w / 2, 0.02, h / 2],
  );

  for (const piece of doc.fixtures ?? []) {
    const ellipse = piece.shape === 'ellipse';
    const body = mesh(
      ellipse
        ? new THREE.CylinderGeometry(1, 1, 0.8, 32)
        : new THREE.BoxGeometry(piece.width, 0.8, piece.height),
      new THREE.MeshStandardMaterial({ color: piece.color }),
      [piece.x, 0.4, piece.y],
    );
    body.rotation.y = -(((piece.rotation ?? 0) * Math.PI) / 180);
    if (ellipse) body.scale.set(piece.width / 2, 1, piece.height / 2);
  }

  const performerNodes = new Map<string, { node: THREE.Group; bar: THREE.Mesh }>();
  for (const p of performers) {
    const node = new THREE.Group();
    const bodyGeo = new THREE.CylinderGeometry(0.22, 0.28, 1.7, 12);
    const bodyMat = new THREE.MeshStandardMaterial({ color: p.color });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.set(0, 0.85, 0);
    const barGeo = new THREE.BoxGeometry(0.08, 0.08, 0.36);
    const barMat = new THREE.MeshStandardMaterial({ color: '#5f6368' });
    const bar = new THREE.Mesh(barGeo, barMat);
    node.add(body);
    node.add(bar);
    group.add(node);
    disposables.push(bodyGeo, bodyMat, barGeo, barMat);
    performerNodes.set(p.id, { node, bar });
  }

  const renderFrame = (tMs: number): void => {
    const poses = posesAtTime(formations, positions, tMs);
    for (const p of performers) {
      const entry = performerNodes.get(p.id);
      if (entry === undefined) continue;
      const pose = poses.get(p.id);
      if (pose === undefined) {
        entry.node.visible = false;
        continue;
      }
      entry.node.visible = true;
      entry.node.position.set(pose.x, 0, pose.y);
      const facingRad = ((pose.rotation + 90) * Math.PI) / 180;
      entry.bar.position.set(Math.cos(facingRad) * 0.35, 1.35, Math.sin(facingRad) * 0.35);
      entry.bar.rotation.set(0, Math.PI / 2 - facingRad, 0);
    }
    renderer.render(scene, camera);
  };

  const dispose = (): void => {
    for (const d of disposables) d.dispose();
    renderer.dispose();
  };

  return { renderFrame, dispose };
}
