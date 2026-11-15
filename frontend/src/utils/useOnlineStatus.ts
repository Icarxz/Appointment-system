import { useCallback, useEffect, useRef, useState } from 'react';
import { checkConnection } from './connection';

const RETRY_MS = 8000;       // while offline, check again this often
const MIN_GAP_MS = 3000;     // never probe more often than this (a burst of failed requests is one check)
const BACK_ONLINE_MS = 3200; // how long "Back online" stays on screen

/**
 * The real connection state, not just the browser's guess. It re-checks when
 *   - the browser fires online / offline,
 *   - a request made through authFetch fails at the network level ("sync:network-error"),
 *   - the tab comes back into view,
 *   - and every few seconds while offline.
 */
export function useOnlineStatus() {
  const [online, setOnline] = useState<boolean>(() => navigator.onLine);
  const [checking, setChecking] = useState(false);
  const [justBack, setJustBack] = useState(false);
  const onlineRef = useRef(online);
  const busyRef = useRef(false);
  const lastRef = useRef(0);

  const recheck = useCallback(async (force = true) => {
    if (busyRef.current) return;
    if (!force && Date.now() - lastRef.current < MIN_GAP_MS) return;
    busyRef.current = true;
    setChecking(true);
    const ok = await checkConnection();
    busyRef.current = false;
    lastRef.current = Date.now();
    setChecking(false);
    if (ok && !onlineRef.current) {
      setJustBack(true);
      window.setTimeout(() => setJustBack(false), BACK_ONLINE_MS);
    }
    onlineRef.current = ok;
    setOnline(ok);
  }, []);

  useEffect(() => {
    const goOffline = () => { onlineRef.current = false; setOnline(false); };
    const verify = () => { void recheck(false); };
    const onVisible = () => { if (document.visibilityState === 'visible') verify(); };
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', verify);              // "online" only means an adapter is connected: confirm it
    window.addEventListener('sync:network-error', verify);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', verify);
      window.removeEventListener('sync:network-error', verify);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [recheck]);

  useEffect(() => {
    if (online) return;
    const id = window.setInterval(() => { void recheck(false); }, RETRY_MS);
    return () => window.clearInterval(id);
  }, [online, recheck]);

  return { online, checking, justBack, recheck: () => recheck(true) };
}
