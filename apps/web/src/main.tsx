// Imported first: its top-level side effect migrates openstage-* localStorage
// keys to gridstage-* before any zustand-persist store hydrates below.
import { migrateMediaDatabases } from './state/brandMigration';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/roboto/wght.css';
import '@fontsource/roboto-mono/latin-400.css';
import './index.css';
import { App } from './App';
import { consumeSharedDoc } from './state/shareTarget';
import { listenDesktopOpenDoc } from './state/desktopOpen';

const rootEl = document.getElementById('root');
if (rootEl === null) {
  throw new Error('Root element #root not found');
}

// Copy pre-rebrand IndexedDB data (audio, backgrounds, history) before the app
// reads it, then render regardless of whether the migration succeeded.
void migrateMediaDatabases().finally(() => {
  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  // Files arriving from outside the app: Android share sheet, desktop
  // double-click. After render so the imported doc lands in a live UI.
  void consumeSharedDoc();
  listenDesktopOpenDoc();
});

// PWA: offline app shell + installability. Production only — a service
// worker on the dev server would serve stale modules mid-edit.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
  });
}
