import { useState } from 'react';
import { Button, HStack, useToast } from '@chakra-ui/react';
import { DownloadIcon } from '@chakra-ui/icons';
import { usePrintReport } from '../utils/printReport';
import { authFetch } from './authFetch';

// Download the report as a CSV file (built on the server, so its formula-injection guard cannot be skipped)
// or print it / save it as a PDF through the browser's print dialog. No PDF library is used.
// The print layout hides this bar and the navigation (see index.css).
// solid = the dark buttons used in the page header bar.
export default function ExportBar({ csvPath, fileBase, solid = false }: { csvPath: string; fileBase: string; solid?: boolean }) {
  const toast = useToast();
  const print = usePrintReport();
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    try {
      const res = await authFetch(`${import.meta.env.VITE_API_URL}${csvPath}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not export.');
      const url = URL.createObjectURL(await res.blob());
      const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }); // YYYY-MM-DD
      const a = document.createElement('a');
      a.href = url; a.download = `${fileBase}-${day}.csv`; document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast({ title: 'Export failed', description: e.message, status: 'error', position: 'top' });
    }
    setBusy(false);
  };

  const look = solid
    ? { size: 'sm', bg: '#0f2240', color: 'white', _hover: { bg: '#1b3358' }, _active: { bg: '#0b1a33' } }
    : { size: 'xs', variant: 'outline' as const };

  return (
    <HStack spacing={2} className="no-print">
      <Button {...look} leftIcon={solid ? <DownloadIcon /> : undefined} onClick={download} isLoading={busy}>Download CSV</Button>
      <Button {...look} leftIcon={solid ? <PrintIcon /> : undefined} onClick={print}>Print / Save as PDF</Button>
    </HStack>
  );
}

const PrintIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 9V3h12v6" /><rect x="3" y="9" width="18" height="9" rx="2" /><path d="M6 14h12v7H6z" />
  </svg>
);
