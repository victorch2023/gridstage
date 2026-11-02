import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { watchAuth } from '../host/firebase';
import { sharePageUrl } from '../host/session';
import { acceptOwnership, refreshOwnershipOffers, useOwnershipOffers } from '../host/transfer';
import { useT } from '../i18n';

/**
 * Popup for the account whose email was offered a project. Accepting moves
 * editorUid. "Not now" leaves the offer in Publicar so the button stays.
 */
export function TransferOffer(): ReactElement | null {
  const t = useT();
  const pending = useOwnershipOffers((s) => s.pending);
  const [signedIn, setSignedIn] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(
    () =>
      watchAuth((user) => {
        setSignedIn(user !== null);
        if (user === null) {
          useOwnershipOffers.getState().setPending([]);
          setDismissed(false);
          return;
        }
        void refreshOwnershipOffers();
      }),
    [],
  );

  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState === 'visible' && signedIn) void refreshOwnershipOffers();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [signedIn]);

  const open = signedIn && !dismissed && pending.length > 0;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      className="export-dialog host-dialog"
      aria-label={t.host.offerTitle}
      onClose={() => setDismissed(true)}
    >
      <div className="export-dialog-head">
        <span className="panel-title" style={{ margin: 0 }}>
          {t.host.offerTitle}
        </span>
        <button type="button" className="btn" onClick={() => dialogRef.current?.close()}>
          {t.host.offerLater}
        </button>
      </div>
      <div className="host-dialog-body">
        <p className="empty-note">{t.host.offerLead}</p>
        {pending.map((invite) => (
          <div key={invite.shareId} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p className="empty-note">{t.host.offerBody(invite.title, invite.fromEmail)}</p>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busyId !== null}
              onClick={() => {
                setBusyId(invite.shareId);
                setFailed(false);
                void acceptOwnership(invite.shareId).then(
                  () => {
                    window.location.assign(sharePageUrl(invite.shareId));
                  },
                  () => {
                    setBusyId(null);
                    setFailed(true);
                  },
                );
              }}
            >
              {t.host.offerAccept}
            </button>
          </div>
        ))}
        {failed && <p className="empty-note">{t.host.offerFailed}</p>}
      </div>
    </dialog>
  );
}
