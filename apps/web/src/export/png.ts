import { exportableState } from '../state/store';
import { byOrder } from '../state/interpolate';
import { safeFilename } from './filename';
import { messages } from '../i18n';
import { build2dRenderer } from './video';

// build2dRenderer draws at a fixed 1280x720 layout.
const W = 1280;
const H = 720;

/**
 * PNG snapshot of the selected formation: the same top-down plan the video
 * export draws, frozen at the formation's start time (= its stored spots).
 */
export function exportFormationPng(): void {
  const s = exportableState();
  const formation =
    s.formations.find((f) => f.id === s.selectedFormationId) ?? byOrder(s.formations)[0];
  if (formation === undefined) return;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const draw = build2dRenderer(
    canvas,
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
  draw(formation.startTimeMs);

  canvas.toBlob((blob) => {
    if (blob === null) return;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${safeFilename(s.performance.title)}-${safeFilename(formation.name)}.png`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  });
}
