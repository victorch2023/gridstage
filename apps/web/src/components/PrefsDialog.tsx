import { useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { getLocalUser, setLocalUserName } from '../state/user';
import { setAwarenessUser } from '../collab/collab';
import { useLayout } from '../state/layout';
import { isLocale, useLocaleStore, useT } from '../i18n';

/**
 * Personal preferences (browser-level, not part of the document): display
 * name and language. Lives behind the ⚙ button to keep the top bar lean.
 */
export function PrefsDialog(): ReactElement {
  const t = useT();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);
  const uiMode = useLayout((s) => s.uiMode);
  const setUiMode = useLayout((s) => s.setUiMode);
  const [userName, setUserName] = useState(() => getLocalUser().name);

  return (
    <>
      <button
        type="button"
        className="btn"
        aria-label={t.prefs.openAria}
        title={t.prefs.title}
        onClick={() => dialogRef.current?.showModal()}
      >
        ⚙
      </button>
      <dialog ref={dialogRef} className="export-dialog" aria-label={t.prefs.title}>
        <div className="export-dialog-head">
          <span className="panel-title" style={{ margin: 0 }}>
            {t.prefs.title}
          </span>
          <button type="button" className="btn" onClick={() => dialogRef.current?.close()}>
            {t.prefs.close}
          </button>
        </div>
        <div className="dialog-fields">
          <div className="field">
            <label htmlFor="prefs-name">{t.topbar.displayNameAria}</label>
            <input
              id="prefs-name"
              type="text"
              title={t.topbar.displayNameTitle}
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              onBlur={() => {
                const user = setLocalUserName(userName);
                setUserName(user.name);
                setAwarenessUser(user.name, user.color);
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="prefs-uimode">{t.prefs.uiMode}</label>
            <select
              id="prefs-uimode"
              value={uiMode}
              onChange={(e) => setUiMode(e.target.value === 'expert' ? 'expert' : 'easy')}
            >
              <option value="easy">{t.prefs.uiModeEasy}</option>
              <option value="expert">{t.prefs.uiModeExpert}</option>
            </select>
            <span className="mono">{t.prefs.uiModeNote}</span>
          </div>
          <div className="field">
            <label htmlFor="prefs-locale">{t.locale.label}</label>
            <select
              id="prefs-locale"
              value={locale}
              onChange={(e) => {
                if (isLocale(e.target.value)) setLocale(e.target.value);
              }}
            >
              <option value="es">{t.locale.spanish}</option>
              <option value="en">{t.locale.english}</option>
              <option value="zh">{t.locale.chinese}</option>
            </select>
          </div>
        </div>
      </dialog>
    </>
  );
}
