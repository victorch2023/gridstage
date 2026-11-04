import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { isPerformerActive } from '@gridstage/shared-types';
import { useEditor } from '../state/store';
import type { TemplateKind } from '../state/templates';
import { suggestFormations } from '../state/suggest';
import type { Suggestion } from '../state/suggest';
import { deleteSnapshot, listSnapshots, saveSnapshot } from '../state/history';
import {
  applyPresetToCast,
  deleteFormationPreset,
  listFormationPresets,
  saveFormationPreset,
} from '../state/formationPresets';
import type { FormationPreset } from '../state/formationPresets';
import type { Snapshot } from '../state/history';
import { CommentsSection } from './CommentsSection';
import { NumberField } from './NumberField';
import { ColorField } from './ColorField';
import { StageSettingsDialog } from './StageSettingsDialog';
import { useT } from '../i18n';
import { SHOW_FORMATION_ARRANGE } from '../parkedFeatures';
import { captionSize, fixtureShape, pieceRotation } from '../state/shapeEdit';
import { byOrder } from '../state/interpolate';
import { normalizeBadge } from '../state/badge';
import { analyzeTransition } from '@gridstage/path-planner';
import type { WalkPath } from '@gridstage/path-planner';

/** Parse a number input, returning null for empty/invalid text. */
function num(value: string): number | null {
  const n = Number(value);
  return value.trim() === '' || Number.isNaN(n) ? null : n;
}

/** "front, flyers" -> unique trimmed group names (CJK commas count too). */
function parseTags(text: string): string[] {
  return [...new Set(text.split(/[,，、]/).map((part) => part.trim()))].filter((tag) => tag !== '');
}

function PerformerSection(): ReactElement | null {
  const t = useT();
  const performers = useEditor((s) => s.performers);
  const selectedPerformerIds = useEditor((s) => s.selectedPerformerIds);
  const selectedFormationId = useEditor((s) => s.selectedFormationId);
  const positions = useEditor((s) => s.positions);
  const updatePerformer = useEditor((s) => s.updatePerformer);
  const removePerformer = useEditor((s) => s.removePerformer);
  const setPosition = useEditor((s) => s.setPosition);
  const setRotation = useEditor((s) => s.setRotation);
  const setMarker = useEditor((s) => s.setMarker);
  const pathPerformerId = useEditor((s) => s.pathPerformerId);
  const setPathPerformer = useEditor((s) => s.setPathPerformer);

  const performerId = selectedPerformerIds[0];
  if (performerId === undefined) return null;
  const performer = performers.find((p) => p.id === performerId);
  if (performer === undefined) return null;
  if (selectedPerformerIds.length > 1) {
    return <MultiSelectSection count={selectedPerformerIds.length} />;
  }
  const pos = positions[selectedFormationId]?.[performerId];

  return (
    <>
      <div className="panel-title">{t.performer.titleOne}</div>
      <div className="panel-section">
        <div className="field">
          <label htmlFor="perf-name">{t.performer.name}</label>
          <input
            id="perf-name"
            type="text"
            value={performer.name}
            onChange={(e) => updatePerformer(performer.id, { name: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="perf-role">{t.performer.role}</label>
          <input
            id="perf-role"
            type="text"
            value={performer.role}
            placeholder={t.performer.rolePlaceholder}
            onChange={(e) => updatePerformer(performer.id, { role: e.target.value })}
          />
        </div>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
          <input
            type="checkbox"
            checked={isPerformerActive(performer)}
            title={t.performer.activeTitle}
            onChange={(e) => updatePerformer(performer.id, { active: e.target.checked })}
          />
          {t.performer.activeLabel}
        </label>
        <div className="field">
          <label htmlFor="perf-color">{t.performer.color}</label>
          <ColorField
            id="perf-color"
            value={performer.color}
            onChange={(color) => updatePerformer(performer.id, { color })}
          />
        </div>
        <div className="field expert-only-ui">
          <label htmlFor="perf-badge" title={t.performer.badgeTitle}>
            {t.performer.badgeLabel}
          </label>
          <input
            id="perf-badge"
            type="text"
            title={t.performer.badgeTitle}
            value={performer.badge ?? ''}
            onChange={(e) =>
              updatePerformer(performer.id, { badge: normalizeBadge(e.target.value) })
            }
          />
        </div>
        <div className="field expert-only-ui">
          <label htmlFor="perf-tags" title={t.performer.tagsTitle}>
            {t.performer.tagsLabel}
          </label>
          <input
            id="perf-tags"
            key={performer.id}
            type="text"
            title={t.performer.tagsTitle}
            defaultValue={(performer.tags ?? []).join(', ')}
            placeholder={t.performer.tagsPlaceholder}
            onBlur={(e) => updatePerformer(performer.id, { tags: parseTags(e.target.value) })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        </div>
        <label
          className="expert-only-ui"
          style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}
        >
          <input
            type="checkbox"
            checked={pathPerformerId === performer.id}
            onChange={(e) => setPathPerformer(e.target.checked ? performer.id : null)}
          />
          {t.performer.showPath}
        </label>
        {pos !== undefined && (
          <>
            <div style={{ display: 'flex', gap: 8 }}>
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="pos-x">{t.performer.xLabel}</label>
                <NumberField
                  id="pos-x"
                  step={0.1}
                  decimals={2}
                  value={pos.x}
                  onCommit={(v) => setPosition(selectedFormationId, performer.id, v, pos.y)}
                />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="pos-y">{t.performer.yLabel}</label>
                <NumberField
                  id="pos-y"
                  step={0.1}
                  decimals={2}
                  value={pos.y}
                  onCommit={(v) => setPosition(selectedFormationId, performer.id, pos.x, v)}
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="pos-rot">{t.performer.facingLabel}</label>
              <input
                id="pos-rot"
                type="range"
                min={0}
                max={359}
                value={Math.round(pos.rotation)}
                onChange={(e) => {
                  const v = num(e.target.value);
                  if (v !== null) setRotation(selectedFormationId, performer.id, v);
                }}
              />
              <NumberField
                aria-label={t.performer.facingDegreesAria}
                min={0}
                max={359}
                decimals={0}
                value={pos.rotation}
                onCommit={(v) => setRotation(selectedFormationId, performer.id, v)}
              />
            </div>
            <div className="field expert-only-ui">
              <label htmlFor="pos-marker" title={t.performer.markerTitle}>
                {t.performer.markerLabel}
              </label>
              <select
                id="pos-marker"
                title={t.performer.markerTitle}
                value={pos.marker ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  setMarker(
                    selectedFormationId,
                    performer.id,
                    v === 'square' || v === 'triangle' || v === 'diamond' ? v : null,
                  );
                }}
              >
                <option value="">{t.performer.markerNone}</option>
                <option value="square">{t.performer.markerSquare}</option>
                <option value="triangle">{t.performer.markerTriangle}</option>
                <option value="diamond">{t.performer.markerDiamond}</option>
              </select>
            </div>
          </>
        )}
        <button
          type="button"
          className="btn btn-danger"
          onClick={() => removePerformer(performer.id)}
        >
          {t.performer.removeFromCast}
        </button>
      </div>
      <CommentsSection performerId={performer.id} />
    </>
  );
}

/** Shared text when every selected dancer has the same value; null when they differ. */
function sharedText(values: readonly string[]): string | null {
  const first = values[0];
  if (first === undefined) return '';
  return values.every((value) => value === first) ? first : null;
}

function GroupTextField({
  id,
  label,
  field,
  values,
  emptyPlaceholder,
}: {
  id: string;
  label: string;
  field: 'name' | 'role';
  values: readonly string[];
  emptyPlaceholder?: string;
}): ReactElement {
  const t = useT();
  const updatePerformers = useEditor((s) => s.updatePerformers);
  const selectedPerformerIds = useEditor((s) => s.selectedPerformerIds);
  const shared = sharedText(values);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="group-edit"
        type="text"
        title={t.performer.groupFieldTitle}
        value={shared ?? ''}
        placeholder={shared === null ? t.performer.groupMixed : emptyPlaceholder}
        onChange={(e) => updatePerformers(selectedPerformerIds, { [field]: e.target.value })}
      />
    </div>
  );
}

function MultiSelectSection({ count }: { count: number }): ReactElement {
  const t = useT();
  const performers = useEditor((s) => s.performers);
  const selectedPerformerIds = useEditor((s) => s.selectedPerformerIds);
  const selected = performers.filter((p) => selectedPerformerIds.includes(p.id));
  const swapSelected = useEditor((s) => s.swapSelected);
  const alignSelected = useEditor((s) => s.alignSelected);
  const distributeSelected = useEditor((s) => s.distributeSelected);
  const rotateSelectedAsGroup = useEditor((s) => s.rotateSelectedAsGroup);
  const stretchSelected = useEditor((s) => s.stretchSelected);

  return (
    <>
      <div className="panel-title">{t.performer.titleMany}</div>
      <div className="panel-section">
        <p className="empty-note">{t.performer.multiSelected(count)}</p>
        <GroupTextField
          id="group-name"
          label={t.performer.name}
          field="name"
          values={selected.map((p) => p.name)}
        />
        <GroupTextField
          id="group-role"
          label={t.performer.role}
          field="role"
          values={selected.map((p) => p.role)}
          emptyPlaceholder={t.performer.rolePlaceholder}
        />
        <span className="field-label expert-only-ui">{t.performer.tools}</span>
        {count === 2 && (
          <button
            type="button"
            className="btn expert-only-ui"
            title={t.performer.swapTitle}
            onClick={swapSelected}
          >
            {t.performer.swap}
          </button>
        )}
        <div className="expert-only-ui" style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="btn"
            style={{ flex: 1 }}
            title={t.performer.alignRowTitle}
            onClick={() => alignSelected('row')}
          >
            {t.performer.alignRow}
          </button>
          <button
            type="button"
            className="btn"
            style={{ flex: 1 }}
            title={t.performer.alignColTitle}
            onClick={() => alignSelected('col')}
          >
            {t.performer.alignCol}
          </button>
        </div>
        {count >= 3 && (
          <div className="expert-only-ui" style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn"
              style={{ flex: 1 }}
              title={t.performer.distributeXTitle}
              onClick={() => distributeSelected('x')}
            >
              {t.performer.distributeX}
            </button>
            <button
              type="button"
              className="btn"
              style={{ flex: 1 }}
              title={t.performer.distributeYTitle}
              onClick={() => distributeSelected('y')}
            >
              {t.performer.distributeY}
            </button>
          </div>
        )}
        <div className="expert-only-ui" style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="btn"
            style={{ flex: 1 }}
            title={t.performer.rotateGroupCcwTitle}
            onClick={() => rotateSelectedAsGroup(-15)}
          >
            {t.performer.rotateGroupCcw}
          </button>
          <button
            type="button"
            className="btn"
            style={{ flex: 1 }}
            title={t.performer.rotateGroupCwTitle}
            onClick={() => rotateSelectedAsGroup(15)}
          >
            {t.performer.rotateGroupCw}
          </button>
        </div>
        <div className="expert-only-ui" style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="btn"
            style={{ flex: 1 }}
            title={t.performer.spreadTitle}
            onClick={() => stretchSelected(1.15)}
          >
            {t.performer.spread}
          </button>
          <button
            type="button"
            className="btn"
            style={{ flex: 1 }}
            title={t.performer.tightenTitle}
            onClick={() => stretchSelected(1 / 1.15)}
          >
            {t.performer.tighten}
          </button>
        </div>
      </div>
    </>
  );
}

/** Tiny stage plan of one suggestion: the stage box plus one dot per spot. */
function SuggestionPreview({ suggestion }: { suggestion: Suggestion }): ReactElement {
  const stageWidth = useEditor((s) => s.performance.stageWidth);
  const stageHeight = useEditor((s) => s.performance.stageHeight);
  const W = 72;
  const H = Math.round((W * stageHeight) / stageWidth);
  return (
    <svg
      width={W}
      height={H}
      aria-hidden="true"
      style={{ background: 'var(--house)', border: '1px solid var(--panel-edge)', flexShrink: 0 }}
    >
      {Object.values(suggestion.positions).map((spot, i) => (
        <circle
          key={i}
          cx={(spot.x / stageWidth) * W}
          cy={(spot.y / stageHeight) * H}
          r={2}
          fill="var(--tungsten)"
        />
      ))}
    </svg>
  );
}

function FormationSection(): ReactElement | null {
  const t = useT();
  const formations = useEditor((s) => s.formations);
  const selectedFormationId = useEditor((s) => s.selectedFormationId);
  const updateFormation = useEditor((s) => s.updateFormation);
  const setFormationStart = useEditor((s) => s.setFormationStart);
  const removeFormation = useEditor((s) => s.removeFormation);
  const moveFormation = useEditor((s) => s.moveFormation);
  const applyTemplate = useEditor((s) => s.applyTemplate);
  const untangleFromPrevious = useEditor((s) => s.untangleFromPrevious);
  const mirrorFormation = useEditor((s) => s.mirrorFormation);
  const copyPositionsFrom = useEditor((s) => s.copyPositionsFrom);
  const applySuggestedPositions = useEditor((s) => s.applySuggestedPositions);
  const hasPerformers = useEditor((s) => s.performers.length > 0);
  const allPerformers = useEditor((s) => s.performers);
  // Understudies are excluded from analysis and generated layouts.
  const performers = useMemo(() => allPerformers.filter(isPerformerActive), [allPerformers]);
  const positions = useEditor((s) => s.positions);
  const [templateKind, setTemplateKind] = useState<TemplateKind>('line');
  const [copySourceId, setCopySourceId] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [presets, setPresets] = useState<FormationPreset[]>(() => listFormationPresets());
  const [presetId, setPresetId] = useState('');

  const onSavePreset = (): void => {
    const s = useEditor.getState();
    const name = window.prompt(t.presets.savePrompt, t.presets.defaultName);
    if (name === null || name.trim() === '') return;
    saveFormationPreset(
      name.trim(),
      s.performers.filter(isPerformerActive).map((p) => p.id),
      s.positions[s.selectedFormationId] ?? {},
      s.performance.stageWidth,
      s.performance.stageHeight,
    );
    setPresets(listFormationPresets());
  };

  const onApplyPreset = (): void => {
    const preset = presets.find((p) => p.id === presetId);
    if (preset === undefined) return;
    const s = useEditor.getState();
    applySuggestedPositions(
      applyPresetToCast(
        preset,
        s.performers.filter(isPerformerActive).map((p) => p.id),
        s.positions[s.selectedFormationId] ?? {},
        s.performance.stageWidth,
        s.performance.stageHeight,
      ),
    );
  };

  const onSuggest = (): void => {
    // Read once on click — suggestions should not churn while dragging.
    const s = useEditor.getState();
    const ordered = byOrder(s.formations);
    const index = ordered.findIndex((f) => f.id === s.selectedFormationId);
    const previous = index > 0 ? ordered[index - 1] : undefined;
    const previousSpots = previous !== undefined ? (s.positions[previous.id] ?? null) : null;
    setSuggestions(
      suggestFormations(
        s.performers.filter(isPerformerActive).map((p) => p.id),
        previousSpots,
        s.performance.stageWidth,
        s.performance.stageHeight,
      ),
    );
  };

  const formation = formations.find((f) => f.id === selectedFormationId);
  if (formation === undefined) return null;
  const isFirst = ![...formations].some((f) => f.orderIndex < formation.orderIndex);
  // The walk-in (transition) is the gap after the previous formation's hold;
  // editing it moves THIS formation's start (later formations never shift).
  const orderedFormations = byOrder(formations);
  const prevFormation =
    orderedFormations[orderedFormations.findIndex((f) => f.id === selectedFormationId) - 1];
  const prevEndMs =
    prevFormation === undefined ? null : prevFormation.startTimeMs + prevFormation.durationMs;

  // Virtual clinic: analyze the transition INTO this formation — dancers
  // who would meet mid-walk, and dancers who have to run to make it.
  const issues = ((): {
    collisions: [string, string][];
    tooFast: { name: string; speed: number }[];
  } | null => {
    if (isFirst) return null;
    const ordered = byOrder(formations);
    const previous = ordered[ordered.findIndex((f) => f.id === selectedFormationId) - 1];
    if (previous === undefined) return null;
    const prevPos = positions[previous.id] ?? {};
    const currPos = positions[selectedFormationId] ?? {};
    const walkers: string[] = [];
    const paths: WalkPath[] = [];
    for (const p of performers) {
      const from = prevPos[p.id];
      const to = currPos[p.id];
      if (from === undefined || to === undefined) continue;
      const control =
        previous.transitionType === 'curve' ? from.curveControlPoints?.[0] : undefined;
      walkers.push(p.name);
      paths.push({
        from: { x: from.x, y: from.y },
        to: { x: to.x, y: to.y },
        ...(control !== undefined ? { control: { x: control.x, y: control.y } } : {}),
      });
    }
    const durationMs = formation.startTimeMs - (previous.startTimeMs + previous.durationMs);
    const result = analyzeTransition(paths, durationMs);
    if (result.collisions.length === 0 && result.tooFast.length === 0) return null;
    return {
      collisions: result.collisions.map(([i, j]) => [walkers[i] ?? '?', walkers[j] ?? '?']),
      tooFast: result.tooFast.map((f) => ({ name: walkers[f.index] ?? '?', speed: f.speedMps })),
    };
  })();

  return (
    <>
      <div className="panel-title">{t.formation.title}</div>
      <div className="panel-section">
        <div className="field">
          <label htmlFor="form-name">{t.formation.name}</label>
          <input
            id="form-name"
            type="text"
            value={formation.name}
            onChange={(e) => updateFormation(formation.id, { name: e.target.value })}
          />
        </div>
        {SHOW_FORMATION_ARRANGE && (
          <div style={{ display: 'flex', gap: 8 }}>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="form-start">{t.formation.startLabel}</label>
              <NumberField
                id="form-start"
                min={0}
                step={0.1}
                decimals={1}
                value={formation.startTimeMs / 1000}
                onCommit={(v) => setFormationStart(formation.id, v * 1000)}
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="form-dur">{t.formation.holdLabel}</label>
              <NumberField
                id="form-dur"
                min={0}
                step={0.1}
                decimals={1}
                value={formation.durationMs / 1000}
                onCommit={(v) =>
                  updateFormation(formation.id, { durationMs: Math.max(0, v * 1000) })
                }
              />
            </div>
            {prevEndMs !== null && (
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="form-walkin" title={t.formation.walkInTitle}>
                  {t.formation.walkInLabel}
                </label>
                <NumberField
                  id="form-walkin"
                  min={0}
                  step={0.1}
                  decimals={1}
                  value={Math.max(0, formation.startTimeMs - prevEndMs) / 1000}
                  onCommit={(v) =>
                    setFormationStart(formation.id, prevEndMs + Math.max(0, v) * 1000)
                  }
                />
              </div>
            )}
          </div>
        )}
        <div className="field expert-only-ui">
          <label htmlFor="form-color" title={t.formation.colorTitle}>
            {t.formation.colorLabel}
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <ColorField
              id="form-color"
              title={t.formation.colorTitle}
              value={formation.color ?? '#e8843c'}
              onChange={(color) => updateFormation(formation.id, { color })}
            />
            {formation.color !== undefined && (
              <button
                type="button"
                className="btn"
                onClick={() => updateFormation(formation.id, { color: undefined })}
              >
                {t.formation.colorClear}
              </button>
            )}
          </div>
        </div>
        {SHOW_FORMATION_ARRANGE && (
          <div className="field">
            <label htmlFor="form-transition">{t.formation.transitionLabel}</label>
            <select
              id="form-transition"
              value={formation.transitionType}
              onChange={(e) =>
                updateFormation(formation.id, {
                  transitionType: e.target.value === 'curve' ? 'curve' : 'linear',
                })
              }
            >
              <option value="linear">{t.formation.transitionLinear}</option>
              <option value="curve">{t.formation.transitionCurve}</option>
            </select>
          </div>
        )}
        {SHOW_FORMATION_ARRANGE && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn" onClick={() => moveFormation(formation.id, -1)}>
              {t.formation.earlier}
            </button>
            <button type="button" className="btn" onClick={() => moveFormation(formation.id, 1)}>
              {t.formation.later}
            </button>
          </div>
        )}
        {SHOW_FORMATION_ARRANGE && (
          <div className="field">
            <label htmlFor="form-template">{t.formation.templateLabel}</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <select
                id="form-template"
                value={templateKind}
                onChange={(e) => setTemplateKind(e.target.value as TemplateKind)}
              >
                {Object.entries(t.formation.templates).map(([kind, label]) => (
                  <option key={kind} value={kind}>
                    {label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn"
                disabled={!hasPerformers}
                title={hasPerformers ? t.formation.applyTitle : t.formation.applyDisabledTitle}
                onClick={() => applyTemplate(templateKind)}
              >
                {t.formation.apply}
              </button>
            </div>
          </div>
        )}
        <div className="field expert-only-ui">
          <label htmlFor="form-preset">{t.presets.label}</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <select
              id="form-preset"
              aria-label={t.presets.selectAria}
              value={presetId}
              onChange={(e) => setPresetId(e.target.value)}
            >
              <option value="">—</option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.spots.length}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn"
              disabled={presetId === '' || !hasPerformers}
              title={t.presets.applyTitle}
              onClick={onApplyPreset}
            >
              {t.presets.apply}
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn"
              disabled={!hasPerformers}
              title={t.presets.saveTitle}
              onClick={onSavePreset}
            >
              {t.presets.save}
            </button>
            {presetId !== '' && (
              <button
                type="button"
                className="btn"
                aria-label={t.presets.deleteAria}
                onClick={() => {
                  deleteFormationPreset(presetId);
                  setPresetId('');
                  setPresets(listFormationPresets());
                }}
              >
                ×
              </button>
            )}
          </div>
        </div>
        {issues !== null && (
          <div className="field expert-only-ui" role="status" aria-label={t.analyzer.aria}>
            {issues.collisions.map(([a, b]) => (
              <span key={`c-${a}-${b}`} className="analyzer-warn">
                {t.analyzer.collision(a, b)}
              </span>
            ))}
            {issues.tooFast.map((f) => (
              <span key={`s-${f.name}`} className="analyzer-warn">
                {t.analyzer.tooFast(f.name, f.speed.toFixed(1))}
              </span>
            ))}
          </div>
        )}
        <button
          type="button"
          className="btn expert-only-ui"
          disabled={isFirst || !hasPerformers}
          title={isFirst ? t.formation.untangleFirstTitle : t.formation.untangleTitle}
          onClick={untangleFromPrevious}
        >
          {t.formation.untangle}
        </button>
        <button
          type="button"
          className="btn expert-only-ui"
          disabled={!hasPerformers}
          title={t.formation.mirrorTitle}
          onClick={mirrorFormation}
        >
          {t.formation.mirror}
        </button>
        {SHOW_FORMATION_ARRANGE && (
          <button
            type="button"
            className="btn"
            disabled={!hasPerformers}
            title={t.suggest.buttonTitle}
            onClick={onSuggest}
          >
            {t.suggest.button}
          </button>
        )}
        {SHOW_FORMATION_ARRANGE && suggestions !== null && suggestions.length > 0 && (
          <div className="field" aria-label={t.suggest.listAria}>
            {suggestions.map((suggestion) => (
              <div key={suggestion.kind} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <SuggestionPreview suggestion={suggestion} />
                <span style={{ flex: 1, fontSize: 12 }}>{t.suggest.kinds[suggestion.kind]}</span>
                <button
                  type="button"
                  className="btn"
                  title={t.suggest.applyTitle}
                  onClick={() => applySuggestedPositions(suggestion.positions)}
                >
                  {t.suggest.apply}
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="field expert-only-ui">
          <label htmlFor="form-copy-from">{t.formation.copyFromLabel}</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <select
              id="form-copy-from"
              aria-label={t.formation.copyFromAria}
              value={copySourceId}
              onChange={(e) => setCopySourceId(e.target.value)}
            >
              <option value="">—</option>
              {byOrder(formations)
                .filter((f) => f.id !== formation.id)
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
            </select>
            <button
              type="button"
              className="btn"
              disabled={copySourceId === ''}
              title={t.formation.copyFromTitle}
              onClick={() => copyPositionsFrom(copySourceId)}
            >
              {t.formation.copyFrom}
            </button>
          </div>
        </div>
        <button
          type="button"
          className="btn btn-danger"
          onClick={() => removeFormation(formation.id)}
        >
          {t.formation.deleteFormation}
        </button>
      </div>
      <CommentsSection performerId={null} />
    </>
  );
}

function HistorySection(): ReactElement {
  const t = useT();
  const restoreDoc = useEditor((s) => s.restoreDoc);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);

  const refresh = useCallback(() => {
    void listSnapshots().then(setSnapshots);
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <>
      <div className="panel-section">
        <button
          type="button"
          className="btn"
          onClick={() => {
            const s = useEditor.getState();
            const name = `${s.performance.title} · ${new Date().toLocaleTimeString()}`;
            void saveSnapshot(name, {
              performance: s.performance,
              performers: s.performers,
              props: s.props,
              formations: s.formations,
              positions: s.positions,
              comments: s.comments,
              annotations: s.annotations,
              fixtures: s.fixtures,
              captions: s.captions,
            }).then(refresh);
          }}
        >
          {t.history.saveSnapshot}
        </button>
        {snapshots.length === 0 && <span className="mono">{t.history.noSnapshots}</span>}
        {snapshots.map((snap) => (
          <div key={snap.id} className="comment-row">
            <div className="comment-head">
              <span className="comment-author">
                {new Date(snap.createdAt).toLocaleString(t.dateLocale, {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
              <button
                type="button"
                className="comment-delete"
                aria-label={t.history.deleteSnapshotAria(snap.name)}
                onClick={() => {
                  void deleteSnapshot(snap.id).then(refresh);
                }}
              >
                ×
              </button>
            </div>
            <div className="comment-text">{snap.name}</div>
            <button
              type="button"
              className="btn"
              style={{ marginTop: 4 }}
              onClick={() => restoreDoc(snap.doc)}
            >
              {t.history.restore}
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

function PieceSizeFields({
  idPrefix,
  width,
  height,
  onWidth,
  onHeight,
}: {
  idPrefix: string;
  width: number;
  height: number;
  onWidth: (value: number) => void;
  onHeight: (value: number) => void;
}): ReactElement {
  const t = useT();
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <div className="field" style={{ flex: 1 }}>
        <label htmlFor={`${idPrefix}-width`}>{t.stageSettings.pieceWidth}</label>
        <NumberField
          id={`${idPrefix}-width`}
          min={0.3}
          max={30}
          step={0.1}
          value={width}
          onCommit={(next) => onWidth(Math.max(0.3, next))}
        />
      </div>
      <div className="field" style={{ flex: 1 }}>
        <label htmlFor={`${idPrefix}-height`}>{t.stageSettings.pieceDepth}</label>
        <NumberField
          id={`${idPrefix}-height`}
          min={0.3}
          max={30}
          step={0.1}
          value={height}
          onCommit={(next) => onHeight(Math.max(0.3, next))}
        />
      </div>
    </div>
  );
}

function ShapeChoice({
  id,
  shape,
  onChange,
}: {
  id: string;
  shape: 'rect' | 'ellipse';
  onChange: (shape: 'rect' | 'ellipse') => void;
}): ReactElement {
  const t = useT();
  return (
    <div className="field">
      <label htmlFor={id}>{t.stageSettings.shape}</label>
      <select
        id={id}
        value={shape}
        onChange={(event) => onChange(event.target.value === 'ellipse' ? 'ellipse' : 'rect')}
      >
        <option value="rect">{t.stageSettings.shapeRect}</option>
        <option value="ellipse">{t.stageSettings.shapeEllipse}</option>
      </select>
      <div style={{ color: 'var(--ink-dim)', fontSize: 12, marginTop: 4 }}>
        {t.stageSettings.shapeHint}
      </div>
    </div>
  );
}

function RotationField({
  id,
  value,
  onCommit,
}: {
  id: string;
  value: number;
  onCommit: (deg: number) => void;
}): ReactElement {
  const t = useT();
  return (
    <div className="field">
      <label htmlFor={id}>{t.stageSettings.rotation}</label>
      <NumberField id={id} step={5} decimals={0} value={value} onCommit={onCommit} />
    </div>
  );
}

function FixtureSection(): ReactElement | null {
  const t = useT();
  const fixtures = useEditor((s) => s.fixtures);
  const selectedFixtureId = useEditor((s) => s.selectedFixtureId);
  const updateFixture = useEditor((s) => s.updateFixture);
  const removeFixture = useEditor((s) => s.removeFixture);
  const piece = fixtures.find((item) => item.id === selectedFixtureId);
  if (piece === undefined) return null;
  return (
    <>
      <div className="panel-title">{t.stageSettings.fixtureSection}</div>
      <div className="panel-section">
        <div className="field">
          <label htmlFor="fixture-label">{t.stageSettings.fixtureLabel}</label>
          <input
            id="fixture-label"
            type="text"
            value={piece.label}
            onChange={(event) => updateFixture(piece.id, { label: event.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="fixture-color">{t.stageSettings.pieceColor}</label>
          <ColorField
            id="fixture-color"
            value={piece.color}
            onChange={(color) => updateFixture(piece.id, { color })}
          />
        </div>
        <ShapeChoice
          id="fixture-shape"
          shape={fixtureShape(piece)}
          onChange={(shape) =>
            updateFixture(
              piece.id,
              shape === 'ellipse' ? { shape, height: piece.width } : { shape },
            )
          }
        />
        <PieceSizeFields
          idPrefix="fixture"
          width={piece.width}
          height={piece.height}
          onWidth={(width) => updateFixture(piece.id, { width })}
          onHeight={(height) => updateFixture(piece.id, { height })}
        />
        <RotationField
          id="fixture-rotation"
          value={pieceRotation(piece)}
          onCommit={(rotation) => updateFixture(piece.id, { rotation })}
        />
        <button type="button" className="btn" onClick={() => removeFixture(piece.id)}>
          {t.stageSettings.removePiece}
        </button>
      </div>
    </>
  );
}

function CaptionSection(): ReactElement | null {
  const t = useT();
  const captions = useEditor((s) => s.captions);
  const selectedCaptionId = useEditor((s) => s.selectedCaptionId);
  const updateCaption = useEditor((s) => s.updateCaption);
  const removeCaption = useEditor((s) => s.removeCaption);
  const piece = captions.find((item) => item.id === selectedCaptionId);
  if (piece === undefined) return null;
  const size = captionSize(piece);
  return (
    <>
      <div className="panel-title">{t.stageSettings.captionSection}</div>
      <div className="panel-section">
        <div className="field">
          <label htmlFor="caption-text">{t.stageSettings.captionText}</label>
          <input
            id="caption-text"
            type="text"
            value={piece.text}
            onChange={(event) => updateCaption(piece.id, { text: event.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="caption-color">{t.stageSettings.pieceColor}</label>
          <ColorField
            id="caption-color"
            value={piece.color}
            onChange={(color) => updateCaption(piece.id, { color })}
          />
        </div>
        <ShapeChoice
          id="caption-shape"
          shape={fixtureShape(piece)}
          onChange={(shape) =>
            updateCaption(piece.id, {
              shape,
              width: piece.width ?? size.width,
              height:
                shape === 'ellipse' ? (piece.width ?? size.width) : (piece.height ?? size.height),
            })
          }
        />
        <PieceSizeFields
          idPrefix="caption"
          width={size.width}
          height={size.height}
          onWidth={(width) =>
            updateCaption(piece.id, { width, height: piece.height ?? size.height })
          }
          onHeight={(height) =>
            updateCaption(piece.id, { height, width: piece.width ?? size.width })
          }
        />
        <RotationField
          id="caption-rotation"
          value={pieceRotation(piece)}
          onCommit={(rotation) => updateCaption(piece.id, { rotation })}
        />
        <button type="button" className="btn" onClick={() => removeCaption(piece.id)}>
          {t.stageSettings.removePiece}
        </button>
      </div>
    </>
  );
}

function PropSection(): ReactElement | null {
  const t = useT();
  const props = useEditor((s) => s.props);
  const selectedPropId = useEditor((s) => s.selectedPropId);
  const selectedFormationId = useEditor((s) => s.selectedFormationId);
  const positions = useEditor((s) => s.positions);
  const updateProp = useEditor((s) => s.updateProp);
  const removeProp = useEditor((s) => s.removeProp);
  const setRotation = useEditor((s) => s.setRotation);

  const prop = props.find((p) => p.id === selectedPropId);
  if (prop === undefined) return null;
  const rotation = positions[selectedFormationId]?.[prop.id]?.rotation ?? 0;

  return (
    <>
      <div className="panel-title">
        {prop.textOnly === true ? t.props.textSection : t.props.sectionTitle}
      </div>
      <div className="panel-section">
        <div className="field">
          <label htmlFor="prop-name">
            {prop.textOnly === true ? t.stageSettings.captionText : t.props.name}
          </label>
          <input
            id="prop-name"
            type="text"
            value={prop.name}
            onChange={(e) => updateProp(prop.id, { name: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="prop-kind">{t.props.kind}</label>
          <select
            id="prop-kind"
            value={prop.kind}
            onChange={(e) => {
              const kind = e.target.value;
              if (kind !== 'rect' && kind !== 'circle' && kind !== 'triangle') return;
              if (prop.textOnly === true && kind === 'triangle') return;
              if (kind === 'circle') updateProp(prop.id, { kind, height: prop.width });
              else updateProp(prop.id, { kind });
            }}
          >
            <option value="rect">{t.props.kindRect}</option>
            <option value="circle">{t.props.kindCircle}</option>
            {prop.textOnly !== true && <option value="triangle">{t.props.kindTriangle}</option>}
          </select>
          <div style={{ color: 'var(--ink-dim)', fontSize: 12, marginTop: 4 }}>
            {t.stageSettings.shapeHint}
          </div>
        </div>
        <div className="field">
          <label htmlFor="prop-color">{t.props.color}</label>
          <ColorField
            id="prop-color"
            value={prop.color}
            onChange={(color) => updateProp(prop.id, { color })}
          />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="prop-width">{t.props.widthLabel}</label>
            <NumberField
              id="prop-width"
              min={0.2}
              max={30}
              step={0.1}
              value={prop.width}
              onCommit={(w) => updateProp(prop.id, { width: Math.max(0.2, w) })}
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="prop-height">{t.props.heightLabel}</label>
            <NumberField
              id="prop-height"
              min={0.2}
              max={30}
              step={0.1}
              value={prop.height}
              onCommit={(h) => updateProp(prop.id, { height: Math.max(0.2, h) })}
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="prop-rotation">{t.props.rotationLabel}</label>
          <NumberField
            id="prop-rotation"
            step={5}
            decimals={0}
            value={rotation}
            onCommit={(deg) => setRotation(selectedFormationId, prop.id, deg)}
          />
        </div>
        <button type="button" className="btn" onClick={() => removeProp(prop.id)}>
          {t.props.remove}
        </button>
      </div>
    </>
  );
}

export function PropertiesPanel(): ReactElement {
  const t = useT();
  const hasPerformerSelection = useEditor((s) => s.selectedPerformerIds.length > 0);
  const hasPropSelection = useEditor((s) => s.selectedPropId !== null);
  const hasFixtureSelection = useEditor((s) => s.selectedFixtureId !== null);
  const hasCaptionSelection = useEditor((s) => s.selectedCaptionId !== null);

  return (
    <aside className="props-panel side-panel">
      {hasFixtureSelection ? (
        <FixtureSection />
      ) : hasCaptionSelection ? (
        <CaptionSection />
      ) : hasPropSelection ? (
        <PropSection />
      ) : hasPerformerSelection ? (
        <PerformerSection />
      ) : (
        <FormationSection />
      )}
      <StageSettingsDialog />
      <details className="panel-fold expert-only-ui">
        <summary>{t.history.title}</summary>
        <HistorySection />
      </details>
    </aside>
  );
}
