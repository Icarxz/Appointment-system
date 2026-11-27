import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

export function usePersistentPage<P extends string>(
  storageKey: string,
  validPages: readonly P[],
  defaultPage: P,
  forcedPage?: P,
  persist = true,
): [P, Dispatch<SetStateAction<P>>] {
  const [page, setPage] = useState<P>(() => {
    if (forcedPage) return forcedPage;
    const stored = localStorage.getItem(storageKey);
    return stored && (validPages as readonly string[]).includes(stored) ? stored as P : defaultPage;
  });

  useEffect(() => {
    if (persist && !forcedPage) localStorage.setItem(storageKey, page);
  }, [storageKey, page, forcedPage, persist]);

  return [page, setPage];
}
