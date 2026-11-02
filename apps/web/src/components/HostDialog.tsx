import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { useT } from '../i18n';
import {
  firebaseErrorCode,
  loadFirebaseConfig,
  sendHostingPasswordReset,
  signInWithEmail,
  signOutHosting,
  signUpWithEmail,
  watchAuth,
} from '../host/firebase';
import {
  publishCurrentDoc,
  renewCurrentShare,
  sharePageUrl,
  useHosted,
  withdrawCurrentShare,
} from '../host/session';
import { SHARE_DURATIONS_DAYS } from '../host/shareRemote';
import type { ShareDurationDays } from '../host/shareRemote';
import { ShareAudioTooLargeError } from '../host/pack';
import { useReadOnly } from '../state/viewMode';

/**
 * Publish the open choreography to the Spark Firestore project for a fixed
 * term. The signed-in account can keep editing; the link is read-only.
 */
export function HostDialog(): ReactElement | null {
  const t = useT();
  const readOnly = useReadOnly((s) => s.readOnly);
  const hosted = useHosted();
  const shareInUrl = new URLSearchParams(window.location.search).get('share');
  const [configured, setConfigured] = useState<boolean | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userUid, setUserUid] = useState<string | null>(null);
  const [duration, setDuration] = useState<ShareDurationDays>(30);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [note, setNote] = useState('');
  const [link, setLink] = useState('');

  useEffect(() => {
    void loadFirebaseConfig().then((config) => setConfigured(config !== null));
    return watchAuth((user) => {
      setUserEmail(user?.email ?? null);
      setUserUid(user?.uid ?? null);
    });
  }, []);

  if (configured === null) return null;
  if (!configured && !import.meta.env.DEV) return null;
  if (readOnly && shareInUrl === null) return null;

  const isEditor = userUid !== null && hosted.editorUid !== null && userUid === hosted.editorUid;
  const expired = hosted.expiresAtMs !== null && hosted.expiresAtMs <= Date.now();

  const onAuth = (event: { preventDefault(): void }, mode: 'in' | 'up'): void => {
    event.preventDefault();
    setBusy(true);
    setNote('');
    const run = mode === 'up' ? signUpWithEmail(email, password) : signInWithEmail(email, password);
    void run.then(
      () => {
        if (shareInUrl !== null) {
          window.location.reload();
          return;
        }
        setNote(mode === 'up' ? t.host.accountSaved : '');
        setBusy(false);
      },
      (error: unknown) => {
        setBusy(false);
        const code = firebaseErrorCode(error);
        if (code === 'auth/email-already-in-use') setNote(t.host.emailInUse);
        else if (code === 'auth/weak-password') setNote(t.host.weakPassword);
        else if (code === 'auth/invalid-email') setNote(t.host.authFailed);
        else if (code === 'permission-denied') setNote(t.host.publishFailed);
        else setNote(t.host.authFailed);
      },
    );
  };

  const onPublish = (): void => {
    setBusy(true);
    setNote('');
    setProgress(t.host.working);
    void publishCurrentDoc(duration, (done, total) => {
      if (total > 0) setProgress(t.host.progress(done, total));
    }).then(
      (url) => {
        setLink(url);
        setNote(t.host.saved);
        setBusy(false);
        setProgress('');
      },
      (error: unknown) => {
        setBusy(false);
        setProgress('');
        setNote(
          error instanceof ShareAudioTooLargeError ? t.host.audioTooBig : t.host.publishFailed,
        );
      },
    );
  };

  const shownLink =
    link !== '' ? link : hosted.shareId !== null && isEditor ? sharePageUrl(hosted.shareId) : '';

  return (
    <>
      <button
        type="button"
        className="btn"
        title={t.host.openTitle}
        onClick={() => dialogRef.current?.showModal()}
      >
        {readOnly ? t.host.signInToEdit : t.host.open}
      </button>
      <dialog ref={dialogRef} className="export-dialog host-dialog" aria-label={t.host.title}>
        <div className="export-dialog-head">
          <span className="panel-title" style={{ margin: 0 }}>
            {t.host.title}
          </span>
          <button type="button" className="btn" onClick={() => dialogRef.current?.close()}>
            {t.host.close}
          </button>
        </div>
        <div className="host-dialog-body">
          {configured === false && <p className="empty-note">{t.host.setup}</p>}
          {configured === true && userEmail === null && (
            <form
              onSubmit={(event) => onAuth(event, 'in')}
              style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
            >
              <p className="empty-note">{t.host.registerLead}</p>
              <label className="field">
                {t.host.email}
                <input
                  type="email"
                  autoComplete="username"
                  value={email}
                  required
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <label className="field">
                {t.host.password}
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  required
                  minLength={6}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="submit" className="btn" disabled={busy}>
                  {t.host.signIn}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={(event) => onAuth(event, 'up')}
                >
                  {t.host.signUp}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={busy || email.trim() === ''}
                  onClick={() => {
                    void sendHostingPasswordReset(email).then(
                      () => setNote(t.host.resetSent),
                      () => setNote(t.host.authFailed),
                    );
                  }}
                >
                  {t.host.reset}
                </button>
              </div>
            </form>
          )}
          {configured === true && userEmail !== null && (
            <>
              <p className="empty-note">{t.host.signedInAs(userEmail)}</p>
              {hosted.editorUid !== null && !isEditor && (
                <p className="empty-note">{t.host.notEditor}</p>
              )}
              {(hosted.editorUid === null || isEditor) && (
                <>
                  <label className="field">
                    {t.host.duration}
                    <select
                      value={duration}
                      onChange={(event) =>
                        setDuration(Number(event.target.value) as ShareDurationDays)
                      }
                    >
                      {SHARE_DURATIONS_DAYS.map((days) => (
                        <option key={days} value={days}>
                          {t.host.durationLabel(days)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="empty-note">{t.host.audioNote}</p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button type="button" className="btn" disabled={busy} onClick={onPublish}>
                      {isEditor ? t.host.update : t.host.publish}
                    </button>
                    {isEditor && expired && (
                      <button
                        type="button"
                        className="btn"
                        disabled={busy}
                        onClick={() => {
                          setBusy(true);
                          void renewCurrentShare(duration).then(
                            () => {
                              setNote(t.host.saved);
                              setBusy(false);
                            },
                            () => {
                              setNote(t.host.publishFailed);
                              setBusy(false);
                            },
                          );
                        }}
                      >
                        {t.host.renew}
                      </button>
                    )}
                    {isEditor && (
                      <button
                        type="button"
                        className="btn btn-danger"
                        disabled={busy}
                        onClick={() => {
                          if (!window.confirm(t.host.withdrawConfirm)) return;
                          setBusy(true);
                          void withdrawCurrentShare().then(
                            () => {
                              setLink('');
                              setNote(t.host.withdrawn);
                              setBusy(false);
                            },
                            () => {
                              setNote(t.host.publishFailed);
                              setBusy(false);
                            },
                          );
                        }}
                      >
                        {t.host.withdraw}
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        void signOutHosting().then(() => {
                          if (shareInUrl !== null) window.location.reload();
                        });
                      }}
                    >
                      {t.host.signOut}
                    </button>
                  </div>
                  {hosted.canEdit && hosted.saveState === 'saving' && (
                    <p className="empty-note">{t.host.saving}</p>
                  )}
                  {hosted.canEdit && hosted.saveState === 'error' && (
                    <p className="empty-note">{t.host.publishFailed}</p>
                  )}
                </>
              )}
              {shownLink !== '' && (
                <label className="field">
                  {t.host.readLink}
                  <input
                    type="text"
                    readOnly
                    value={shownLink}
                    onFocus={(event) => event.target.select()}
                  />
                </label>
              )}
              {shownLink !== '' && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    void navigator.clipboard.writeText(shownLink).then(
                      () => setNote(t.host.copied),
                      () => setNote(shownLink),
                    );
                  }}
                >
                  {t.host.copy}
                </button>
              )}
              {isEditor && shownLink !== '' && <p className="empty-note">{t.host.editorNote}</p>}
            </>
          )}
          {progress !== '' && <p className="empty-note">{progress}</p>}
          {note !== '' && (
            <p className="empty-note" role="status">
              {note}
            </p>
          )}
        </div>
      </dialog>
    </>
  );
}
