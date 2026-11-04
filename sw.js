/**
 * GridStage service worker — network-first with a cache fallback, so the
 * editor still opens without a connection after the first visit (documents
 * live in localStorage/IndexedDB anyway; only the app shell needs caching).
 * ponytail: no precache manifest — the first online visit fills the cache.
 */
const CACHE = 'gridstage-v1';
// Holds a file handed over by the Android share sheet until the page reads it.
const SHARE_CACHE = 'gridstage-share';
const SHARED_DOC_KEY = 'shared-doc';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE && k !== SHARE_CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/**
 * Android share sheet → PWA: the OS POSTs the shared file to
 * `<scope>share-target` (declared in manifest.webmanifest). Stash the text in
 * a cache and redirect to the app, which imports it on load (see
 * state/shareTarget.ts). 303 turns the POST into a plain GET navigation.
 */
async function handleShareTarget(event) {
  let text = null;
  try {
    const form = await event.request.formData();
    const file = form.get('doc');
    if (file !== null && typeof file.text === 'function') text = await file.text();
  } catch {
    // Malformed POST — fall through to the app without a stashed doc.
  }
  if (text !== null) {
    const cache = await caches.open(SHARE_CACHE);
    await cache.put(SHARED_DOC_KEY, new Response(text));
  }
  return Response.redirect(self.registration.scope + '?shared-doc=1', 303);
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    event.respondWith(handleShareTarget(event));
    return;
  }
  if (event.request.method !== 'GET') return;
  // Live endpoints must never be served stale.
  if (url.pathname.startsWith('/collab') || url.pathname.startsWith('/api')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request, {
          ignoreSearch: event.request.mode === 'navigate',
        });
        if (cached !== undefined) return cached;
        if (event.request.mode === 'navigate') {
          // Scope-relative: the app may be hosted at a subpath (GitHub Pages).
          const shell = await caches.match(self.registration.scope, { ignoreSearch: true });
          if (shell !== undefined) return shell;
        }
        return Response.error();
      }),
  );
});
