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
  refreshCurrentShareLinks,
  renewCurrentShare,
  sharePageUrl,
  shareReadUrl,
  useHosted,
  withdrawCurrentShare,
} from '../host/session';
import { SHARE_DURATIONS_DAYS } from '../host/shareRemote';
import type { ShareDurationDays } from '../host/shareRemote';
import { ShareAudioTooLargeError } from '../host/pack';
import {
  acceptOwnership,
  cancelOwnershipOffer,
  offerOwnership,
  refreshOwnershipOffers,
  TransferEmailError,
  useOwnershipOffers,
} from '../host/transfer';
import { useEditor } from '../state/store';
import { useReadOnly } from '../state/viewMode';

/**
 * Publish the open choreography for a fixed term. The owner gets an edit
 * link and a view-only link, and can offer the project to another email.
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
  const [anonymous, setAnonymous] = useState(false);
  const [duration, setDuration] = useState<ShareDurationDays>(30);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [note, setNote] = useState('');
  const [transferEmail, setTransferEmail] = useState('');
  const projectTitle = useEditor((s) => s.performance.title);
  const offers = useOwnershipOffers((s) => s.pending);

  useEffect(() => {
    void loadFirebaseConfig().then((config) => setConfigured(config !== null));
    return watchAuth((user) => {
      setUserEmail(user?.email ?? null);
      setUserUid(user?.uid ?? null);
      setAnonymous(user?.isAnonymous === true);
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
      () => {
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

  const linkId = hosted.shareId;
  const showLinks = linkId !== null && (isEditor || hosted.canEdit);
  const editUrl = showLinks && linkId !== null ? sharePageUrl(linkId, hosted.editKey) : '';
  const readUrl =
    showLinks &&
    linkId !== null &&
    (!hosted.accessLocked || (hosted.viewKey !== null && hosted.viewKey !== ''))
      ? shareReadUrl(linkId, hosted.viewKey)
      : '';
  const expiresLabel =
    hosted.expiresAtMs === null ? '' : new Date(hosted.expiresAtMs).toLocaleString(t.dateLocale);

  const copyText = (value: string, ok: string): void => {
    void navigator.clipboard.writeText(value).then(
      () => setNote(ok),
      () => setNote(value),
    );
  };

  const onOffer = (): void => {
    if (hosted.shareId === null) return;
    setBusy(true);
    setNote('');
    void offerOwnership({
      shareId: hosted.shareId,
      toEmail: transferEmail,
      title: projectTitle,
    }).then(
      (email) => {
        useHosted.setState({ pendingOwnerEmail: email });
        setNote(t.host.transferSent(email));
        setBusy(false);
      },
      (error: unknown) => {
        setBusy(false);
        if (error instanceof TransferEmailError && error.reason === 'self') {
          setNote(t.host.transferSelf);
        } else if (error instanceof TransferEmailError) {
          setNote(t.host.transferInvalid);
        } else {
          setNote(t.host.transferFailed);
        }
      },
    );
  };

  const onCancelOffer = (): void => {
    if (hosted.shareId === null || hosted.pendingOwnerEmail === null) return;
    setBusy(true);
    void cancelOwnershipOffer(hosted.shareId, hosted.pendingOwnerEmail).then(
      () => {
        useHosted.setState({ pendingOwnerEmail: null });
        setNote(t.host.transferCancelled);
        setBusy(false);
      },
      () => {
        setNote(t.host.transferFailed);
        setBusy(false);
      },
    );
  };

  const onAcceptOffer = (shareId: string): void => {
    setBusy(true);
    void acceptOwnership(shareId).then(
      () => {
        window.location.assign(sharePageUrl(shareId));
      },
      () => {
        setBusy(false);
        setNote(t.host.offerFailed);
        void refreshOwnershipOffers();
      },
    );
  };

  return (
    <>
      <button
        type="button"
        className="btn"
        title={t.host.openTitle}
        onClick={() => dialogRef.current?.showModal()}
      >
        {readOnly && !isEditor && !anonymous ? t.host.signInToEdit : t.host.open}
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
          {configured === true && userEmail === null && !anonymous && (
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
          {configured === true && (userEmail !== null || anonymous) && (
            <>
              {userEmail !== null && <p className="empty-note">{t.host.signedInAs(userEmail)}</p>}
              {anonymous && (
                <p className="empty-note">
                  {hosted.linkRevoked
                    ? t.host.linkRevoked
                    : hosted.canEdit
                      ? t.host.guestEditor
                      : t.host.guestViewer}
                </p>
              )}
              {hosted.handedOff && <p className="empty-note">{t.host.handedOff}</p>}
              {hosted.linkRevoked && userEmail !== null && (
                <p className="empty-note">{t.host.linkRevoked}</p>
              )}
              {offers.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <p className="empty-note">{t.host.offerLead}</p>
                  {offers.map((invite) => (
                    <div key={invite.shareId}>
                      <p className="empty-note">
                        {t.host.offerBody(invite.title, invite.fromEmail)}
                      </p>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={busy}
                        onClick={() => onAcceptOffer(invite.shareId)}
                      >
                        {t.host.offerAccept}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {hosted.editorUid !== null && !isEditor && !hosted.canEdit && (
                <p className="empty-note">{t.host.notEditor}</p>
              )}
              {hosted.canEdit && !isEditor && !anonymous && (
                <p className="empty-note">{t.host.editLinkKeeps}</p>
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
                  {isEditor && editUrl !== '' && (
                    <>
                      <p className="empty-note">{t.host.transferHint}</p>
                      {hosted.pendingOwnerEmail !== null && (
                        <p className="empty-note">
                          {t.host.transferPending(hosted.pendingOwnerEmail)}
                        </p>
                      )}
                      <label className="field">
                        {t.host.transferEmail}
                        <input
                          type="email"
                          autoComplete="off"
                          value={transferEmail}
                          onChange={(event) => setTransferEmail(event.target.value)}
                        />
                      </label>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button type="button" className="btn" disabled={busy} onClick={onOffer}>
                          {t.host.transferSend}
                        </button>
                        {hosted.pendingOwnerEmail !== null && (
                          <button
                            type="button"
                            className="btn"
                            disabled={busy}
                            onClick={onCancelOffer}
                          >
                            {t.host.transferCancel}
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </>
              )}
              {editUrl !== '' && (
                <>
                  {expiresLabel !== '' && (
                    <p className="empty-note">{t.host.expiresOn(expiresLabel)}</p>
                  )}
                  <label className="field">
                    {t.host.editLink}
                    <input
                      type="text"
                      readOnly
                      value={editUrl}
                      onFocus={(event) => event.target.select()}
                    />
                  </label>
                  <p className="empty-note">{t.host.editLinkHint}</p>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => copyText(editUrl, t.host.copiedEdit)}
                  >
                    {t.host.copyEdit}
                  </button>
                  {readUrl !== '' && (
                    <>
                      <label className="field">
                        {t.host.readLink}
                        <input
                          type="text"
                          readOnly
                          value={readUrl}
                          onFocus={(event) => event.target.select()}
                        />
                      </label>
                      <p className="empty-note">{t.host.readLinkHint}</p>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => copyText(readUrl, t.host.copiedRead)}
                      >
                        {t.host.copyRead}
                      </button>
                    </>
                  )}
                  {isEditor && (
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      onClick={() => {
                        if (!window.confirm(t.host.refreshLinksConfirm)) return;
                        setBusy(true);
                        setNote('');
                        void refreshCurrentShareLinks().then(
                          () => {
                            setNote(t.host.refreshLinksDone);
                            setBusy(false);
                          },
                          () => {
                            setNote(t.host.publishFailed);
                            setBusy(false);
                          },
                        );
                      }}
                    >
                      {t.host.refreshLinks}
                    </button>
                  )}
                </>
              )}
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
