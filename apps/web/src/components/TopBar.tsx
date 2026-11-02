import { useState } from 'react';
import type { ReactElement } from 'react';
import { useEditor } from '../state/store';
import { formatEightCount, formatTimecode } from '../state/interpolate';
import { getLocalUser } from '../state/user';
import { collabRoom, followedPeerId, isCollabActive, setFollowPeer } from '../collab/collab';
import { usePeers } from '../hooks/usePeers';
import { useReadOnly } from '../state/viewMode';
import { useHosted } from '../host/session';
import { HostDialog } from './HostDialog';
import { useT } from '../i18n';
import { ExportDialog } from './ExportDialog';
import { LibraryDialog } from './LibraryDialog';
import { PrefsDialog } from './PrefsDialog';
import { GuideDialog } from './GuideDialog';

export function TopBar(): ReactElement {
  const t = useT();
  const readOnly = useReadOnly((s) => s.readOnly);
  const hostedShare = useHosted((s) => s.shareId);
  const title = useEditor((s) => s.performance.title);
  const bpm = useEditor((s) => s.performance.bpm);
  const countSegments = useEditor((s) => s.performance.countSegments);
  const setTitle = useEditor((s) => s.setTitle);
  const playheadMs = useEditor((s) => s.playheadMs);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const eightCount = bpm !== null ? formatEightCount(playheadMs, bpm, countSegments) : null;

  const peers = usePeers();
  const [shareNote, setShareNote] = useState('');

  const onShare = (): void => {
    if (!isCollabActive()) {
      const roomId = crypto.randomUUID().slice(0, 8);
      const url = new URL(window.location.href);
      url.searchParams.set('room', roomId);
      window.location.href = url.toString(); // reload into the session
      return;
    }
    void navigator.clipboard.writeText(window.location.href).then(
      () => setShareNote(t.topbar.linkCopied),
      () => setShareNote(window.location.href),
    );
    window.setTimeout(() => setShareNote(''), 2500);
  };

  return (
    <header className="topbar">
      <span className="wordmark">
        Grid<em>Stage</em>
      </span>
      <input
        type="text"
        className="topbar-title"
        aria-label={t.topbar.performanceTitleAria}
        value={title}
        readOnly={readOnly}
        onChange={(e) => setTitle(e.target.value)}
      />
      {!readOnly && <LibraryDialog />}
      {readOnly && hostedShare !== null && (
        <span className="mono" title={t.host.editorNote}>
          {t.host.readerBanner}
        </span>
      )}
      <button type="button" className="btn edit-only" onClick={undo} title={t.topbar.undoTitle}>
        {t.topbar.undo}
      </button>
      <button type="button" className="btn edit-only" onClick={redo} title={t.topbar.redoTitle}>
        {t.topbar.redo}
      </button>
      <span className="topbar-spacer" />
      {isCollabActive() && (
        <span className="presence" aria-label={t.topbar.peopleInSession(peers.length + 1)}>
          <span
            className="presence-dot"
            style={{ background: getLocalUser().color }}
            title={t.topbar.youTag(getLocalUser().name)}
          />
          {peers.map((p) => {
            const following = followedPeerId() === p.clientId;
            return (
              <button
                key={p.clientId}
                type="button"
                className={`presence-follow${following ? ' following' : ''}`}
                title={following ? t.topbar.unfollow(p.name) : t.topbar.follow(p.name)}
                aria-pressed={following}
                onClick={() => setFollowPeer(following ? null : p.clientId)}
              >
                <span className="presence-dot" style={{ background: p.color }} />
              </button>
            );
          })}
        </span>
      )}
      <button type="button" className="btn edit-only" onClick={onShare}>
        {isCollabActive() ? t.topbar.copyLink(collabRoom() ?? '') : t.topbar.shareLive}
      </button>
      {isCollabActive() && !readOnly && (
        <button
          type="button"
          className="btn"
          title={t.topbar.viewLinkTitle}
          onClick={() => {
            const url = new URL(window.location.href);
            url.searchParams.set('mode', 'view');
            void navigator.clipboard.writeText(url.toString()).then(
              () => setShareNote(t.topbar.viewLinkCopied),
              () => setShareNote(url.toString()),
            );
            window.setTimeout(() => setShareNote(''), 2500);
          }}
        >
          {t.topbar.viewLink}
        </button>
      )}
      {shareNote !== '' && (
        <span className="mono" role="status">
          {shareNote}
        </span>
      )}
      <span className="timecode" aria-label={t.topbar.playheadAria}>
        {formatTimecode(playheadMs)}
        {eightCount !== null ? `  ${eightCount}` : ''}
      </span>
      <HostDialog />
      <GuideDialog />
      <ExportDialog />
      <PrefsDialog />
    </header>
  );
}
