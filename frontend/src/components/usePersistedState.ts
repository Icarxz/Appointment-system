import { useCallback, useState } from 'react';

// Like useState for a short string (the open page / tab), but it survives a browser reload.
// It is kept in sessionStorage, so it is per browser tab and is forgotten when the tab is closed.
// If the saved value is not one of `allowed` (for example a page that no longer exists), `initial` is used.
export function usePersistedState<T extends string>(key: string, initial: T, allowed?: readonly T[]) {
  const storageKey = `ccis-sync:${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = sessionStorage.getItem(storageKey) as T | null;
      if (saved && (!allowed || allowed.includes(saved))) return saved;
    } catch { /* storage blocked: fall back to the default */ }
    return initial;
  });
  const set = useCallback((next: T) => {
    setValue(next);
    try { sessionStorage.setItem(storageKey, next); } catch { /* ignore */ }
  }, [storageKey]);
  return [value, set] as const;
}

export default usePersistedState;
