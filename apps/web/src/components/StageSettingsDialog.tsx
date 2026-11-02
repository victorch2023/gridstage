import { useRef } from 'react';
import type { ReactElement } from 'react';
import { useEditor } from '../state/store';
import { useStageBackground } from '../state/stageBackground';
import { NumberField } from './NumberField';
import { useT } from '../i18n';

/**
 * Set-once-per-show stage settings (size, audience side, venue photo),
 * moved out of the always-visible panel into a dialog. Renders its own
 * trigger button.
 */
export function StageSettingsDialog(): ReactElement {
  const t = useT();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const performance = useEditor((s) => s.performance);
  const setStageSize = useEditor((s) => s.setStageSize);
  const setAudienceAt = useEditor((s) => s.setAudienceAt);
  const setWings = useEditor((s) => s.setWings);
  const wings = performance.wings ?? { left: 0, right: 0, back: 0 };
  const setStageBackgroundOpacity = useEditor((s) => s.setStageBackgroundOpacity);
  const backgroundImage = useStageBackground((s) => s.image);
  const setBackground = useStageBackground((s) => s.set);
  const clearBackground = useStageBackground((s) => s.clear);
  const backgroundFileRef = useRef<HTMLInputElement>(null);
  const fixtures = useEditor((s) => s.fixtures);
  const captions = useEditor((s) => s.captions);
  const addFixture = useEditor((s) => s.addFixture);
  const addCaption = useEditor((s) => s.addCaption);
  const updateFixture = useEditor((s) => s.updateFixture);
  const updateCaption = useEditor((s) => s.updateCaption);
  const removeFixture = useEditor((s) => s.removeFixture);
  const removeCaption = useEditor((s) => s.removeCaption);

  return (
    <>
      <button
        type="button"
        className="btn edit-only"
        onClick={() => dialogRef.current?.showModal()}
      >
        {t.stageSettings.open}
      </button>
      <dialog ref={dialogRef} className="export-dialog" aria-label={t.stageSettings.title}>
        <div className="export-dialog-head">
          <span className="panel-title" style={{ margin: 0 }}>
            {t.stageSettings.title}
          </span>
          <button type="button" className="btn" onClick={() => dialogRef.current?.close()}>
            {t.stageSettings.close}
          </button>
        </div>
        <div className="dialog-fields">
          <div style={{ display: 'flex', gap: 8 }}>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="stage-w">{t.stage.width}</label>
              <NumberField
                id="stage-w"
                min={2}
                max={60}
                value={performance.stageWidth}
                onCommit={(v) => setStageSize(v, performance.stageHeight)}
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="stage-h">{t.stage.depth}</label>
              <NumberField
                id="stage-h"
                min={2}
                max={60}
                value={performance.stageHeight}
                onCommit={(v) => setStageSize(performance.stageWidth, v)}
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="stage-audience">{t.stage.audiencePosition}</label>
            <select
              id="stage-audience"
              value={performance.audienceAt ?? 'bottom'}
              onChange={(e) => setAudienceAt(e.target.value === 'top' ? 'top' : 'bottom')}
            >
              <option value="bottom">{t.stage.audienceBottom}</option>
              <option value="top">{t.stage.audienceTop}</option>
            </select>
          </div>
          <div className="field">
            <label title={t.stage.wingsTitle}>{t.stage.wingsLabel}</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {(
                [
                  { key: 'left', label: t.stage.wingLeft },
                  { key: 'right', label: t.stage.wingRight },
                  { key: 'back', label: t.stage.wingBack },
                ] as const
              ).map(({ key, label }) => (
                <div className="field" style={{ flex: 1 }} key={key}>
                  <label htmlFor={`wing-${key}`}>{label}</label>
                  <NumberField
                    id={`wing-${key}`}
                    min={0}
                    max={10}
                    step={0.5}
                    value={wings[key]}
                    onCommit={(v) => setWings({ ...wings, [key]: v })}
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="field">
            <label>{t.stage.backgroundLabel}</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn edit-only"
                title={t.stage.backgroundTitle}
                onClick={() => backgroundFileRef.current?.click()}
              >
                {backgroundImage === null ? t.stage.backgroundUpload : t.stage.backgroundReplace}
              </button>
              {backgroundImage !== null && (
                <button
                  type="button"
                  className="btn edit-only"
                  onClick={() => void clearBackground(performance.id)}
                >
                  {t.stage.backgroundRemove}
                </button>
              )}
            </div>
            <input
              ref={backgroundFileRef}
              type="file"
              accept="image/*"
              aria-label={t.stage.backgroundFileAria}
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file !== undefined) void setBackground(performance.id, file);
                e.target.value = '';
              }}
            />
            {backgroundImage !== null && (
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                aria-label={t.stage.backgroundOpacityAria}
                value={performance.stageBackgroundOpacity ?? 0.5}
                onChange={(e) => setStageBackgroundOpacity(Number(e.target.value))}
              />
            )}
          </div>
          <div className="field">
            <label>{t.stageSettings.fixturesTitle}</label>
            <p className="empty-note">{t.stageSettings.fixturesHint}</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn edit-only" onClick={addFixture}>
                {t.stageSettings.addFixture}
              </button>
              <button type="button" className="btn edit-only" onClick={addCaption}>
                {t.stageSettings.addCaption}
              </button>
            </div>
            {fixtures.map((piece) => (
              <div key={piece.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <label className="field" style={{ flex: 1 }}>
                  {t.stageSettings.fixtureLabel}
                  <input
                    type="text"
                    value={piece.label}
                    onChange={(event) => updateFixture(piece.id, { label: event.target.value })}
                  />
                </label>
                <button
                  type="button"
                  className="btn edit-only"
                  onClick={() => removeFixture(piece.id)}
                >
                  {t.stageSettings.removePiece}
                </button>
              </div>
            ))}
            {captions.map((piece) => (
              <div key={piece.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <label className="field" style={{ flex: 1 }}>
                  {t.stageSettings.captionText}
                  <input
                    type="text"
                    value={piece.text}
                    onChange={(event) => updateCaption(piece.id, { text: event.target.value })}
                  />
                </label>
                <button
                  type="button"
                  className="btn edit-only"
                  onClick={() => removeCaption(piece.id)}
                >
                  {t.stageSettings.removePiece}
                </button>
              </div>
            ))}
          </div>
        </div>
      </dialog>
    </>
  );
}
