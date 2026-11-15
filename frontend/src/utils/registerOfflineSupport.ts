// Registers the tiny service worker (public/sw.js). Its only job: when the page itself cannot be loaded because there is
// no connection at all, show public/offline.html instead of the browser's "No internet" dinosaur. It caches nothing
// else, so it can never serve an outdated version of the app. Only runs in the production build, over https
// (or localhost), as browsers require.
export function registerOfflineSupport(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      // Offline support is a bonus: if it cannot be set up, the app simply works as before.
    });
  });
}
