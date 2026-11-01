import { useState } from 'react';
import { Button, HStack, useColorMode, useToast } from '@chakra-ui/react';
import { authFetch } from './authFetch';

// Download the report as a CSV file (built on the server, so its formula-injection guard cannot be skipped)
// or print it / save it as a PDF through the browser's print dialog. No PDF library is used.
// The print layout hides this bar and the navigation (see index.css).
export default function ExportBar({ csvPath, fileBase }: { csvPath: string; fileBase: string }) {
  const toast = useToast();
  const { colorMode, setColorMode } = useColorMode();
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

  // Paper is white, so a dark theme would print light text on a white page. Switch to the light theme for
  // the print dialog and put the person's own theme back afterwards.
  const print = () => {
    const previous = colorMode;
    document.body.classList.add('printing-report');
    if (previous !== 'light') setColorMode('light');
    window.addEventListener('afterprint', () => {
      document.body.classList.remove('printing-report');
      if (previous !== 'light') setColorMode(previous);
    }, { once: true });
    setTimeout(() => window.print(), 350); // give the light theme a moment to paint first
  };

  return (
    <HStack spacing={2} className="no-print">
      <Button size="xs" variant="outline" onClick={download} isLoading={busy}>Download CSV</Button>
      <Button size="xs" variant="outline" onClick={print}>Print / Save as PDF</Button>
    </HStack>
  );
}
