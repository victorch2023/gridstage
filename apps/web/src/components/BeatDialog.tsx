import { useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { useEditor } from '../state/store';
import { showEndMs } from '../state/interpolate';
import { audioDurationMs } from '../audio/audioPlayer';
import { appendTap, bpmFromTaps, MIN_TAPS_TO_APPLY } from '../audio/tapTempo';
import { useT } from '../i18n';
import { SHOW_BEATS } from '../parkedFeatures';

/** Parse a number input, returning null for empty/invalid text. */
function num(value: string): number | null {
  const n = Number(value);
  return value.trim() === '' || Number.isNaN(n) ? null : n;
}

/**
 * Music & beats: BPM, tap-tempo calibration and count segments, opened from
 * the timeline toolbar. Deliberately NON-modal (dialog.show()): you tap the
 * tempo while the music plays and stamp segment bounds from the moving
 * playhead, so the page behind must stay interactive.
 */
export function BeatDialog(): ReactElement | null {
  const t = useT();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const performance = useEditor((s) => s.performance);
  const setBpm = useEditor((s) => s.setBpm);
  const addCountSegment = useEditor((s) => s.addCountSegment);
  const updateCountSegment = useEditor((s) => s.updateCountSegment);
  const removeCountSegment = useEditor((s) => s.removeCountSegment);

  const onAddCountSegment = (): void => {
    // Playhead read on click only — subscribing would re-render every frame.
    const s = useEditor.getState();
    const startMs = s.playheadMs;
    const endMs = Math.max(showEndMs(s.formations), audioDurationMs(), startMs + 8000);
    addCountSegment(startMs, endMs);
  };

  // Tap-tempo calibration: the button is the tap target; Date.now() because
  // the local `performance` above shadows window.performance here.
  const [taps, setTaps] = useState<number[]>([]);
  const liveBpm = bpmFromTaps(taps);
  const onTap = (): void => setTaps((prev) => appendTap(prev, Date.now()));

  if (!SHOW_BEATS) return null;

  return (
    <>
      <button type="button" className="btn edit-only" onClick={() => dialogRef.current?.show()}>
        {t.beat.open}
      </button>
      <dialog ref={dialogRef} className="export-dialog beat-dialog" aria-label={t.beat.title}>
        <div className="export-dialog-head">
          <span className="panel-title" style={{ margin: 0 }}>
            {t.beat.title}
          </span>
          <button type="button" className="btn" onClick={() => dialogRef.current?.close()}>
            {t.beat.close}
          </button>
        </div>
        <div className="dialog-fields">
          <div className="field">
            <label htmlFor="stage-bpm">{t.stage.bpm}</label>
            <input
              id="stage-bpm"
              type="number"
              min={20}
              max={300}
              value={performance.bpm ?? ''}
              onChange={(e) => setBpm(num(e.target.value))}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn edit-only"
              title={t.stage.calibrateBpmTitle}
              onClick={onTap}
            >
              {taps.length === 0 ? t.stage.calibrateBpm : t.stage.tapLabel(taps.length)}
            </button>
            {taps.length > 0 && (
              <>
                <span className="mono" role="status">
                  {liveBpm !== null ? `≈ ${Math.round(liveBpm)} BPM` : t.stage.tapHint}
                </span>
                {liveBpm !== null && taps.length >= MIN_TAPS_TO_APPLY && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      setBpm(Math.round(liveBpm));
                      setTaps([]);
                    }}
                  >
                    {t.stage.applyBpm(Math.round(liveBpm))}
                  </button>
                )}
                <button type="button" className="btn" onClick={() => setTaps([])}>
                  {t.stage.resetTap}
                </button>
              </>
            )}
          </div>
          <div className="field">
            <span className="field-label">{t.stage.countSegments}</span>
            {performance.countSegments.length === 0 && (
              <span className="mono">{t.stage.countSegmentsNote}</span>
            )}
            {performance.countSegments.map((seg, i) => (
              <div key={seg.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  type="number"
                  aria-label={t.stage.segStartAria(i + 1)}
                  min={0}
                  step={0.1}
                  style={{ flex: 1 }}
                  value={Number((seg.startMs / 1000).toFixed(1))}
                  onChange={(e) => {
                    const v = num(e.target.value);
                    if (v !== null) updateCountSegment(seg.id, { startMs: v * 1000 });
                  }}
                />
                <button
                  type="button"
                  className="btn"
                  title={t.stage.segAtPlayheadTitle}
                  onClick={() =>
                    updateCountSegment(seg.id, { startMs: useEditor.getState().playheadMs })
                  }
                >
                  @
                </button>
                <span className="mono">–</span>
                <input
                  type="number"
                  aria-label={t.stage.segEndAria(i + 1)}
                  min={0}
                  step={0.1}
                  style={{ flex: 1 }}
                  value={Number((seg.endMs / 1000).toFixed(1))}
                  onChange={(e) => {
                    const v = num(e.target.value);
                    if (v !== null) updateCountSegment(seg.id, { endMs: v * 1000 });
                  }}
                />
                <button
                  type="button"
                  className="btn"
                  title={t.stage.segAtPlayheadTitle}
                  onClick={() =>
                    updateCountSegment(seg.id, { endMs: useEditor.getState().playheadMs })
                  }
                >
                  @
                </button>
                <button
                  type="button"
                  className="comment-delete"
                  aria-label={t.stage.removeSegmentAria(i + 1)}
                  onClick={() => removeCountSegment(seg.id)}
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn edit-only"
              title={t.stage.addCountSegmentTitle}
              onClick={onAddCountSegment}
            >
              {t.stage.addCountSegment}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
