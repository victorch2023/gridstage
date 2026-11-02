import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { watchAuth } from '../host/firebase';
import { markNoticeShown, noticeDue, readNoticeLog } from '../host/expiryNotice';
import type { NoticeSlot } from '../host/expiryNotice';
import { renewCurrentShare, useHosted } from '../host/session';
import { SHARE_DURATIONS_DAYS } from '../host/shareRemote';
import type { ShareDurationDays } from '../host/shareRemote';
import { useT } from '../i18n';

/**
 * Modal reminders for the project owner during the last week online.
 * Closing one reminder records it. If the last two days have also started,
 * the second reminder opens immediately after.
 */
export function ExpiryNotice(): ReactElement | null {
  const t = useT();
  const shareId = useHosted((s) => s.shareId);
  const editorUid = useHosted((s) => s.editorUid);
  const expiresAtMs = useHosted((s) => s.expiresAtMs);
  const [uid, setUid] = useState<string | null>(null);
  const [slot, setSlot] = useState<NoticeSlot | null>(null);
  const [picking, setPicking] = useState(false);
  const [duration, setDuration] = useState<ShareDurationDays>(30);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const renewed = useRef(false);

  useEffect(() => watchAuth((user) => setUid(user?.uid ?? null)), []);

  useEffect(() => {
    if (uid === null || uid !== editorUid || shareId === null || expiresAtMs === null) return;
    const tick = (): void => {
      if (dialogRef.current?.open) return;
      const due = noticeDue(expiresAtMs, Date.now(), readNoticeLog(shareId));
      if (due !== null) setSlot(due);
    };
    tick();
    const id = window.setInterval(tick, 60_000);
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [uid, editorUid, shareId, expiresAtMs]);

  useEffect(() => {
    if (slot === null) return;
    dialogRef.current?.showModal();
  }, [slot]);

  if (slot === null || shareId === null || expiresAtMs === null || uid !== editorUid) return null;

  const when = new Date(expiresAtMs).toLocaleString(t.dateLocale);
  const days = Math.max(1, Math.ceil((expiresAtMs - Date.now()) / (24 * 60 * 60 * 1000)));
  const body = slot === 'final' ? t.host.expiryFinal(days, when) : t.host.expiryBody(days, when);

  const closeNoted = (): void => {
    if (renewed.current) {
      renewed.current = false;
      setSlot(null);
      setPicking(false);
      setFailed(false);
      return;
    }
    markNoticeShown(shareId, expiresAtMs, slot);
    const next = noticeDue(expiresAtMs, Date.now(), readNoticeLog(shareId));
    setPicking(false);
    setFailed(false);
    setSlot(next);
  };

  return (
    <dialog
      ref={dialogRef}
      className="export-dialog host-dialog"
      aria-label={t.host.expiryTitle}
      onClose={closeNoted}
    >
      <div className="export-dialog-head">
        <span className="panel-title" style={{ margin: 0 }}>
          {t.host.expiryTitle}
        </span>
        <button type="button" className="btn" onClick={() => dialogRef.current?.close()}>
          {t.host.close}
        </button>
      </div>
      <div className="host-dialog-body">
        <p className="empty-note">{body}</p>
        {picking && (
          <label className="field">
            {t.host.duration}
            <select
              value={duration}
              onChange={(event) => setDuration(Number(event.target.value) as ShareDurationDays)}
            >
              {SHARE_DURATIONS_DAYS.map((option) => (
                <option key={option} value={option}>
                  {t.host.durationLabel(option)}
                </option>
              ))}
            </select>
          </label>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => dialogRef.current?.close()}
          >
            {t.host.expiryLetEnd}
          </button>
          {picking ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setFailed(false);
                void renewCurrentShare(duration).then(
                  () => {
                    renewed.current = true;
                    setBusy(false);
                    dialogRef.current?.close();
                  },
                  () => {
                    setBusy(false);
                    setFailed(true);
                  },
                );
              }}
            >
              {t.host.expiryApply}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => setPicking(true)}
            >
              {t.host.expiryExtend}
            </button>
          )}
        </div>
        {failed && <p className="empty-note">{t.host.expiryFailed}</p>}
      </div>
    </dialog>
  );
}
