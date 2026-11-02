import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { startCollab } from './collab/collab';
import { HostUnconfiguredError, openHostedShare, ShareUnavailableError } from './host/session';
import { useReadOnly } from './state/viewMode';

// three.js is heavy — load it only when someone opens the 3D preview.
const Stage3D = lazy(() => import('./components/Stage3D'));
import { TopBar } from './components/TopBar';
import { CastPanel } from './components/CastPanel';
import { StageCanvas } from './components/StageCanvas';
import { PropertiesPanel } from './components/PropertiesPanel';
import { Timeline } from './components/Timeline';
import { useAppHotkeys } from './hooks/useAppHotkeys';
import { useIsNarrow } from './hooks/useIsNarrow';
import { usePlayback } from './hooks/usePlayback';
import { clearAudio, setAudioBlob, switchAudioToDoc } from './audio/audioPlayer';
import { useEditor } from './state/store';
import { useStageBackground } from './state/stageBackground';
import { useT } from './i18n';
import { useLayout } from './state/layout';
import { PanelResizer } from './components/PanelResizer';
import { BackupNudge } from './components/BackupNudge';
import { RefVideo } from './components/RefVideo';
import { useRefVideo } from './state/refVideo';

export function App(): ReactElement {
  const t = useT();
  const readOnly = useReadOnly((s) => s.readOnly);
  const [hostGate, setHostGate] = useState<'ready' | 'loading' | 'error'>(() =>
    new URLSearchParams(window.location.search).get('share') ? 'loading' : 'ready',
  );
  const [hostError, setHostError] = useState('');
  useEffect(() => {
    document.documentElement.lang = t.dateLocale;
  }, [t.dateLocale]);
  const castWidth = useLayout((s) => s.castWidth);
  const propsWidth = useLayout((s) => s.propsWidth);
  const timelineHeight = useLayout((s) => s.timelineHeight);
  const snapToGrid = useLayout((s) => s.snapToGrid);
  const setSnapToGrid = useLayout((s) => s.setSnapToGrid);
  const uiMode = useLayout((s) => s.uiMode);
  const annotateMode = useEditor((s) => s.annotateMode);
  const setAnnotateMode = useEditor((s) => s.setAnnotateMode);
  const { togglePlay } = usePlayback();
  useAppHotkeys(togglePlay);
  const refVideoSplit = useRefVideo((s) => s.objectUrl !== null && s.layout === 'split');
  const splitRatio = useRefVideo((s) => s.splitRatio);
  const isNarrow = useIsNarrow();
  // Phone layout: side panels become slide-in drawers, one open at a time.
  const [drawer, setDrawer] = useState<'cast' | 'props' | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [audioVersion, setAudioVersion] = useState(0);
  const [show3d, setShow3d] = useState(false);

  // Each library document keeps its own audio and background — reload both
  // whenever the open document changes (app start, library switch, joining a
  // collab room).
  const perfId = useEditor((s) => s.performance.id);
  const loadBackground = useStageBackground((s) => s.load);
  useEffect(() => {
    void switchAudioToDoc(perfId).then(() => setAudioVersion((v) => v + 1));
    void loadBackground(perfId);
  }, [perfId, loadBackground]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (room !== null && room !== '') startCollab(room);
    const share = params.get('share');
    if (share === null || share === '') return;
    let cancelled = false;
    void openHostedShare(share).then(
      () => {
        if (!cancelled) setHostGate('ready');
      },
      (error: unknown) => {
        if (cancelled) return;
        setHostError(
          error instanceof HostUnconfiguredError
            ? t.host.unconfigured
            : error instanceof ShareUnavailableError
              ? t.host.unavailable
              : t.host.unavailable,
        );
        setHostGate('error');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [t.host.unconfigured, t.host.unavailable]);

  return (
    <div
      className={`app${readOnly ? ' view-mode' : ''}${uiMode === 'easy' ? ' ui-easy' : ''}${
        isNarrow ? ' app-narrow' : ''
      }${drawer === 'cast' ? ' cast-open' : ''}${drawer === 'props' ? ' props-open' : ''}`}
      // View mode's 0/1fr/0 columns come from CSS; don't override them.
      // Narrow mode's single-column grid also comes from CSS — inline styles
      // here would defeat the media query, so set none.
      style={
        isNarrow
          ? undefined
          : readOnly
            ? { gridTemplateRows: `46px 1fr ${timelineHeight}px` }
            : {
                gridTemplateColumns: `${castWidth}px 1fr ${propsWidth}px`,
                gridTemplateRows: `46px 1fr ${timelineHeight}px`,
              }
      }
    >
      <TopBar />
      <CastPanel />
      <main
        className={`stage-area${refVideoSplit ? ' stage-area-split' : ''}`}
        aria-label={t.stage.canvasAria}
      >
        <RefVideo />
        <div
          className="stage-canvas-slot"
          style={refVideoSplit ? { left: `${splitRatio * 100}%` } : undefined}
        >
          {show3d ? (
            <Suspense fallback={<p className="empty-note">{t.stage.loading3d}</p>}>
              <Stage3D />
            </Suspense>
          ) : (
            <StageCanvas />
          )}
          <div className="canvas-tools">
            {!show3d && (
              <>
                <button
                  type="button"
                  className={`btn edit-only${snapToGrid ? ' btn-active' : ''}`}
                  aria-pressed={snapToGrid}
                  title={t.stage.snapTitle}
                  onClick={() => setSnapToGrid(!snapToGrid)}
                >
                  {t.stage.snap}
                </button>
                <button
                  type="button"
                  className={`btn edit-only expert-only-ui${annotateMode === 'pen' ? ' btn-active' : ''}`}
                  aria-pressed={annotateMode === 'pen'}
                  title={t.stage.penTitle}
                  onClick={() => setAnnotateMode(annotateMode === 'pen' ? 'off' : 'pen')}
                >
                  {t.stage.pen}
                </button>
                <button
                  type="button"
                  className={`btn edit-only expert-only-ui${annotateMode === 'pin' ? ' btn-active' : ''}`}
                  aria-pressed={annotateMode === 'pin'}
                  title={t.stage.pinTitle}
                  onClick={() => setAnnotateMode(annotateMode === 'pin' ? 'off' : 'pin')}
                >
                  {t.stage.pin}
                </button>
              </>
            )}
            <button
              type="button"
              className="btn view-toggle"
              onClick={() => setShow3d((v) => !v)}
              title={show3d ? t.stage.to2dTitle : t.stage.to3dTitle}
            >
              {show3d ? '2D' : '3D'}
            </button>
          </div>
        </div>
      </main>
      <PropertiesPanel />
      <Timeline
        audioVersion={audioVersion}
        onTogglePlay={togglePlay}
        onUploadAudio={() => fileInputRef.current?.click()}
        onClearAudio={() => {
          void clearAudio().then(() => setAudioVersion((v) => v + 1));
        }}
      />
      {!isNarrow && !readOnly && (
        <>
          <PanelResizer side="cast" />
          <PanelResizer side="props" />
        </>
      )}
      {!isNarrow && <PanelResizer side="timeline" />}
      {isNarrow && !readOnly && (
        <>
          <button
            type="button"
            className="btn drawer-tab drawer-tab-cast"
            aria-expanded={drawer === 'cast'}
            onClick={() => setDrawer(drawer === 'cast' ? null : 'cast')}
          >
            {t.cast.title}
          </button>
          <button
            type="button"
            className="btn drawer-tab drawer-tab-props"
            aria-expanded={drawer === 'props'}
            onClick={() => setDrawer(drawer === 'props' ? null : 'props')}
          >
            {t.props.title}
          </button>
          {drawer !== null && (
            <button
              type="button"
              className="drawer-backdrop"
              aria-label={t.stage.closeDrawerAria}
              onClick={() => setDrawer(null)}
            />
          )}
        </>
      )}
      {!readOnly && <BackupNudge />}
      {hostGate === 'loading' && (
        <p className="host-gate" style={{ top: 0 }}>
          {t.host.loading}
        </p>
      )}
      {hostGate === 'error' && (
        <p className="host-gate" style={{ top: 46 }} role="alert">
          {hostError}
        </p>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        aria-label={t.stage.audioFileAria}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file === undefined) return;
          void setAudioBlob(file).then(() => setAudioVersion((v) => v + 1));
          e.target.value = '';
        }}
      />
    </div>
  );
}
