import { createContext, useContext } from 'react';
import type { ImportSessionContextValue } from './ImportSessionContext';

export const ImportSessionContext = createContext<ImportSessionContextValue | null>(null);

export function useImportSession(): ImportSessionContextValue {
  const ctx = useContext(ImportSessionContext);
  if (!ctx) throw new Error('useImportSession must be used within an ImportSessionProvider');
  return ctx;
}
