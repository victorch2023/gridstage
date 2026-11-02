import { readFile, stat } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Persisted doc shape (zustand persist envelope). */
interface PersistedDoc {
  state: {
    performance: {
      id: string;
      beatMarkersMs: number[];
      bpm: number | null;
      sections?: { id: string; timeMs: number; name: string }[];
    };
    performers: { id: string; name: string }[];
    formations: { id: string; orderIndex: number; startTimeMs: number }[];
    positions: Record<string, Record<string, { x: number; y: number; rotation: number }>>;
  };
}

async function readDoc(page: Page): Promise<PersistedDoc['state']> {
  const doc = await page.evaluate(
    () => JSON.parse(localStorage.getItem('gridstage-doc') ?? 'null') as PersistedDoc | null,
  );
  if (doc === null) throw new Error('gridstage-doc not in localStorage');
  return doc.state;
}

/**
 * Stage-area layout mirror of the app: meters -> viewport px (12×8 m stage).
 * Fresh documents use performer view (`audienceAt: 'top'`), so the plan is
 * mirrored: stored downstage (high y) lands toward the top of the screen.
 */
function meterToPx(xM: number, yM: number): { x: number; y: number } {
  const area = { x: 216, y: 46, w: 1440 - 216 - 248, h: 900 - 46 - 210 };
  const ppm = Math.min((area.w - 88) / 12, (area.h - 88) / 8);
  const ox = area.x + (area.w - 12 * ppm) / 2;
  const oy = area.y + (area.h - 8 * ppm) / 2;
  return { x: ox + (12 - xM) * ppm, y: oy + (8 - yM) * ppm };
}

/** 2s 16-bit mono WAV, 440Hz — in-memory upload fixture. */
function makeWav(): Buffer {
  const rate = 22050;
  const n = rate * 2;
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 20000), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

test.beforeEach(async ({ page }) => {
  // The suite exercises the full toolset — force expert mode (default is
  // easy). Patch, don't overwrite: layout widths must survive reloads.
  await page.addInitScript(() => {
    const raw = localStorage.getItem('gridstage-layout');
    const parsed = (raw !== null ? JSON.parse(raw) : { state: {}, version: 0 }) as {
      state: Record<string, unknown>;
      version: number;
    };
    parsed.state = { ...parsed.state, uiMode: 'expert' };
    localStorage.setItem('gridstage-layout', JSON.stringify(parsed));
    // The app defaults to Spanish. The suite asserts the English UI.
    localStorage.setItem(
      'gridstage-locale',
      JSON.stringify({ state: { locale: 'en' }, version: 0 }),
    );
  });
  await page.goto('/');
  await page.getByText('Add performer').waitFor();
});

test('easy mode hides power tools until expert is chosen', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Labelled objects' })).toBeVisible();
  await page.getByRole('button', { name: 'Preferences' }).click();
  await page.locator('#prefs-uimode').selectOption('easy');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  // Formation objects stay in easy mode; the other power tools do not.
  await expect(page.getByRole('button', { name: 'Labelled objects' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save cast as crew' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Tap beat' })).toBeHidden();
  // core flow stays visible
  await expect(page.getByRole('button', { name: 'Add performer' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export…' })).toBeVisible();
});

test('app shell renders', async ({ page }) => {
  await expect(page.locator('.wordmark')).toHaveText('GridStage');
  await expect(page.getByLabel('Stage canvas')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Timeline' })).toBeVisible();
});

test('add, drag and rotate a performer; doc survives reload', async ({ page }) => {
  await page.getByText('Add performer').click();

  // drag Dancer 1 from its default spot to (6, 2)
  const from = meterToPx(1.5, 6.5);
  const to = meterToPx(6, 2);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();

  await page.getByLabel('Facing degrees').fill('90');

  // keyboard nudge: blur the input first, then ArrowRight = +0.1m
  await page.getByLabel('Stage canvas').click({ position: { x: 10, y: 10 } });
  // clicking empty floor deselects; re-select via cast row
  await page.getByText('Dancer 1').first().click();
  await page.keyboard.press('ArrowRight');

  await page.reload();
  await page.getByText('Add performer').waitFor();

  const state = await readDoc(page);
  expect(state.performers).toHaveLength(1);
  const fid = state.formations[0]?.id ?? '';
  const pid = state.performers[0]?.id ?? '';
  const pos = state.positions[fid]?.[pid];
  expect(pos).toBeDefined();
  expect(Math.abs((pos?.x ?? 0) - 6.1)).toBeLessThan(0.3);
  expect(Math.abs((pos?.y ?? 0) - 2)).toBeLessThan(0.3);
  expect(pos?.rotation).toBe(90);
  await expect(page.getByText('Dancer 1').first()).toBeVisible();
});

test('second formation copies positions and edits independently', async ({ page }) => {
  await page.getByText('Add performer').click();
  await page.getByText('Add formation').click();

  const from = meterToPx(1.5, 6.5);
  const to = meterToPx(9, 4);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();

  const state = await readDoc(page);
  expect(state.formations).toHaveLength(2);
  const f1 = state.formations.find((f) => f.orderIndex === 0)?.id ?? '';
  const f2 = state.formations.find((f) => f.orderIndex === 1)?.id ?? '';
  const pid = state.performers[0]?.id ?? '';
  expect(Math.abs((state.positions[f1]?.[pid]?.x ?? 0) - 1.5)).toBeLessThan(0.1);
  expect(Math.abs((state.positions[f2]?.[pid]?.x ?? 0) - 9)).toBeLessThan(0.3);
});

test('formation tools: mirror flips x, align row shares depth', async ({ page }) => {
  await page.getByText('Add performer').click();
  await page.getByText('Add performer').click();

  // Place them deterministically via the X/Y inputs: (3,2) and (9,6).
  await page.getByText('Dancer 1').first().click();
  await page.locator('#pos-x').fill('3');
  await page.locator('#pos-y').fill('2');
  await page.getByText('Dancer 2').first().click();
  await page.locator('#pos-x').fill('9');
  await page.locator('#pos-y').fill('6');

  // Mirror the whole formation: x -> stageWidth(12) - x.
  await page.getByLabel('Stage canvas').click({ position: { x: 12, y: 12 } }); // deselect -> formation panel
  await page.getByRole('button', { name: 'Mirror left–right' }).click();
  let state = await readDoc(page);
  const fid = state.formations[0]?.id ?? '';
  const p1 = state.performers[0]?.id ?? '';
  const p2 = state.performers[1]?.id ?? '';
  expect(Math.abs((state.positions[fid]?.[p1]?.x ?? 0) - 9)).toBeLessThan(0.05); // 12 - 3
  expect(Math.abs((state.positions[fid]?.[p2]?.x ?? 0) - 3)).toBeLessThan(0.05); // 12 - 9

  // Select both, align to a row -> equal y.
  await page.getByText('Dancer 1').first().click();
  await page
    .getByText('Dancer 2')
    .first()
    .click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Align row' }).click();
  state = await readDoc(page);
  expect(
    Math.abs((state.positions[fid]?.[p1]?.y ?? 0) - (state.positions[fid]?.[p2]?.y ?? 1)),
  ).toBeLessThan(0.05);
});

test('group rotate and spread transform the selection around its center', async ({ page }) => {
  await page.getByText('Add performer').click();
  await page.getByText('Add performer').click();
  const state0 = await readDoc(page);
  const fid = state0.formations[0]?.id ?? '';
  const p1 = state0.performers[0]?.id ?? '';
  const p2 = state0.performers[1]?.id ?? '';
  // Put them on a known horizontal line: (4, 3) and (6, 3).
  await page.getByText('Dancer 1').first().click();
  await page.locator('#pos-x').fill('4');
  await page.locator('#pos-y').fill('3');
  await page.getByText('Dancer 2').first().click();
  await page.locator('#pos-x').fill('6');
  await page.locator('#pos-y').fill('3');

  // Select both and rotate 90° clockwise: line pivots around (5, 3).
  await page.getByText('Dancer 1').first().click();
  await page
    .getByText('Dancer 2')
    .first()
    .click({ modifiers: ['Shift'] });
  for (let i = 0; i < 6; i++) {
    await page.getByRole('button', { name: '⟳ Rotate 15°' }).click();
  }
  let state = await readDoc(page);
  const a = state.positions[fid]?.[p1];
  const b = state.positions[fid]?.[p2];
  expect(Math.abs((a?.x ?? 0) - 5)).toBeLessThan(0.05);
  expect(Math.abs((a?.y ?? 0) - 2)).toBeLessThan(0.05);
  expect(Math.abs((b?.x ?? 0) - 5)).toBeLessThan(0.05);
  expect(Math.abs((b?.y ?? 0) - 4)).toBeLessThan(0.05);
  expect(a?.rotation).toBe(90);

  // Spread: distance from the centroid grows by 1.15.
  await page.getByRole('button', { name: 'Spread out' }).click();
  state = await readDoc(page);
  expect(Math.abs((state.positions[fid]?.[p1]?.y ?? 0) - (3 - 1.15))).toBeLessThan(0.05);
  expect(Math.abs((state.positions[fid]?.[p2]?.y ?? 0) - (3 + 1.15))).toBeLessThan(0.05);
});

test('state marker is per-formation and survives reload', async ({ page }) => {
  await page.getByText('Add performer').click();
  await page.getByText('Add formation').click(); // formation 2, copies positions
  const state0 = await readDoc(page);
  const pid = state0.performers[0]?.id ?? '';
  const [f1, f2] = [...state0.formations].sort((a, b) => a.orderIndex - b.orderIndex);

  // Mark the dancer as (say) kneeling in formation 2 only.
  await page.getByText('Dancer 1').first().click();
  await page.locator('#pos-marker').selectOption('triangle');
  let state = await readDoc(page);
  type WithMarker = { marker?: string };
  expect((state.positions[f2?.id ?? '']?.[pid] as WithMarker | undefined)?.marker).toBe('triangle');
  expect((state.positions[f1?.id ?? '']?.[pid] as WithMarker | undefined)?.marker).toBeUndefined();

  // Clearing removes the key; persists across reload.
  await page.reload();
  await page.getByText('Add performer').waitFor();
  state = await readDoc(page);
  expect((state.positions[f2?.id ?? '']?.[pid] as WithMarker | undefined)?.marker).toBe('triangle');
  // Reload healed the selection back to formation 1 — reselect formation 2
  // (its block's aria-label is "Formation <name>, starts at <t>s").
  await page.getByRole('button', { name: /^Formation Formation 2,/ }).click();
  await page.getByText('Dancer 1').first().click();
  await page.locator('#pos-marker').selectOption('');
  state = await readDoc(page);
  expect((state.positions[f2?.id ?? '']?.[pid] as WithMarker | undefined)?.marker).toBeUndefined();
});

test('backup nudge appears for real work and snoozes for a week', async ({ page }) => {
  // Fresh doc: no nudge.
  await expect(page.getByText('Export backup')).toBeHidden();
  // Three performers cross the "real work" threshold; the check runs at
  // mount, so it shows after a reload.
  for (let i = 0; i < 3; i++) await page.getByText('Add performer').click();
  await page.reload();
  await page.getByText('Add performer').waitFor();
  await expect(page.getByRole('button', { name: 'Export backup' })).toBeVisible();
  // "Later" snoozes across reloads.
  await page.getByRole('button', { name: 'Later', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Export backup' })).toBeHidden();
  await page.reload();
  await page.getByText('Add performer').waitFor();
  await expect(page.getByText('Export backup')).toBeHidden();
});

/** Record a webm in-page (canvas capture) — no binary fixture in the repo. */
async function recordTestWebm(page: Page, durationMs = 3000): Promise<Buffer> {
  const videoBytes = await page.evaluate(async (lengthMs) => {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 120;
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('no 2d context');
    const recorder = new MediaRecorder(canvas.captureStream(10), { mimeType: 'video/webm' });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    const stopped = new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
    });
    recorder.start();
    const startedAt = performance.now();
    await new Promise<void>((resolve) => {
      const draw = (): void => {
        ctx.fillStyle = `hsl(${((performance.now() - startedAt) / 10).toFixed(0)}, 70%, 50%)`;
        ctx.fillRect(0, 0, 160, 120);
        if (performance.now() - startedAt > lengthMs) {
          recorder.stop();
          resolve();
        } else {
          requestAnimationFrame(draw);
        }
      };
      draw();
    });
    return Array.from(new Uint8Array(await (await stopped).arrayBuffer()));
  }, durationMs);
  return Buffer.from(videoBytes);
}

test('reference video: loads, seeks with the offset, switches layouts, drives playback', async ({
  page,
}) => {
  await page.getByLabel('Reference video file').setInputFiles({
    name: 'ref.webm',
    mimeType: 'video/webm',
    buffer: await recordTestWebm(page),
  });
  await expect(page.getByLabel('Reference video', { exact: true })).toBeVisible();

  // Offset 1s: with the playhead paused at 0, the video seeks to 1.0s.
  await page.locator('#ref-video-offset').fill('1');
  await expect
    .poll(() =>
      page.evaluate(
        () => document.querySelector<HTMLVideoElement>('.ref-video-el')?.currentTime ?? -1,
      ),
    )
    .toBeGreaterThan(0.8);

  // Layout round-trip PiP → split → PiP.
  await page.getByRole('button', { name: 'Split', exact: true }).click();
  await expect(page.locator('.stage-area-split')).toBeVisible();
  await page.getByRole('button', { name: 'PiP', exact: true }).click();
  await expect(page.locator('.stage-area-split')).toHaveCount(0);

  // Play: the video is the clock — it advances past the seeked position.
  await page.getByRole('button', { name: 'Play' }).click();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: 'Pause' }).click();
  const videoTime = await page.evaluate(
    () => document.querySelector<HTMLVideoElement>('.ref-video-el')?.currentTime ?? -1,
  );
  expect(videoTime).toBeGreaterThan(1.2);
  const paused = await page.evaluate(
    () => document.querySelector<HTMLVideoElement>('.ref-video-el')?.paused ?? false,
  );
  expect(paused).toBe(true);

  // Close removes the panel; playback falls back to the rAF clock.
  await page
    .getByLabel('Reference video', { exact: true })
    .getByRole('button', { name: 'Close' })
    .click();
  await expect(page.getByLabel('Reference video', { exact: true })).toBeHidden();
});

test('stage-corner calibration shows a live meter grid and draggable pins', async ({ page }) => {
  await page.getByLabel('Reference video file').setInputFiles({
    name: 'ref.webm',
    mimeType: 'video/webm',
    buffer: await recordTestWebm(page),
  });
  await expect(page.getByLabel('Reference video', { exact: true })).toBeVisible();
  // Split layout gives the overlay a real size to hit-test against.
  await page.getByRole('button', { name: 'Split', exact: true }).click();
  await page.getByRole('button', { name: 'Calibrate' }).click();
  const overlay = page.getByRole('application', { name: 'Stage corner calibration' });
  await expect(overlay).toBeVisible();
  // Default 12x8m stage: 13 vertical + 9 horizontal grid lines.
  await expect(overlay.locator('line')).toHaveCount(22);

  // Drag the upstage-left pin and verify it moved.
  const pin = overlay.locator('circle').first();
  const before = await pin.boundingBox();
  expect(before).not.toBeNull();
  if (before === null) return;
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + 60, before.y + 40, { steps: 5 });
  await page.mouse.up();
  const after = await pin.boundingBox();
  expect(after).not.toBeNull();
  if (after === null) return;
  expect(Math.abs(after.x - before.x)).toBeGreaterThan(30);
  // Grid still renders after the drag (homography stayed solvable).
  await expect(overlay.locator('line')).toHaveCount(22);

  // Off-frame pins: drag the downstage-left pin far past the picture's left
  // edge — the stored intrinsic x must go negative (cameras often cut off a
  // stage corner, so pins must be allowed outside the frame).
  const dlPin = overlay.locator('circle').nth(3);
  const dlBox = await dlPin.boundingBox();
  expect(dlBox).not.toBeNull();
  if (dlBox === null) return;
  await page.mouse.move(dlBox.x + dlBox.width / 2, dlBox.y + dlBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(dlBox.x - 250, dlBox.y + dlBox.height / 2, { steps: 5 });
  await page.mouse.up();
  const dlX = await page.evaluate(async () => {
    const refVideoPath = '/src/state/refVideo.ts';
    const refVideo = (await import(refVideoPath)) as {
      useRefVideo: { getState: () => { corners: { x: number; y: number }[] | null } };
    };
    return refVideo.useRefVideo.getState().corners?.[3]?.x ?? Number.NaN;
  });
  expect(dlX).toBeLessThan(0);

  // Full screen: the panel takes the whole screen and comes back.
  await page.getByRole('button', { name: 'Full screen', exact: false }).click();
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement?.className ?? null))
    .toContain('ref-video');
  await page.getByRole('button', { name: 'Exit full screen', exact: false }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);

  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(overlay).toBeHidden();
});

test('video capture places detected dancers into the selected formation', async ({ page }) => {
  await page.getByText('Add performer').click();
  await page.getByText('Add performer').click();
  await page.getByLabel('Reference video file').setInputFiles({
    name: 'ref.webm',
    mimeType: 'video/webm',
    buffer: await recordTestWebm(page),
  });
  await expect(page.getByLabel('Reference video', { exact: true })).toBeVisible();

  // Calibrate straight from the store (the pin-drag UX has its own test):
  // corners = the full 160x120 frame, so pixels map linearly onto the 12x8m
  // stage. Stub the detector with two known boxes; foot points land at
  // (3, 4) and (9, 6) meters.
  await page.evaluate(async () => {
    // Vite dev-server module URLs — a variable keeps tsc from resolving them.
    const refVideoPath = '/src/state/refVideo.ts';
    const detectorPath = '/src/vision/detector.ts';
    const refVideo = (await import(refVideoPath)) as {
      useRefVideo: {
        getState: () => { setCorners: (c: { x: number; y: number }[]) => void };
      };
    };
    refVideo.useRefVideo.getState().setCorners([
      { x: 0, y: 0 },
      { x: 160, y: 0 },
      { x: 160, y: 120 },
      { x: 0, y: 120 },
    ]);
    const detector = (await import(detectorPath)) as {
      setDetectorOverride: (
        fn: (
          img: CanvasImageSource,
          w: number,
          h: number,
        ) => Promise<{ x: number; y: number; width: number; height: number; score: number }[]>,
      ) => void;
    };
    detector.setDetectorOverride(() =>
      Promise.resolve([
        { x: 30, y: 20, width: 20, height: 40, score: 0.9 },
        { x: 110, y: 50, width: 20, height: 40, score: 0.85 },
      ]),
    );
    // Stub pose too (M1 facing): first assigned dancer faces 90°, second 180°.
    const posePath = '/src/vision/pose.ts';
    const pose = (await import(posePath)) as {
      setPoseOverride: (
        fn: (
          img: CanvasImageSource,
          boxes: readonly unknown[],
        ) => Promise<({ rotation: number } | null)[]>,
      ) => void;
    };
    pose.setPoseOverride((img, boxes) =>
      Promise.resolve(boxes.map((_, i) => ({ rotation: i === 0 ? 90 : 180 }))),
    );
  });

  await page.getByRole('button', { name: 'Capture formation' }).click();
  await expect(page.getByText(/Placed 2 dancers/)).toBeVisible();

  const state = await readDoc(page);
  const fid = state.formations[0]?.id ?? '';
  const spots = Object.values(state.positions[fid] ?? {}).map((p) => ({
    x: Math.round(p.x * 10) / 10,
    y: Math.round(p.y * 10) / 10,
  }));
  expect(spots).toHaveLength(2);
  expect(spots).toEqual(
    expect.arrayContaining([
      { x: 3, y: 4 },
      { x: 9, y: 6 },
    ]),
  );
  // Facing (M1) landed too, via the stubbed pose model.
  const rotations = Object.values(state.positions[fid] ?? {})
    .map((p) => p.rotation)
    .sort((a, b) => a - b);
  expect(rotations).toEqual([90, 180]);
});

test('whole-video scan rebuilds the chart after a confirm', async ({ page }) => {
  test.setTimeout(90_000);
  await page.getByText('Add performer').click();
  await page.getByText('Add performer').click();
  await page.getByLabel('Reference video file').setInputFiles({
    name: 'show.webm',
    mimeType: 'video/webm',
    buffer: await recordTestWebm(page, 8500),
  });
  await expect(page.getByLabel('Reference video', { exact: true })).toBeVisible();

  // Calibrate linearly (full 160x120 frame = 12x8m stage) and stub the
  // detector to act out: hold A (t<3.5s), transition, hold B (t>5.5s).
  await page.evaluate(async () => {
    // Vite dev-server module URLs — a variable keeps tsc from resolving them.
    const refVideoPath = '/src/state/refVideo.ts';
    const detectorPath = '/src/vision/detector.ts';
    const refVideo = (await import(refVideoPath)) as {
      useRefVideo: {
        getState: () => { setCorners: (c: { x: number; y: number }[]) => void };
      };
    };
    refVideo.useRefVideo.getState().setCorners([
      { x: 0, y: 0 },
      { x: 160, y: 0 },
      { x: 160, y: 120 },
      { x: 0, y: 120 },
    ]);
    const detector = (await import(detectorPath)) as {
      setDetectorOverride: (
        fn: (
          img: CanvasImageSource,
          w: number,
          h: number,
        ) => Promise<{ x: number; y: number; width: number; height: number; score: number }[]>,
      ) => void;
    };
    const box = (
      footX: number,
      footY: number,
    ): { x: number; y: number; width: number; height: number; score: number } => ({
      x: footX - 10,
      y: footY - 40,
      width: 20,
      height: 40,
      score: 0.9,
    });
    detector.setDetectorOverride((img) => {
      const t = img instanceof HTMLVideoElement ? img.currentTime : 0;
      if (t < 3.5) {
        // Hold A: (3,4) and (9,6) meters -> (40,60) and (120,90) px.
        return Promise.resolve([box(40, 60), box(120, 90)]);
      }
      if (t < 5.5) {
        // Transition: both drifting.
        const k = (t - 3.5) * 30;
        return Promise.resolve([box(40 + k, 60), box(120 - k, 90)]);
      }
      // Hold B: (6,2) and (3,6) meters -> (80,30) and (40,90) px.
      return Promise.resolve([box(80, 30), box(40, 90)]);
    });
  });

  // Playwright dismisses dialogs by default = the user clicking Cancel on
  // the replace confirm: nothing may change.
  await page.getByRole('button', { name: 'Scan whole video' }).click();
  await expect(page.getByText('Scan cancelled — nothing was changed')).toBeVisible({
    timeout: 60_000,
  });
  expect((await readDoc(page)).formations).toHaveLength(1);

  // Accept the confirm: the scan REPLACES the whole chart.
  page.on('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Scan whole video' }).click();
  await expect(page.getByText(/Rebuilt the chart from the video: 2 formations/)).toBeVisible({
    timeout: 60_000,
  });

  const state = await readDoc(page);
  // The default formation is gone — only the 2 scanned holds remain.
  expect(state.formations).toHaveLength(2);
  const ordered = [...state.formations].sort((a, b) => a.orderIndex - b.orderIndex);
  const holdA = ordered[0];
  const holdB = ordered[1];
  expect(holdA?.startTimeMs).toBe(0);
  expect(holdB?.startTimeMs ?? 0).toBeGreaterThanOrEqual(6000);
  const spotsA = Object.values(state.positions[holdA?.id ?? ''] ?? {}).map((p) => ({
    x: Math.round(p.x),
    y: Math.round(p.y),
  }));
  expect(spotsA).toEqual(
    expect.arrayContaining([
      { x: 3, y: 4 },
      { x: 9, y: 6 },
    ]),
  );
  const spotsB = Object.values(state.positions[holdB?.id ?? ''] ?? {}).map((p) => ({
    x: Math.round(p.x),
    y: Math.round(p.y),
  }));
  expect(spotsB).toEqual(
    expect.arrayContaining([
      { x: 6, y: 2 },
      { x: 3, y: 6 },
    ]),
  );

  // One Undo restores the pre-scan chart.
  await page.getByRole('button', { name: 'Undo' }).click();
  const afterUndo = await readDoc(page);
  expect(afterUndo.formations).toHaveLength(1);
});

test('loop posts appear on the timeline and are draggable', async ({ page }) => {
  await page.getByText('Add performer').click();
  await page.getByRole('button', { name: 'Loop', exact: true }).click();

  // Posts + band render; the default range hugs the playhead (0 → +4s).
  const startPost = page.getByRole('slider', { name: 'Loop start' });
  const endPost = page.getByRole('slider', { name: 'Loop end' });
  await expect(startPost).toBeVisible();
  await expect(endPost).toBeVisible();
  await expect(page.locator('.loop-band')).toBeVisible();
  await expect(startPost).toHaveAttribute('aria-valuenow', '0');
  await expect(endPost).toHaveAttribute('aria-valuenow', '4000');

  // Dragging the end post right of the first formation's end snaps to it
  // (default formation: 0–8s; timeline spans 30s).
  const box = await endPost.boundingBox();
  if (box === null) throw new Error('end post not rendered');
  const content = await page.locator('.timeline-content').boundingBox();
  if (content === null) throw new Error('timeline content not rendered');
  const targetX = content.x + content.width * (8100 / 30_000);
  await endPost.hover();
  await page.mouse.down();
  await page.mouse.move(targetX, box.y + 40, { steps: 5 });
  await page.mouse.up();
  await expect(endPost).toHaveAttribute('aria-valuenow', '8000');

  // Toggling off hides the posts.
  await page.getByRole('button', { name: 'Loop', exact: true }).click();
  await expect(page.locator('.loop-band')).toHaveCount(0);
});

test('section markers: add, name, persist, remove', async ({ page }) => {
  await page.getByRole('button', { name: 'Add section' }).click();
  // The rename box is focused immediately; type a name and commit.
  await page.getByLabel('Section name').fill('Chorus');
  await page.getByLabel('Section name').press('Enter');

  let doc = await readDoc(page);
  expect(doc.performance.sections?.[0]?.name).toBe('Chorus');

  await page.reload();
  await page.getByText('Add performer').waitFor();
  await expect(page.getByText('Chorus')).toBeVisible();

  await page.getByRole('button', { name: 'Remove section Chorus' }).click();
  doc = await readDoc(page);
  expect(doc.performance.sections ?? []).toHaveLength(0);
});

test('playback without audio advances and pauses', async ({ page }) => {
  await page.getByRole('button', { name: 'Play' }).click();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: 'Pause' }).click();
  const timecode = await page.getByLabel('Playhead time').textContent();
  expect(timecode).not.toContain('0:00.0');
});

test('playback speed control scales how fast the playhead advances', async ({ page }) => {
  await page.getByLabel('Playback speed').selectOption('2.0');
  await page.getByRole('button', { name: 'Play' }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Pause' }).click();

  const text = (await page.getByLabel('Playhead time').textContent()) ?? '';
  const parts = /(\d+):(\d+)\.(\d)/.exec(text);
  const seconds =
    Number(parts?.[1] ?? 0) * 60 + Number(parts?.[2] ?? 0) + Number(parts?.[3] ?? 0) / 10;
  // 1.2s of wall clock at 2.0x ≈ 2.4s of show time (loose band for CI jitter).
  expect(seconds).toBeGreaterThanOrEqual(1.8);
  expect(seconds).toBeLessThanOrEqual(3.5);
});

test('sidebars resize by dragging and the width persists', async ({ page }) => {
  const cast = page.locator('.cast-panel');
  expect(Math.round((await cast.boundingBox())?.width ?? 0)).toBe(216);

  const handle = page.getByLabel('Resize cast panel');
  const box = await handle.boundingBox();
  const grabY = (box?.y ?? 0) + 200;
  await page.mouse.move((box?.x ?? 0) + 3, grabY);
  await page.mouse.down();
  await page.mouse.move(320, grabY, { steps: 5 });
  await page.mouse.up();
  expect(Math.abs(((await cast.boundingBox())?.width ?? 0) - 320)).toBeLessThanOrEqual(8);

  await page.reload();
  await page.getByText('Add performer').waitFor();
  expect(
    Math.abs(((await page.locator('.cast-panel').boundingBox())?.width ?? 0) - 320),
  ).toBeLessThanOrEqual(8);
});

test('timeline height resizes by dragging and persists', async ({ page }) => {
  const timeline = page.locator('.timeline-panel');
  expect(Math.round((await timeline.boundingBox())?.height ?? 0)).toBe(210);

  const handle = page.getByLabel('Resize timeline height');
  const box = await handle.boundingBox();
  const grabX = (box?.x ?? 0) + 300;
  await page.mouse.move(grabX, (box?.y ?? 0) + 3);
  await page.mouse.down();
  await page.mouse.move(grabX, 600, { steps: 5 }); // drag up -> taller timeline
  await page.mouse.up();
  const grown = (await timeline.boundingBox())?.height ?? 0;
  expect(grown).toBeGreaterThan(260);

  await page.reload();
  await page.getByText('Add performer').waitFor();
  const after = (await page.locator('.timeline-panel').boundingBox())?.height ?? 0;
  expect(Math.abs(after - grown)).toBeLessThanOrEqual(8);
});

test('audio upload, beat markers, waveform persistence', async ({ page }) => {
  await page.setInputFiles('input[aria-label="Audio file"]', {
    name: 'tone.wav',
    mimeType: 'audio/wav',
    buffer: makeWav(),
  });
  await page.getByText('Replace audio').waitFor();

  await page.getByRole('button', { name: 'Play' }).click();
  // Audio needs a moment to buffer before its clock advances — wait until the
  // playhead passes 0.3s before tapping.
  await expect(page.getByLabel('Playhead time')).toHaveText(/0:00\.[3-9]|0:0[1-9]/, {
    timeout: 5000,
  });
  await page.getByRole('button', { name: 'Tap beat' }).click();
  await page.getByRole('button', { name: 'Pause' }).click();

  const state = await readDoc(page);
  expect(state.performance.beatMarkersMs).toHaveLength(1);
  expect(state.performance.beatMarkersMs[0]).toBeGreaterThan(200);

  await page.reload();
  await expect(page.getByText('Replace audio')).toBeVisible();
});

test('drag a formation to reposition it in time; undo reverts in one step', async ({ page }) => {
  await page.getByText('Add formation').click(); // now 2 formations: 0s and 12s

  const content = page.locator('.timeline-content');
  const box = await content.boundingBox();
  if (box === null) throw new Error('no timeline content box');
  const totalMs = 30_000; // 2 formations end at 20s, clamped up to MIN 30s
  const px = (ms: number): number => box.x + (ms / totalMs) * box.width;
  const rowY = box.y + box.height - 8 - 22;

  let formations = (await readDoc(page)).formations;
  const f2 = formations.find((f) => f.orderIndex === 1);
  if (f2 === undefined) throw new Error('no second formation');

  await page.mouse.move(px(12500), rowY);
  await page.mouse.down();
  await page.mouse.move(px(6000), rowY, { steps: 12 });
  await page.mouse.up();

  formations = (await readDoc(page)).formations;
  const moved = formations.find((f) => f.id === f2.id);
  expect(moved).toBeDefined();
  // Was 12000ms, dragged toward 5.5s.
  expect(moved?.startTimeMs ?? 0).toBeLessThan(9000);
  expect(moved?.startTimeMs ?? 0).toBeGreaterThan(2000);

  await page.locator('.timeline-content').focus();
  await page.keyboard.press('Control+z');
  formations = (await readDoc(page)).formations;
  expect(formations.find((f) => f.id === f2.id)?.startTimeMs).toBe(12000);
});

test('zoom widens the timeline content', async ({ page }) => {
  const before = (await page.locator('.timeline-content').boundingBox())?.width ?? 0;
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  const after = (await page.locator('.timeline-content').boundingBox())?.width ?? 0;
  expect(after).toBeGreaterThan(before * 1.8);
});

test('untangle swaps crossing walk paths to the minimal-travel assignment', async ({ page }) => {
  await page.getByText('Add performer').click(); // D1 @ (1.5, 6.5)
  await page.getByText('Add performer').click(); // D2 @ (3, 6.5)
  await page.getByText('Add formation').click(); // F2 copies F1

  const drag = async (fx: number, fy: number, tx: number, ty: number): Promise<void> => {
    const from = meterToPx(fx, fy);
    const to = meterToPx(tx, ty);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
  };
  // Send D1 far right and D2 to the middle — their paths cross.
  await drag(1.5, 6.5, 9, 2);
  await drag(3, 6.5, 5, 2);

  // Deselect so the Formation section (with the button) is visible.
  await page.getByLabel('Stage canvas').click({ position: { x: 15, y: 15 } });
  await page.getByRole('button', { name: 'Untangle from previous' }).click();

  const state = await readDoc(page);
  const f2 = state.formations.find((f) => f.orderIndex === 1);
  const [d1, d2] = state.performers;
  if (f2 === undefined || d1 === undefined || d2 === undefined) throw new Error('setup failed');
  const p1 = state.positions[f2.id]?.[d1.id];
  const p2 = state.positions[f2.id]?.[d2.id];
  // Spots swapped: D1 takes (5,2), D2 takes (9,2) — no more crossing.
  expect(Math.abs((p1?.x ?? 0) - 5)).toBeLessThan(0.4);
  expect(Math.abs((p2?.x ?? 0) - 9)).toBeLessThan(0.4);
});

test('curve transition: dragging the handle stores a Bézier control point', async ({ page }) => {
  await page.getByText('Add performer').click(); // D1 @ (1.5, 6.5)
  await page.getByText('Add formation').click(); // F2 selected, copies F1

  // Move D1 in F2 so there is a real path: (1.5,6.5) -> (9,3)
  const from = meterToPx(1.5, 6.5);
  const to = meterToPx(9, 3);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();

  // Transition type lives on the formation being LEFT (F1).
  await page.getByLabel('Stage canvas').click({ position: { x: 15, y: 15 } });
  await page.getByRole('button', { name: /Formation 1/ }).click();
  await page.selectOption('#form-transition', 'curve');

  // Back to F2, select D1 so its handle (at the path midpoint) appears.
  await page.getByRole('button', { name: /Formation 2/ }).click();
  await page.getByText('Dancer 1').first().click();

  const mid = meterToPx((1.5 + 9) / 2, (6.5 + 3) / 2);
  const bent = meterToPx(5.25, 1.5);
  await page.mouse.move(mid.x, mid.y);
  await page.mouse.down();
  await page.mouse.move(bent.x, bent.y, { steps: 8 });
  await page.mouse.up();

  const state = await readDoc(page);
  const f1 = state.formations.find((f) => f.orderIndex === 0);
  const d1 = state.performers[0];
  if (f1 === undefined || d1 === undefined) throw new Error('setup failed');
  const pos = state.positions[f1.id]?.[d1.id] as
    { curveControlPoints?: { x: number; y: number }[] } | undefined;
  const control = pos?.curveControlPoints?.[0];
  expect(control).toBeDefined();
  expect(Math.abs((control?.x ?? 0) - 5.25)).toBeLessThan(0.4);
  expect(Math.abs((control?.y ?? 0) - 1.5)).toBeLessThan(0.4);
});

test('view mode hides editing UI and blocks dragging', async ({ page }) => {
  await page.getByText('Add performer').click();
  await page.goto('/?mode=view');
  await page.locator('.wordmark').waitFor();

  await expect(page.getByText('Add performer')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();

  // Dragging the mark must not move it.
  const before = (await readDoc(page)).positions;
  const from = meterToPx(1.5, 6.5);
  const to = meterToPx(6, 2);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  const after = (await readDoc(page)).positions;
  expect(after).toEqual(before);
});

test('version history: snapshot, mutate, restore', async ({ page }) => {
  await page.getByText('Add performer').click();
  await page.getByLabel('Stage canvas').click({ position: { x: 15, y: 15 } });

  // History lives in a collapsed <details> fold now — expand it first.
  await page.locator('summary', { hasText: 'History' }).click();
  await page.getByRole('button', { name: 'Save snapshot' }).click();
  await page.getByRole('button', { name: 'Restore' }).waitFor();

  // Mutate: add two more performers.
  await page.getByText('Add performer').click();
  await page.getByText('Add performer').click();
  expect((await readDoc(page)).performers).toHaveLength(3);

  await page.getByLabel('Stage canvas').click({ position: { x: 15, y: 15 } });
  await page.getByRole('button', { name: 'Restore' }).click();
  expect((await readDoc(page)).performers).toHaveLength(1);

  // Restore is one undo step away from the pre-restore state.
  await page.keyboard.press('Control+z');
  expect((await readDoc(page)).performers).toHaveLength(3);
});

test('3D preview toggles on and back off', async ({ page }) => {
  await page.getByText('Add performer').click();
  await page.getByRole('button', { name: '3D', exact: true }).click();
  // three.js canvas appears (lazy chunk)
  await expect(page.locator('.stage-area canvas')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await expect(page.getByRole('button', { name: '3D', exact: true })).toBeVisible();
});

test('3D camera presets are present and reframe without crashing', async ({ page }) => {
  await page.getByText('Add performer').click();
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.locator('.stage-area canvas')).toBeVisible({ timeout: 15_000 });
  for (const name of ['Overhead', 'Side', 'Audience']) {
    await page.getByRole('button', { name, exact: true }).click();
  }
  // Follow a performer, then back to a free preset.
  await page.getByLabel('Follow a performer').selectOption({ label: 'Follow Dancer 1' });
  await page.getByRole('button', { name: 'Overhead', exact: true }).click();
  await expect(page.getByLabel('Follow a performer')).toHaveValue('');
  // Still rendering after the camera moves.
  await expect(page.locator('.stage-area canvas')).toBeVisible();
});

test('PDF export downloads a file', async ({ page }) => {
  await page.getByRole('button', { name: 'Export…' }).click();
  await page.getByRole('button', { name: 'PDF · Walk charts' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('walk-charts.pdf');
});

test('personal walk sheets PDF downloads', async ({ page }) => {
  await page.getByText('Add performer').click();
  await page.getByRole('button', { name: 'Export…' }).click();
  await page.getByRole('button', { name: 'PDF · Personal sheets' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('walk-sheets.pdf');
});

test('choreography file exports and imports back as a new library entry', async ({ page }) => {
  // Export the open doc as a .gridstage file.
  await page.getByRole('button', { name: 'Export…' }).click();
  await page.getByRole('button', { name: 'File · Choreography (.gridstage)' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.gridstage$/);
  const filePath = await download.path();
  const buffer = await readFile(filePath);
  await page.getByRole('button', { name: 'Close' }).click();

  // Import it back: always lands as a NEW doc (fresh id) and opens.
  // Legacy double-extension name on purpose — old backups must keep working.
  const idBefore = (await readDoc(page)).performance.id;
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByLabel('Choreography file').setInputFiles({
    name: 'untitled-performance.gridstage.json',
    mimeType: 'application/json',
    buffer,
  });
  // Success closes the dialog and opens the imported copy.
  await expect(page.locator('.library-dialog')).not.toBeVisible();
  const idAfter = (await readDoc(page)).performance.id;
  expect(idAfter).not.toBe(idBefore);

  // The library now lists both docs with the same title.
  await page.getByRole('button', { name: 'Library' }).click();
  await expect(page.locator('.library-row-title', { hasText: 'Untitled performance' })).toHaveCount(
    2,
  );
  await page.getByRole('button', { name: 'Close' }).click();

  // A garbage file is rejected with a message, dialog stays open.
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByLabel('Choreography file').setInputFiles({
    name: 'junk.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"foo": 1}'),
  });
  await expect(page.getByText('Not a GridStage choreography file')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
});

test('60 performers: playback holds a usable frame rate and drag still works', async ({ page }) => {
  // Seed a 60-performer, 4-formation doc straight into the persist envelope —
  // clicking "Add performer" 60 times would dominate the test's runtime.
  await page.evaluate(() => {
    const performanceId = 'stress-perf';
    const performers = Array.from({ length: 60 }, (_, i) => ({
      id: `p${i}`,
      performanceId,
      name: `Dancer ${i + 1}`,
      color: '#e05252',
      role: '',
      avatarUrl: null,
    }));
    const formations = Array.from({ length: 4 }, (_, i) => ({
      id: `f${i}`,
      performanceId,
      orderIndex: i,
      startTimeMs: i * 4000,
      durationMs: 2000,
      transitionType: 'linear',
      name: `Formation ${i + 1}`,
    }));
    // 10×6 grid; each formation shifts the grid so every transition moves
    // all 60 dancers (worst-case interpolation load).
    const positions: Record<string, Record<string, object>> = {};
    for (let fi = 0; fi < 4; fi++) {
      const inner: Record<string, object> = {};
      for (let i = 0; i < 60; i++) {
        inner[`p${i}`] = {
          formationId: `f${fi}`,
          performerId: `p${i}`,
          x: 1 + (i % 10) + (fi % 2) * 0.8,
          y: 1 + Math.floor(i / 10) + (fi % 2) * 0.6,
          rotation: 0,
        };
      }
      positions[`f${fi}`] = inner;
    }
    const doc = {
      performance: {
        id: performanceId,
        orgId: 'local',
        title: 'Stress test',
        stageWidth: 12,
        stageHeight: 8,
        bpm: null,
        audioAssetId: null,
        beatMarkersMs: [],
        sections: [],
        countSegments: [],
        audienceAt: 'top',
      },
      performers,
      props: [],
      formations,
      positions,
      comments: [],
      annotations: [],
    };
    localStorage.setItem('gridstage-doc', JSON.stringify({ state: doc, version: 0 }));
  });
  await page.reload();
  await page.getByText('Add performer').waitFor();
  await expect(page.getByText('Dancer 60')).toBeVisible();

  // Dragging one dancer among 60 still lands where it should (playhead at 0,
  // so formation f0 is the one being edited; p0 sits at (1, 1)).
  const from = meterToPx(1, 1);
  const to = meterToPx(6, 7);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  const state = await readDoc(page);
  const pos = state.positions['f0']?.['p0'];
  expect(pos).toBeDefined();
  expect(Math.abs((pos?.x ?? 0) - 6)).toBeLessThan(0.3);
  expect(Math.abs((pos?.y ?? 0) - 7)).toBeLessThan(0.3);

  // Play and count real rendered frames for 2 seconds of all-60 interpolation.
  await page.getByRole('button', { name: 'Play' }).click();
  const fps = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let frames = 0;
        const startedAt = performance.now();
        const tick = (): void => {
          frames += 1;
          if (performance.now() - startedAt >= 2000) {
            resolve((frames * 1000) / (performance.now() - startedAt));
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
  await page.getByRole('button', { name: 'Pause' }).click();
  console.log(`[stress] 60-performer playback: ${fps.toFixed(1)} fps`);
  // ponytail: 20fps floor is deliberately generous for CI machines; the
  // console line above records the real number for humans to eyeball.
  expect(fps).toBeGreaterThan(20);
});

test('badge normalizes and persists', async ({ page }) => {
  await page.getByText('Add performer').click();
  await page.getByText('Dancer 1').first().click();
  await page.getByLabel('Badge (inside the mark)').fill('舞者');
  let doc = await readDoc(page);
  expect((doc.performers[0] as { badge?: string }).badge).toBe('舞');
  await page.getByLabel('Badge (inside the mark)').fill('LEADER');
  doc = await readDoc(page);
  expect((doc.performers[0] as { badge?: string }).badge).toBe('LEAD');
});

test('copy positions from another formation', async ({ page }) => {
  await page.getByText('Add performer').click();
  // Move Dancer 1 in Formation 1, then add Formation 2 and move them again.
  const from = meterToPx(1.5, 6.5);
  const mid = meterToPx(9, 2);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(mid.x, mid.y, { steps: 8 });
  await page.mouse.up();
  await page.getByText('Add formation').click();
  const back = meterToPx(3, 3);
  await page.mouse.move(mid.x, mid.y);
  await page.mouse.down();
  await page.mouse.move(back.x, back.y, { steps: 8 });
  await page.mouse.up();

  // Deselect performer so the formation panel (with the picker) is visible.
  await page.getByLabel('Stage canvas').click({ position: { x: 10, y: 10 } });
  const before = await readDoc(page);
  const f1 = before.formations.find((f) => f.orderIndex === 0)?.id ?? '';
  const f2 = before.formations.find((f) => f.orderIndex === 1)?.id ?? '';
  const pid = before.performers[0]?.id ?? '';
  expect(before.positions[f2]?.[pid]?.x).not.toBeCloseTo(before.positions[f1]?.[pid]?.x ?? 0, 1);

  await page.getByLabel('Source formation').selectOption({ label: 'Formation 1' });
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  const after = await readDoc(page);
  expect(after.positions[f2]?.[pid]?.x).toBeCloseTo(after.positions[f1]?.[pid]?.x ?? 0, 3);
  expect(after.positions[f2]?.[pid]?.y).toBeCloseTo(after.positions[f1]?.[pid]?.y ?? 0, 3);
});

test('marquee selects several performers and drags them together', async ({ page }) => {
  await page.getByText('Add performer').click();
  await page.getByText('Add performer').click();
  await page.getByText('Add performer').click();

  // Rubber-band over the whole floor: all three get selected.
  const a = meterToPx(0.4, 5.2);
  const b = meterToPx(11.5, 7.8);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByText(/3 selected/)).toBeVisible();

  const before = await readDoc(page);
  const fid = before.formations[0]?.id ?? '';
  const ids = before.performers.map((p) => p.id);
  const start = ids.map((id) => ({ ...before.positions[fid]?.[id] }));

  // Drag the first mark 2m right and 3m up — the whole group must follow.
  const grab = meterToPx(before.positions[fid]?.[ids[0] ?? '']?.x ?? 0, 6.5);
  const drop = meterToPx((before.positions[fid]?.[ids[0] ?? '']?.x ?? 0) + 2, 3.5);
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(drop.x, drop.y, { steps: 10 });
  await page.mouse.up();

  const after = await readDoc(page);
  ids.forEach((id, i) => {
    expect(after.positions[fid]?.[id]?.x ?? 0).toBeCloseTo((start[i]?.x ?? 0) + 2, 0);
    expect(after.positions[fid]?.[id]?.y ?? 0).toBeCloseTo((start[i]?.y ?? 0) - 3, 0);
  });
});

test('whole-show path toggle shows without crashing', async ({ page }) => {
  await page.getByText('Add performer').click();
  await page.getByText('Add formation').click();
  await page.getByText('Dancer 1').first().click();
  await page.getByLabel('Show whole-show path').check();
  await expect(page.getByLabel('Show whole-show path')).toBeChecked();
  await expect(page.getByLabel('Stage canvas')).toBeVisible();
});

test('count segments anchor count 1 away from 0:00', async ({ page }) => {
  // BPM and count segments live in the (non-modal) Beats dialog now.
  await page.getByRole('button', { name: 'Beats…' }).click();
  await page.locator('#stage-bpm').fill('120');
  // Default (no segments): counting runs from 0:00.
  await expect(page.getByLabel('Playhead time')).toContainText('8ct 1 · 1');

  // Add a segment at the playhead (0), then move its start to 2s.
  await page.getByRole('button', { name: 'Add count segment' }).click();
  await page.getByLabel('Count segment 1 start (s)').fill('2');
  // 0:00 is now an uncounted moment.
  await expect(page.getByLabel('Playhead time')).not.toContainText('8ct');

  // Step the playhead to exactly 2s (4 x 500ms): count 1 lands there.
  await page.getByLabel('Playhead position').click({ position: { x: 1, y: 100 } });
  await page.getByLabel('Playhead position').press('ArrowRight');
  await page.getByLabel('Playhead position').press('ArrowRight');
  await page.getByLabel('Playhead position').press('ArrowRight');
  await page.getByLabel('Playhead position').press('ArrowRight');
  await expect(page.getByLabel('Playhead time')).toContainText('8ct 1 · 1');

  // Removing the segment restores the default.
  await page.getByLabel('Remove count segment 1').click();
  await expect(page.getByLabel('Playhead time')).toContainText('8ct 1 · 5');
});

test('tap tempo calibrates BPM from clicks', async ({ page }) => {
  await page.getByRole('button', { name: 'Beats…' }).click();
  await page.getByRole('button', { name: 'Calibrate BPM' }).click(); // first tap = the downbeat
  for (let i = 0; i < 7; i++) {
    await page.waitForTimeout(500); // ~120 BPM target
    await page.getByRole('button', { name: /Tap \d+/ }).click();
  }
  // Suggestion only — the BPM field is untouched until the user applies it.
  await expect(page.locator('#stage-bpm')).toHaveValue('');
  const useButton = page.getByRole('button', { name: /Use \d+/ });
  await useButton.click();
  const value = Number(await page.locator('#stage-bpm').inputValue());
  // Timer jitter slows the taps a little; accept a band around 120.
  expect(value).toBeGreaterThanOrEqual(90);
  expect(value).toBeLessThanOrEqual(125);
});

test('language switcher persists across reloads', async ({ page }) => {
  // The locale picker lives in the Preferences dialog (⚙) now; find it by
  // its zh option since the label text is locale-dependent.
  await page.getByRole('button', { name: 'Preferences' }).click();
  const pickerSelector = page.locator('dialog select', {
    has: page.locator('option[value="zh"]'),
  });
  await expect(pickerSelector).toHaveValue('en');
  await pickerSelector.selectOption('zh');
  await expect(pickerSelector).toHaveValue('zh');
  await page.reload();
  await page.getByRole('button', { name: '偏好設定' }).click();
  await expect(
    page.locator('dialog select', { has: page.locator('option[value="zh"]') }),
  ).toHaveValue('zh');
});

test('video export records the show and downloads a movie', async ({ page }) => {
  test.setTimeout(60_000); // realtime capture: the default doc is an 8s show
  await page.getByText('Add performer').click();

  await page.getByRole('button', { name: 'Export…' }).click();
  await page.getByRole('button', { name: 'Video', exact: true }).click();
  const downloadPromise = page.waitForEvent('download', { timeout: 45_000 });
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  // While recording, the button turns into a cancel + progress readout.
  await expect(page.getByRole('button', { name: /Cancel \d+%/ })).toBeVisible();

  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/-preview\.(webm|mp4)$/);
  const filePath = await download.path();
  expect((await stat(filePath)).size).toBeGreaterThan(10_000);
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeVisible();
});

test('video export can composite the reference video picture-in-picture', async ({ page }) => {
  test.setTimeout(60_000); // realtime capture of the default 8s show
  await page.getByText('Add performer').click();
  await page.getByLabel('Reference video file').setInputFiles({
    name: 'ref.webm',
    mimeType: 'video/webm',
    buffer: await recordTestWebm(page),
  });
  await expect(page.getByLabel('Reference video', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Export…' }).click();
  // The option only exists because a reference video is loaded.
  await page
    .getByLabel('How the reference video appears in the exported movie')
    .selectOption('pip');
  const downloadPromise = page.waitForEvent('download', { timeout: 45_000 });
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/-preview\.(webm|mp4)$/);
  expect((await stat(await download.path())).size).toBeGreaterThan(10_000);
});

test('3D video export records the perspective view', async ({ page }) => {
  test.setTimeout(60_000);
  await page.getByText('Add performer').click();
  await page.getByRole('button', { name: 'Export…' }).click();
  await page.getByLabel('Video export view (2D or 3D)').selectOption('3d');

  const downloadPromise = page.waitForEvent('download', { timeout: 45_000 });
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/-3d\.(webm|mp4)$/);
  expect((await stat(await download.path())).size).toBeGreaterThan(10_000);
});

test('Delete key removes the selected performer, then the formation', async ({ page }) => {
  await page.getByText('Add performer').click();
  await page.getByText('Add performer').click(); // Dancer 2 stays selected
  let doc = await readDoc(page);
  expect(doc.performers).toHaveLength(2);

  await page.keyboard.press('Delete');
  doc = await readDoc(page);
  expect(doc.performers).toHaveLength(1);

  // No performer selected now — Delete removes the selected formation.
  await page.getByText('Add formation').click();
  doc = await readDoc(page);
  expect(doc.formations).toHaveLength(2);
  await page.keyboard.press('Delete');
  doc = await readDoc(page);
  expect(doc.formations).toHaveLength(1);
});

test('Ctrl+C / Ctrl+V copies positions across formations', async ({ page }) => {
  await page.getByText('Add performer').click();
  const drag = async (fx: number, fy: number, tx: number, ty: number): Promise<void> => {
    const from = meterToPx(fx, fy);
    const to = meterToPx(tx, ty);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
  };
  await drag(1.5, 6.5, 9, 2); // dancer ends up selected
  await page.keyboard.press('Control+c');

  await page.getByText('Add formation').click(); // F2 copies F1
  await drag(9, 2, 3, 5); // move them somewhere else in F2
  await page.keyboard.press('Control+v'); // paste restores the copied spot

  const doc = await readDoc(page);
  const f2 = doc.formations.find((f) => f.orderIndex === 1)?.id ?? '';
  const pid = doc.performers[0]?.id ?? '';
  expect(doc.positions[f2]?.[pid]?.x).toBeCloseTo(9, 1);
  expect(doc.positions[f2]?.[pid]?.y).toBeCloseTo(2, 1);
});

test('Ctrl+D duplicates the selected formation after itself', async ({ page }) => {
  await page.keyboard.press('Control+d');
  const doc = await readDoc(page);
  expect(doc.formations).toHaveLength(2);
  // 0ms start + 8s hold + 4s default transition.
  expect(doc.formations.find((f) => f.orderIndex === 1)?.startTimeMs).toBe(12_000);
});

test('audience side is selectable and persists in the doc', async ({ page }) => {
  await page.getByRole('button', { name: 'Stage settings…' }).click();
  await page.getByLabel('Audience side').selectOption('top');
  const doc = await readDoc(page);
  expect((doc.performance as { audienceAt?: string }).audienceAt).toBe('top');
});

test('formation suggestions: apply changes positions, undo restores', async ({ page }) => {
  await page.getByText('Add performer').click();
  await page.getByText('Add performer').click();
  await page.getByText('Add performer').click();
  // Deselect so the Formation panel (with Suggest) is visible.
  await page.getByLabel('Stage canvas').click({ position: { x: 10, y: 10 } });

  const before = await readDoc(page);
  const fid = before.formations[0]?.id ?? '';

  await page.getByRole('button', { name: 'Suggest formations' }).click();
  await page
    .getByLabel('Formation suggestions')
    .getByRole('button', { name: 'Apply' })
    .first()
    .click();

  const after = await readDoc(page);
  expect(after.positions[fid]).not.toEqual(before.positions[fid]);

  await page.keyboard.press('Control+z');
  const undone = await readDoc(page);
  expect(undone.positions[fid]).toEqual(before.positions[fid]);
});

test('PDF export with Chinese names embeds the CJK font and downloads', async ({ page }) => {
  await page.getByLabel('Performance title').fill('春季舞展');
  await page.getByText('Add performer').click();
  await page.getByLabel('Name', { exact: true }).fill('陳小明');

  await page.getByRole('button', { name: 'Export…' }).click();
  await page.getByRole('button', { name: 'PDF · Personal sheets' }).click();
  const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('walk-sheets.pdf');
  // Embedded font makes a CJK sheet much bigger than the empty-doc PDF.
  expect((await stat(await download.path())).size).toBeGreaterThan(100_000);
});

test('performer groups: tag two dancers, one click selects the group', async ({ page }) => {
  await page.getByText('Add performer').click();
  await page.getByText('Add performer').click();
  await page.getByText('Add performer').click();

  // Tag dancers 1 and 2 as "front"; dancer 3 stays ungrouped.
  await page.getByText('Dancer 1').first().click();
  await page.getByLabel('Groups (comma separated)').fill('front');
  await page.getByLabel('Groups (comma separated)').press('Enter');
  await page.getByText('Dancer 2').first().click();
  await page.getByLabel('Groups (comma separated)').fill('front, flyers');
  await page.getByLabel('Groups (comma separated)').press('Enter');

  const doc = await readDoc(page);
  expect((doc.performers[0] as { tags?: string[] }).tags).toEqual(['front']);
  expect((doc.performers[1] as { tags?: string[] }).tags).toEqual(['front', 'flyers']);

  await page.getByRole('button', { name: 'Select group front' }).click();
  const rows = page.getByRole('listbox', { name: 'Performers' }).getByRole('option');
  await expect(rows.nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(rows.nth(2)).toHaveAttribute('aria-selected', 'false');
});

test('stage background image uploads, persists and can be removed', async ({ page }) => {
  // 1x1 PNG — enough to exercise decode, IndexedDB persistence and reload.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  await page.getByRole('button', { name: 'Stage settings…' }).click();
  await page.setInputFiles('input[aria-label="Background image file"]', {
    name: 'venue.png',
    mimeType: 'image/png',
    buffer: png,
  });
  await expect(page.getByRole('button', { name: 'Replace image' })).toBeVisible();
  await expect(page.getByLabel('Background image opacity')).toBeVisible();

  await page.reload();
  await page.getByText('Add performer').waitFor();
  await page.getByRole('button', { name: 'Stage settings…' }).click();
  await expect(page.getByRole('button', { name: 'Replace image' })).toBeVisible();

  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Upload image' })).toBeVisible();
});

test('props: add, edit, drag, persist and delete', async ({ page }) => {
  await page.getByRole('button', { name: 'Labelled objects' }).click();
  await expect(page.locator('#prop-name')).toHaveValue('Prop 1');

  // rename + resize via the prop panel
  await page.locator('#prop-name').fill('Box');
  await page.locator('#prop-width').fill('3');

  // drag the prop from center stage (6,4) to (3,2)
  const from = meterToPx(6, 4);
  const to = meterToPx(3, 2);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();

  const state = await readDoc(page);
  const props = (state as unknown as { props: { id: string; name: string; width: number }[] })
    .props;
  expect(props).toHaveLength(1);
  expect(props[0]?.name).toBe('Box');
  expect(props[0]?.width).toBe(3);
  const fid = state.formations[0]?.id ?? '';
  const pos = state.positions[fid]?.[props[0]?.id ?? ''];
  expect(Math.abs((pos?.x ?? 0) - 3)).toBeLessThan(0.3);
  expect(Math.abs((pos?.y ?? 0) - 2)).toBeLessThan(0.3);

  await page.reload();
  await page.getByText('Add performer').waitFor();
  await expect(page.getByRole('option', { name: 'Box' })).toBeVisible();

  // select the prop in the list, Delete key removes it
  await page.getByRole('option', { name: 'Box' }).click();
  await page.keyboard.press('Delete');
  await expect(page.getByRole('option', { name: 'Box' })).toBeHidden();
});

test('crews: save the cast, load it into a fresh choreography with groups', async ({ page }) => {
  await page.getByText('Add performer').click();
  await page.getByText('Add performer').click();
  // tag Dancer 1 so we can check groups survive the crew round-trip
  await page.getByText('Dancer 1').first().click();
  await page.getByLabel('Groups (comma separated)').fill('front row');
  await page.getByLabel('Groups (comma separated)').blur();

  page.once('dialog', (dialog) => void dialog.accept('Team 2026'));
  await page.getByRole('button', { name: 'Save cast as crew' }).click();
  await expect(page.getByText('Team 2026 · 2')).toBeVisible();

  // fresh choreography, then load the crew into it
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'New choreography' }).click();
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('listbox', { name: 'Performers' }).getByRole('option')).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'Load crew Team 2026' }).click();
  await expect(page.getByRole('listbox', { name: 'Performers' }).getByRole('option')).toHaveCount(
    2,
  );
  // the group chip came along
  await expect(page.getByRole('button', { name: 'Select group front row' })).toBeVisible();

  // delete the crew
  await page.getByRole('button', { name: 'Delete crew Team 2026' }).click();
  await expect(page.getByText('Team 2026 · 2')).toBeHidden();
});

test('formation presets: save current shape, apply it in a new formation', async ({ page }) => {
  await page.getByText('Add performer').click();
  await page.getByText('Add performer').click();
  // deterministic spots via the X/Y inputs
  await page.getByText('Dancer 1').first().click();
  await page.locator('#pos-x').fill('3');
  await page.locator('#pos-y').fill('2');
  await page.getByText('Dancer 2').first().click();
  await page.locator('#pos-x').fill('9');
  await page.locator('#pos-y').fill('2');
  await page.getByLabel('Stage canvas').click({ position: { x: 10, y: 10 } }); // formation panel

  page.once('dialog', (dialog) => void dialog.accept('Duo line'));
  await page.getByRole('button', { name: 'Save this formation' }).click();
  await expect(page.getByLabel('Formation preset')).toContainText('Duo line · 2');

  // scramble the current formation, then apply the preset back
  await page.getByRole('button', { name: 'Mirror left–right' }).click();
  await page.getByLabel('Formation preset').selectOption({ label: 'Duo line · 2' });
  await page
    .getByTitle('Arrange everyone into this preset, walking as little as possible (undoable)')
    .click();

  const state = await readDoc(page);
  const fid = state.formations[0]?.id ?? '';
  const xs = state.performers
    .map((p) => state.positions[fid]?.[p.id]?.x ?? NaN)
    .sort((a, b) => a - b);
  expect(Math.abs((xs[0] ?? 0) - 3)).toBeLessThan(0.05);
  expect(Math.abs((xs[1] ?? 0) - 9)).toBeLessThan(0.05);
});

test('grid snap: dragged performer lands on the 0.5m lattice', async ({ page }) => {
  await page.getByText('Add performer').click();
  await page.getByRole('button', { name: 'Snap', exact: true }).click();

  // drag Dancer 1 from its default spot (1.5, 6.5) to roughly (5.7, 3.2)
  const from = meterToPx(1.5, 6.5);
  const to = meterToPx(5.7, 3.2);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();

  const state = await readDoc(page);
  const fid = state.formations[0]?.id ?? '';
  const pid = state.performers[0]?.id ?? '';
  const pos = state.positions[fid]?.[pid];
  expect(pos).toBeDefined();
  // snapped: both coordinates are exact multiples of 0.5m
  expect(((pos?.x ?? 0) * 2) % 1).toBeCloseTo(0, 5);
  expect(((pos?.y ?? 0) * 2) % 1).toBeCloseTo(0, 5);
  expect(Math.abs((pos?.x ?? 0) - 5.5)).toBeLessThanOrEqual(0.5);
  expect(Math.abs((pos?.y ?? 0) - 3)).toBeLessThanOrEqual(0.5);
});

test('metronome toggle needs a BPM and latches on', async ({ page }) => {
  const metro = page.getByRole('button', { name: 'Click', exact: true });
  await expect(metro).toBeDisabled();
  await page.getByRole('button', { name: 'Beats…' }).click();
  await page.getByLabel('BPM (empty = unknown)').fill('120');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(metro).toBeEnabled();
  await metro.click();
  await expect(metro).toHaveAttribute('aria-pressed', 'true');
});

test('PWA manifest, service worker and icons are served', async ({ request }) => {
  const manifest = await request.get('/manifest.webmanifest');
  expect(manifest.ok()).toBeTruthy();
  expect(((await manifest.json()) as { name: string }).name).toBe('GridStage');
  expect((await request.get('/sw.js')).ok()).toBeTruthy();
  expect((await request.get('/icons/icon-192.png')).ok()).toBeTruthy();
  expect((await request.get('/icons/icon-512.png')).ok()).toBeTruthy();
});

test.describe('touch', () => {
  test.use({ hasTouch: true });

  test('tapping a performer on the canvas selects it', async ({ page }) => {
    await page.getByText('Add performer').click();
    // deselect (adding auto-selects), then tap the mark at its default spot;
    // x>14 clears the panel resizer, widened for coarse pointers
    await page.getByLabel('Stage canvas').click({ position: { x: 24, y: 10 } });
    await expect(page.getByLabel('Facing degrees')).toBeHidden();
    const at = meterToPx(1.5, 6.5);
    await page.touchscreen.tap(at.x, at.y);
    await expect(page.getByLabel('Facing degrees')).toBeVisible();
  });
});

test('library: create, switch, duplicate and delete choreographies', async ({ page }) => {
  await page.getByLabel('Performance title').fill('Show A');
  await page.getByText('Add performer').click();
  await page.setInputFiles('input[aria-label="Audio file"]', {
    name: 'tone.wav',
    mimeType: 'audio/wav',
    buffer: makeWav(),
  });
  await page.getByText('Replace audio').waitFor();

  // start a second choreography from the library
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'New choreography' }).click();
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByLabel('Performance title')).toHaveValue('Untitled performance');
  await page.getByLabel('Performance title').fill('Show B');
  // audio belongs to Show A, not to the fresh doc
  await expect(page.getByText('Upload audio')).toBeVisible();

  // reload keeps the OPEN doc (Show B), not the first one
  await page.reload();
  await page.getByText('Add performer').waitFor();
  await expect(page.getByLabel('Performance title')).toHaveValue('Show B');

  // duplicate Show A, then delete the copy (confirm dialog accepted)
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'Duplicate Show A', exact: true }).click();
  await expect(page.getByText('Show A (copy)')).toBeVisible();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Delete Show A (copy)' }).click();
  await expect(page.getByText('Show A (copy)')).toBeHidden();

  // switch back to Show A — its performer and its audio are still there
  await page.getByRole('button', { name: 'Open Show A', exact: true }).click();
  await expect(page.getByLabel('Performance title')).toHaveValue('Show A');
  await expect(page.getByRole('listbox', { name: 'Performers' }).getByRole('option')).toHaveCount(
    1,
  );
  await expect(page.getByText('Replace audio')).toBeVisible();
});

test('annotations: pen stroke and text pin, stored per formation', async ({ page }) => {
  // draw a stroke
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  const from = meterToPx(3, 3);
  const to = meterToPx(7, 5);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();

  // drop a text pin
  await page.getByRole('button', { name: 'Note', exact: true }).click();
  page.once('dialog', (dialog) => void dialog.accept('watch spacing'));
  const pinAt = meterToPx(9, 2);
  await page.mouse.click(pinAt.x, pinAt.y);

  type DocAnnotations = { annotations: { kind: string; text?: string; points?: number[] }[] };
  let state = (await readDoc(page)) as unknown as DocAnnotations;
  expect(state.annotations).toHaveLength(2);
  expect(state.annotations[0]?.kind).toBe('stroke');
  expect((state.annotations[0]?.points ?? []).length).toBeGreaterThanOrEqual(4);
  expect(state.annotations[1]?.text).toBe('watch spacing');

  // still in Note mode: clicking the pin erases it
  await page.mouse.click(pinAt.x, pinAt.y);
  state = (await readDoc(page)) as unknown as DocAnnotations;
  expect(state.annotations).toHaveLength(1);

  // a new formation shows no notes from the first one (undo-able data)
  await page.getByRole('button', { name: 'Note', exact: true }).click(); // off
  await page.getByText('Add formation').click();
  state = (await readDoc(page)) as unknown as DocAnnotations;
  expect(state.annotations).toHaveLength(1); // still stored, on formation 1 only
});

test('wings: dancers can be placed offstage once wings exist', async ({ page }) => {
  await page.getByText('Add performer').click();
  // no wings yet: offstage x clamps back to 0
  await page.getByText('Dancer 1').first().click();
  await page.locator('#pos-x').fill('-2');
  let state = await readDoc(page);
  const fid = state.formations[0]?.id ?? '';
  const pid = state.performers[0]?.id ?? '';
  expect(state.positions[fid]?.[pid]?.x).toBe(0);

  // open a 2m left wing, then the same position sticks
  await page.getByRole('button', { name: 'Stage settings…' }).click();
  await page.locator('#wing-left').fill('2');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('#pos-x').fill('-1.5');
  state = await readDoc(page);
  expect(state.positions[fid]?.[pid]?.x).toBe(-1.5);

  // shrinking the wing pulls the dancer back inside the new bounds
  await page.getByRole('button', { name: 'Stage settings…' }).click();
  await page.locator('#wing-left').fill('0.5');
  state = await readDoc(page);
  expect(state.positions[fid]?.[pid]?.x).toBe(-0.5);
});

test('transition analyzer warns about head-on swaps', async ({ page }) => {
  await page.getByText('Add performer').click();
  await page.getByText('Add performer').click();
  // formation 1: deterministic spots on one line
  await page.getByText('Dancer 1').first().click();
  await page.locator('#pos-x').fill('2');
  await page.locator('#pos-y').fill('4');
  await page.getByText('Dancer 2').first().click();
  await page.locator('#pos-x').fill('10');
  await page.locator('#pos-y').fill('4');
  // formation 2: swap them -> they meet in the middle
  await page.getByText('Add formation').click();
  await page.getByText('Dancer 1').first().click();
  await page.locator('#pos-x').fill('10');
  await page.getByText('Dancer 2').first().click();
  await page.locator('#pos-x').fill('2');
  await page.getByLabel('Stage canvas').click({ position: { x: 10, y: 10 } });

  const warnings = page.getByLabel('Transition warnings');
  await expect(warnings).toContainText('nearly collide');

  // untangling the swap clears the warning
  await page.getByRole('button', { name: 'Untangle from previous' }).click();
  await expect(warnings).toBeHidden();
});

test('rehearsal pack PDF combines charts and personal sheets', async ({ page }) => {
  await page.getByText('Add performer').click();
  await page.getByText('Add performer').click();
  await page.getByText('Add formation').click();
  await page.getByRole('button', { name: 'Export…' }).click();
  await page.getByRole('button', { name: 'PDF · Rehearsal pack' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/-rehearsal-pack\.pdf$/);
  // roster + 2 charts + 2 sheets — comfortably bigger than a bare one-pager
  expect((await stat(await download.path())).size).toBeGreaterThan(8_000);
});

test('PNG snapshot of the selected formation downloads', async ({ page }) => {
  await page.getByText('Add performer').click();
  await page.getByRole('button', { name: 'Export…' }).click();
  await page.getByRole('button', { name: 'PNG · Formation snapshot' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/-formation-1\.png$/);
  expect((await stat(await download.path())).size).toBeGreaterThan(5_000);
});

test('phone layout: side panels become drawers behind edge tabs', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const castPanel = page.locator('.cast-panel');
  const castTab = page.getByRole('button', { name: 'Cast', exact: true });

  // Desktop resize handles are gone; panels start off-canvas.
  await expect(castTab).toBeVisible();
  await expect(page.locator('.panel-resize')).toHaveCount(0);
  await expect(castPanel).toBeHidden();

  await castTab.click();
  await expect(castPanel).toBeVisible();
  await page.getByText('Add performer').click();
  await expect(castPanel).toContainText('Dancer 1');

  // Tapping the dimmed strip right of the drawer closes it (the drawer
  // itself covers the backdrop's center, so aim for the visible part).
  await page
    .getByRole('button', { name: 'Close side panel' })
    .click({ position: { x: 370, y: 300 } });
  await expect(castPanel).toBeHidden();

  // Growing the window back restores the three-column layout.
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(castTab).toBeHidden();
  await expect(castPanel).toBeVisible();
  await expect(page.locator('.panel-resize')).toHaveCount(3);
});

test('topbar buttons stay inside a wide viewport', async ({ page }) => {
  // Regression (v0.6.0–v0.8.0): the global input[type=text] width:100% beat
  // .topbar-title's 200px, and flex-shrink:0 then pushed every button after
  // the title off-screen. Click-based tests missed it because Playwright
  // scrolls the target into view first — so assert geometry, not clicks.
  const viewport = page.viewportSize();
  if (viewport === null) throw new Error('viewport size unset');
  for (const name of ['Library', 'Export…']) {
    const box = await page.getByRole('button', { name, exact: true }).boundingBox();
    if (box === null) throw new Error(`${name} button not rendered`);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  }
});

test('understudy: unchecking "Performing this run" hides the dancer everywhere', async ({
  page,
}) => {
  await page.getByText('Add performer').click();
  await page.getByText('Add performer').click();
  // Dancer 2 goes on the bench.
  await page.getByText('Dancer 2').first().click();
  await page.getByRole('checkbox', { name: 'Performing this run' }).uncheck();

  // Cast keeps the row (marked absent); the stage canvas hides the mark.
  await expect(page.getByText('absent')).toBeVisible();
  const marks = page.getByLabel('Stage canvas').locator('canvas').first();
  await expect(marks).toBeVisible();
  // The whole-cast select-all only drags one visible mark now: verify via
  // the persisted doc that the flag landed, and via re-check restoring it.
  const doc = await readDoc(page);
  const benched = doc.performers.find((p) => p.name === 'Dancer 2');
  expect((benched as { active?: boolean } | undefined)?.active).toBe(false);

  await page.getByRole('checkbox', { name: 'Performing this run' }).check();
  await expect(page.getByText('absent')).toBeHidden();
});

test('comment resolve tucks the note into a Resolved fold', async ({ page }) => {
  await page.getByText('Add formation').click();
  await page.getByLabel('New comment').fill('watch the spacing here');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('watch the spacing here')).toBeVisible();

  await page.getByRole('button', { name: /^Resolve comment/ }).click();
  // Now lives under the fold, hidden until opened.
  await expect(page.getByText('watch the spacing here')).toBeHidden();
  await page.getByText('Resolved (1)').click();
  await expect(page.getByText('watch the spacing here')).toBeVisible();
  await page.getByRole('button', { name: /^Reopen comment/ }).click();
  await expect(page.getByText('Resolved (1)')).toBeHidden();
});

test('GIF export downloads an animated gif', async ({ page }) => {
  // Offline quantization is CPU-bound — slow CI runners need extra room,
  // and the fresh doc's single 8s formation keeps the frame count small.
  test.setTimeout(180_000);
  await page.getByText('Add performer').click();
  await page.getByRole('button', { name: 'Export…' }).click();
  await page.getByRole('button', { name: 'GIF', exact: true }).click();
  const downloadPromise = page.waitForEvent('download', { timeout: 150_000 });
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.gif$/);
  expect((await stat(await download.path())).size).toBeGreaterThan(20_000);
});

test('walk charts PDF includes rehearsal annotations', async ({ page }) => {
  await page.getByText('Add performer').click();
  await page.getByText('Add formation').click();
  // A pen stroke and a labeled pin, straight into the store.
  await page.evaluate(async () => {
    const storePath = '/src/state/store.ts';
    const { useEditor } = (await import(storePath)) as {
      useEditor: {
        getState: () => {
          selectedFormationId: string;
          addAnnotation: (a: {
            formationId: string;
            kind: 'stroke' | 'pin';
            color: string;
            points?: number[];
            x?: number;
            y?: number;
            text?: string;
          }) => void;
        };
      };
    };
    const s = useEditor.getState();
    s.addAnnotation({
      formationId: s.selectedFormationId,
      kind: 'stroke',
      color: '#e05252',
      points: [1, 1, 3, 2, 5, 1.5],
    });
    s.addAnnotation({
      formationId: s.selectedFormationId,
      kind: 'pin',
      color: '#5b8ff0',
      x: 6,
      y: 4,
      text: 'watch spacing',
    });
  });
  await page.getByRole('button', { name: 'Export…' }).click();
  await page.getByRole('button', { name: 'PDF · Walk charts' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/-walk-charts\.pdf$/);
  expect((await stat(await download.path())).size).toBeGreaterThan(3_000);
});

test('rehearsal review reports drift, C-spot and symmetry for a paused frame', async ({ page }) => {
  await page.getByText('Add performer').click();
  await page.getByText('Add performer').click();
  // Plan: Dancer 1 at (3,4), Dancer 2 at (9,6).
  await page.getByText('Dancer 1').first().click();
  await page.locator('#pos-x').fill('3');
  await page.locator('#pos-y').fill('4');
  await page.getByText('Dancer 2').first().click();
  await page.locator('#pos-x').fill('9');
  await page.locator('#pos-y').fill('6');

  await page.getByLabel('Reference video file').setInputFiles({
    name: 'ref.webm',
    mimeType: 'video/webm',
    buffer: await recordTestWebm(page),
  });
  await expect(page.getByLabel('Reference video', { exact: true })).toBeVisible();

  // Full-frame calibration (linear px->m) + detector stub: feet land at
  // (3.5, 4) and (9, 6) — Dancer 1 drifted 0.5m stage-right, Dancer 2 exact.
  await page.evaluate(async () => {
    const refVideoPath = '/src/state/refVideo.ts';
    const detectorPath = '/src/vision/detector.ts';
    const refVideo = (await import(refVideoPath)) as {
      useRefVideo: { getState: () => { setCorners: (c: { x: number; y: number }[]) => void } };
    };
    refVideo.useRefVideo.getState().setCorners([
      { x: 0, y: 0 },
      { x: 160, y: 0 },
      { x: 160, y: 120 },
      { x: 0, y: 120 },
    ]);
    const detector = (await import(detectorPath)) as {
      setDetectorOverride: (
        fn: () => Promise<{ x: number; y: number; width: number; height: number; score: number }[]>,
      ) => void;
    };
    detector.setDetectorOverride(() =>
      Promise.resolve([
        { x: 36.67, y: 20, width: 20, height: 40, score: 0.9 },
        { x: 110, y: 50, width: 20, height: 40, score: 0.85 },
      ]),
    );
  });

  // Designate Dancer 1 as the C-spot by selecting exactly that dancer.
  await page.getByText('Dancer 1').first().click();
  await page.getByRole('button', { name: 'Review', exact: true }).click();

  await expect(page.getByText(/Rehearsal check @/)).toBeVisible();
  await expect(page.getByText(/Average drift from the chart: 0\.25m/)).toBeVisible();
  await expect(page.getByText(/C-spot Dancer 1: 2\.50m left of the center line/)).toBeVisible();
  await expect(page.getByText(/Left–right asymmetry/)).toBeVisible();
  await expect(page.getByText(/Dancer 1 0\.50m/)).toBeVisible();
});
