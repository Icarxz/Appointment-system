import { Fragment, useMemo, useRef, useState } from 'react';
import {
  Alert, AlertIcon, Badge, Button, HStack, IconButton, Input, Modal, ModalBody, ModalCloseButton, ModalContent, ModalHeader,
  ModalOverlay, Select, Spinner, Table, TableContainer, Tbody, Td, Text, Th, Thead, Tr, VStack, useColorModeValue,
} from '@chakra-ui/react';
import { DeleteIcon } from '@chakra-ui/icons';
import { authFetch } from './authFetch';
import SchedulePdfImporter from './SchedulePdfImporter';
import type { Parsed } from './SchedulePdfImporter';
import { matchFacultyByFilename } from '../utils/facultyMatch';
import type { FacultyLite, FileMatch } from '../utils/facultyMatch';
import { friendlyError } from '../utils/friendlyError';

const API = import.meta.env.VITE_API_URL;

// Admin > Bulk import: pick several faculty schedule PDFs at once. Each file name proposes the faculty account (exact match on the normalised
// name, never a partial match); each PDF is then read by the same OCR as the single-file importer, ONE AT A TIME (the server runs one OCR at a time),
// and its printed name is compared with the proposed account. Nothing is saved here: "Review" opens the normal importer for that file
// (edit, check, effectivity date, "Are you sure?"), so every file is confirmed one by one and the server re-checks all of it.

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 10;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface HistoryRow { fileHash?: string; status: string; effectivityDate: string }
interface Item {
  id: string; file: File; match: FileMatch; facultyId: string;
  ocr: 'waiting' | 'queued' | 'reading' | 'done' | 'failed'; error: string;
  data: Parsed | null; fileHash: string;
  identity: 'unchecked' | 'checking' | 'match' | 'mismatch' | 'unreadable'; identityRead: string;
  alreadyImported: string; importState: 'pending' | 'imported' | 'scheduled';
}

interface Props { isOpen: boolean; onClose: () => void; facultyList: FacultyLite[]; onApplied?: () => void }

export default function BulkSchedulePdfImporter({ isOpen, onClose, facultyList, onApplied }: Props) {
  const muted = useColorModeValue('#64748b', '#8fa6c4');
  const [items, setItems] = useState<Item[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const itemsRef = useRef<Item[]>([]);   // the source of truth while files are being read one after another
  const pumping = useRef(false);
  const counter = useRef(1);
  const histories = useRef<Record<string, Promise<HistoryRow[]>>>({});

  const setAll = (next: Item[]) => { itemsRef.current = next; setItems(next); };
  const patch = (id: string, p: Partial<Item>) => setAll(itemsRef.current.map(i => (i.id === id ? { ...i, ...p } : i)));
  const nameOf = (facultyId: string) => facultyList.find(f => f._id === facultyId)?.name || '';

  const loadHistory = (facultyId: string): Promise<HistoryRow[]> => {
    if (!histories.current[facultyId]) {
      histories.current[facultyId] = authFetch(`${API}/api/schedule-import/history/${encodeURIComponent(facultyId)}`)
        .then(r => (r.ok ? r.json() : [])).catch(() => []);
    }
    return histories.current[facultyId];
  };

  // Read-only: does the name printed on the sheet agree with the proposed account? Is this exact PDF already in the import history?
  const checkOne = async (id: string) => {
    const it = itemsRef.current.find(i => i.id === id);
    if (!it || !it.data || !it.facultyId) return;
    patch(id, { identity: 'checking', alreadyImported: '' });
    let identity: Item['identity'] = 'unreadable', read = '';
    try {
      const res = await authFetch(`${API}/api/schedule-import/validate`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facultyId: it.facultyId, classes: it.data.classes, consultationHours: it.data.consultationHours, metadata: it.data.metadata, workload: it.data.workload, identityConfirmed: false }) });
      const rep = await res.json().catch(() => ({}));
      if (res.ok && rep.identity && (rep.identity.status === 'match' || rep.identity.status === 'mismatch')) { identity = rep.identity.status; read = rep.identity.read || ''; }
      else if (res.ok && rep.identity) read = rep.identity.read || '';
    } catch { /* leave as unreadable: the admin confirms the owner in the review step */ }
    let already = '';
    if (it.fileHash) {
      const hist = await loadHistory(it.facultyId);
      const hit = hist.find(h => h.fileHash === it.fileHash && ['ACTIVE', 'SCHEDULED', 'SUPERSEDED'].includes(h.status));
      if (hit) already = `This exact PDF was already imported (effective ${hit.effectivityDate}).`;
    }
    patch(id, { identity, identityRead: read, alreadyImported: already });
  };

  const readOne = async (it: Item) => {
    let message = 'Could not read that PDF.';
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await authFetch(`${API}/api/schedule-import/preview?facultyId=${encodeURIComponent(it.facultyId)}`, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: it.file });
        const data = await res.json().catch(() => ({}));
        if (res.ok) { patch(it.id, { ocr: 'done', data, fileHash: data.fileHash || '', error: '' }); await checkOne(it.id); return; }
        message = data.error || message;
        if (data.code === 'OCR_BUSY' && attempt < 3) { await sleep(6000); continue; } // another reader is running: wait and try again
        break;
      } catch (error) { message = friendlyError(error, 'Could not reach the server.'); break; }
    }
    patch(it.id, { ocr: 'failed', error: message });
  };

  // One file at a time. A failure only marks that file; the others carry on.
  const pump = async () => {
    if (pumping.current) return;
    pumping.current = true;
    try {
      for (;;) {
        const next = itemsRef.current.find(i => i.facultyId && i.ocr === 'queued');
        if (!next) break;
        patch(next.id, { ocr: 'reading' });
        await readOne(next);
      }
    } finally { pumping.current = false; }
  };

  const addFiles = (files: File[]) => {
    const list = [...itemsRef.current]; const issues: string[] = [];
    for (const file of files) {
      if (list.length >= MAX_FILES) { issues.push(`Only ${MAX_FILES} files at a time. The rest were left out.`); break; }
      if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { issues.push(`${file.name}: not a PDF.`); continue; }
      if (file.size > MAX_BYTES) { issues.push(`${file.name}: larger than 10 MB.`); continue; }
      if (list.some(i => i.file.name === file.name && i.file.size === file.size)) { issues.push(`${file.name}: already in the list.`); continue; }
      const match = matchFacultyByFilename(file.name, facultyList);
      const auto = match.status === 'matched';
      list.push({ id: `f${counter.current++}`, file, match, facultyId: auto ? match.candidates[0]._id : '', ocr: auto ? 'queued' : 'waiting', error: '', data: null, fileHash: '',
        identity: 'unchecked', identityRead: '', alreadyImported: '', importState: 'pending' });
    }
    setAll(list); setProblems(issues); pump();
  };

  const assign = (id: string, facultyId: string) => {
    const it = itemsRef.current.find(i => i.id === id); if (!it) return;
    if (it.data) { patch(id, { facultyId, identity: facultyId ? 'checking' : 'unchecked', alreadyImported: '' }); if (facultyId) checkOne(id); }   // already read: only re-check the name
    else { patch(id, { facultyId, ocr: facultyId ? 'queued' : 'waiting' }); if (facultyId) pump(); }
  };
  const retry = (id: string) => { patch(id, { ocr: 'queued', error: '' }); pump(); };
  const remove = (id: string) => { setAll(itemsRef.current.filter(i => i.id !== id)); setSkipped(n => n + 1); };
  const reset = () => { setAll([]); setProblems([]); setSkipped(0); setReviewId(null); histories.current = {}; };
  const close = () => { reset(); onClose(); };

  // Flags that depend on the whole batch
  const flags = useMemo(() => {
    const firstByHash: Record<string, string> = {}; const perFaculty: Record<string, number> = {};
    items.forEach(i => { if (i.fileHash && !firstByHash[i.fileHash]) firstByHash[i.fileHash] = i.file.name; if (i.facultyId && i.importState === 'pending') perFaculty[i.facultyId] = (perFaculty[i.facultyId] || 0) + 1; });
    return { firstByHash, perFaculty };
  }, [items]);

  const counts = useMemo(() => {
    const imported = items.filter(i => i.importState === 'imported').length, scheduled = items.filter(i => i.importState === 'scheduled').length;
    const pending = items.filter(i => i.importState === 'pending');
    const attention = pending.filter(i => !i.facultyId || i.ocr === 'failed' || i.identity === 'mismatch').length;
    const busyNow = pending.filter(i => i.facultyId && i.ocr !== 'failed' && i.identity !== 'mismatch' && (i.ocr === 'queued' || i.ocr === 'reading' || i.identity === 'checking')).length;
    return { imported, scheduled, attention, busyNow, ready: pending.length - attention - busyNow };
  }, [items]);

  const reviewItem = items.find(i => i.id === reviewId) || null;
  const canReview = (i: Item) => i.importState === 'pending' && i.ocr === 'done' && !!i.data && !!i.facultyId && i.identity !== 'mismatch' && i.identity !== 'checking';

  const statusCell = (i: Item) => {
    if (i.importState === 'imported') return <Badge colorScheme="green">Imported</Badge>;
    if (i.importState === 'scheduled') return <Badge colorScheme="blue">Scheduled</Badge>;
    if (!i.facultyId) return <Badge colorScheme="orange">Choose faculty</Badge>;
    if (i.ocr === 'failed') return <Badge colorScheme="red">Failed</Badge>;
    if (i.ocr !== 'done' || i.identity === 'checking') return <Badge>{i.ocr === 'queued' ? 'Waiting' : 'Reading'}</Badge>;
    if (i.identity === 'mismatch') return <Badge colorScheme="red">Name differs</Badge>;
    if (i.alreadyImported || (i.fileHash && flags.firstByHash[i.fileHash] !== i.file.name)) return <Badge colorScheme="orange">Duplicate</Badge>;
    return <Badge colorScheme="green">Ready to review</Badge>;
  };

  const notes = (i: Item): { text: string; bad?: boolean }[] => {
    const out: { text: string; bad?: boolean }[] = [];
    if (i.match.status === 'ambiguous' && !i.facultyId) out.push({ text: `More than one faculty account fits "${i.file.name}". Choose the right one.`, bad: true });
    if (i.match.status === 'unmatched' && !i.facultyId) out.push({ text: 'No faculty account has this name. Choose the faculty to continue.', bad: true });
    if (i.ocr === 'failed') out.push({ text: i.error, bad: true });
    if (i.identity === 'mismatch') out.push({ text: `The name printed on the sheet ("${i.identityRead}") does not match ${nameOf(i.facultyId)}. Choose the right account or remove this file.`, bad: true });
    if (i.identity === 'unreadable' && i.ocr === 'done') out.push({ text: 'The printed name could not be read reliably. You will confirm the owner yourself in the review step.' });
    if (i.alreadyImported) out.push({ text: i.alreadyImported });
    if (i.fileHash && flags.firstByHash[i.fileHash] !== i.file.name) out.push({ text: `Same file as ${flags.firstByHash[i.fileHash]} in this batch.` });
    if (i.facultyId && i.importState === 'pending' && flags.perFaculty[i.facultyId] > 1) out.push({ text: `Another file in this batch is also for ${nameOf(i.facultyId)}. Importing both would replace the first with the second.` });
    return out;
  };

  return (
    <>
      <Modal isOpen={isOpen} onClose={close} size="6xl" scrollBehavior="inside" closeOnOverlayClick={false}>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Import faculty schedule (PDFs)</ModalHeader>
          <ModalCloseButton />
          <ModalBody pb={6}>
            <VStack align="stretch" spacing={4}>
              <Alert status="info" borderRadius="md"><AlertIcon />
                <Text fontSize="sm">Choose up to {MAX_FILES} Faculty Individual Load PDFs (10 MB each) named after the faculty member, for example <b>Carl Spence.pdf</b> or <b>CARL_SPENCE.pdf</b>. Each file is matched to an account by its name and read one after another. Nothing is saved until you press Review and confirm that file.</Text>
              </Alert>
              <Input type="file" multiple accept="application/pdf,.pdf" pt={1} aria-label="Schedule PDFs" onChange={e => { addFiles(Array.from(e.target.files || [])); e.target.value = ''; }} />
              {problems.map((p, i) => <Alert key={i} status="warning" borderRadius="md" py={1}><AlertIcon /><Text fontSize="sm">{p}</Text></Alert>)}

              {items.length > 0 && (
                <HStack spacing={2} wrap="wrap" fontSize="sm">
                  <Badge colorScheme="green">{counts.imported} imported</Badge>
                  <Badge colorScheme="blue">{counts.scheduled} scheduled</Badge>
                  <Badge colorScheme="teal">{counts.ready} ready to review</Badge>
                  <Badge colorScheme="orange">{counts.attention} need attention</Badge>
                  {counts.busyNow > 0 && <HStack spacing={1}><Spinner size="xs" /><Text color={muted}>{counts.busyNow} still being read</Text></HStack>}
                  {skipped > 0 && <Badge>{skipped} skipped</Badge>}
                </HStack>
              )}

              {items.length > 0 && (
                <TableContainer>
                  <Table size="sm">
                    <Thead><Tr><Th>PDF</Th><Th>Faculty</Th><Th>Status</Th><Th>Read</Th><Th /></Tr></Thead>
                    <Tbody>
                      {items.map(i => {
                        const options = i.match.status === 'ambiguous' ? i.match.candidates : facultyList;
                        const n = notes(i);
                        return (
                          <Fragment key={i.id}>
                            <Tr>
                              <Td maxW="220px" whiteSpace="normal" wordBreak="break-all" fontSize="xs">{i.file.name}</Td>
                              <Td>
                                <Select size="sm" minW="200px" value={i.facultyId} aria-label={`Faculty for ${i.file.name}`} placeholder="Choose faculty..."
                                  isDisabled={i.importState !== 'pending' || i.ocr === 'reading'} onChange={e => assign(i.id, e.target.value)}>
                                  {options.map(f => <option key={f._id} value={f._id}>{f.name}</option>)}
                                </Select>
                              </Td>
                              <Td>{statusCell(i)}</Td>
                              <Td fontSize="xs" color={muted} whiteSpace="normal">
                                {i.ocr === 'reading' ? <HStack><Spinner size="xs" /><Text>Reading...</Text></HStack>
                                  : i.data ? `${i.data.classes.length} classes, ${i.data.consultationHours.length} consult blocks` : i.ocr === 'queued' ? 'Waiting for its turn' : ''}
                              </Td>
                              <Td>
                                <HStack spacing={1} justify="flex-end">
                                  {i.ocr === 'failed' && <Button size="xs" variant="outline" onClick={() => retry(i.id)}>Retry</Button>}
                                  {i.importState === 'pending' && <Button size="xs" colorScheme="blue" isDisabled={!canReview(i)} onClick={() => setReviewId(i.id)}>{i.alreadyImported ? 'Review anyway' : 'Review'}</Button>}
                                  {i.importState === 'pending' && <IconButton size="xs" variant="ghost" aria-label={`Remove ${i.file.name}`} icon={<DeleteIcon />} isDisabled={i.ocr === 'reading'} onClick={() => remove(i.id)} />}
                                </HStack>
                              </Td>
                            </Tr>
                            {n.length > 0 && (
                              <Tr><Td colSpan={5} py={1} borderTop="none">
                                {n.map((x, k) => <Text key={k} fontSize="xs" fontWeight={x.bad ? 600 : 400} color={x.bad ? 'red.500' : muted} whiteSpace="normal">{x.text}</Text>)}
                              </Td></Tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </Tbody>
                  </Table>
                </TableContainer>
              )}

              {items.length > 0 && counts.ready + counts.attention + counts.busyNow === 0 && (
                <Alert status="success" borderRadius="md"><AlertIcon />
                  <Text fontSize="sm"><b>All files handled.</b> {counts.imported} imported, {counts.scheduled} scheduled{skipped ? `, ${skipped} skipped` : ''}.</Text>
                </Alert>
              )}
              <HStack justify="space-between">
                <Button variant="ghost" onClick={reset} isDisabled={items.length === 0}>Clear list</Button>
                <Button onClick={close}>Close</Button>
              </HStack>
            </VStack>
          </ModalBody>
        </ModalContent>
      </Modal>

      {reviewItem && reviewItem.data && (
        <SchedulePdfImporter key={reviewItem.id} mode="admin" facultyId={reviewItem.facultyId} facultyName={nameOf(reviewItem.facultyId)} isOpen
          initial={{ data: reviewItem.data, fileHash: reviewItem.fileHash }}
          onClose={() => setReviewId(null)}
          onApplied={() => onApplied?.()}
          onDone={status => { delete histories.current[reviewItem.facultyId]; patch(reviewItem.id, { importState: status === 'ACTIVE' ? 'imported' : 'scheduled' }); }} />
      )}
    </>
  );
}
