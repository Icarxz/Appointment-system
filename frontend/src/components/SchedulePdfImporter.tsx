import { Fragment, useMemo, useState } from 'react';
import {
  Alert, AlertIcon, Badge, Box, Button, Checkbox, HStack, IconButton, Input, Modal, ModalBody, ModalCloseButton, ModalContent,
  ModalHeader, ModalOverlay, Select, Spinner, Table, TableContainer, Tbody, Td, Text, Th, Thead, Tr, VStack, useColorModeValue, useToast,
} from '@chakra-ui/react';
import { DeleteIcon } from '@chakra-ui/icons';
import ConfirmAction from './ConfirmAction';
import type { ConfirmConfig } from './ConfirmAction';
import { authFetch } from './authFetch';
import { DAY_LONG, CONSULTATION_DAYS, CLASS_DAYS } from '../utils/daySettings';
import type { ImportIssue } from '../context/ImportSessionContext';
import { useImportSession } from '../context/ImportSessionContextCore';

const API = import.meta.env.VITE_API_URL;

// Faculty Schedule PDF Importer (phases 4-6): upload the scanned PDF, REVIEW and CHECK the draft, then CONFIRM it. Only the final confirm
// (after an "Are you sure?") changes anything: it replaces the class schedule and official consultation hours, or stages them for a future
// effectivity date. The server checks everything again; the previous schedule is kept in the import history and can be undone. Used from three places: Admin > Class Schedules, Admin > Provision Account
// and Faculty > Master Schedule. Admins can also load a draft JSON written by ocr/schedule_ocr.py (fallback while OCR hosting is undecided).

interface Row { id: string; dayOfWeek: number; startTime: string; endTime: string; needsReview: boolean; reviewReasons: string[]; rawText?: string;
  subject?: string; section?: string; room?: string; label?: string }
// 07:00 ... 19:00 in 30-minute steps: a list to pick from, so a misaligned time cannot be typed
const TIMES = Array.from({ length: 25 }, (_, i) => { const m = 420 + i * 30; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; });
const t12 = (t: string) => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };

interface HistoryItem { id: string; status: string; effectivityDate: string; term: string; academicYear: string; confirmedAt: string; failureReason: string; classBlocks: number; consultationBlocks: number }

interface Props { facultyId: string; facultyName: string; mode: 'admin' | 'faculty'; isOpen: boolean }

export default function SchedulePdfImporter({ facultyId, facultyName, mode, isOpen }: Props) {
  const { state, actions } = useImportSession();
  const toast = useToast();
  const muted = useColorModeValue('#64748b', '#8fa6c4');
  const errBg = useColorModeValue('#fee2e2', '#4c1d1d');
  const warnBg = useColorModeValue('#fef3c7', '#4a3a12');
  const { parsed, classes, hours, identity, report, busy, reading, uploadError, fileHash, effDate, outcome, confirming } = state;
  const [confirmCfg, setConfirmCfg] = useState<ConfirmConfig | null>(null);
  const [history, setHistory] = useState<HistoryItem[] | null>(null);

  const reset = actions.resetDraft;
  const close = actions.minimize;

  // Step 1a: upload the scanned PDF; the server reads it with OCR and sends back editable rows
  const uploadPdf = actions.uploadPdf;
  const loadFile = actions.loadFile;
  const editClass = actions.editClass;
  const editHour = actions.editHour;
  const addClass = actions.addClass;
  const addHour = actions.addHour;
  const check = actions.check;
  const confirm = actions.confirm;
  const askConfirm = () => {
    const future = /^\d{4}-\d{2}-\d{2}$/.test(effDate) && effDate > new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
    setConfirmCfg({
      title: future ? 'Schedule this class schedule?' : 'Replace the current schedule?',
      body: future
        ? <>The new schedule for <b>{facultyName}</b> will start on <b>{effDate}</b>. Until then the current schedule stays. It is checked again on that day.</>
        : <>This replaces all of <b>{facultyName}</b>'s classes and official consultation hours with the {classes.length} class(es) and {hours.length} consultation block(s) shown here. The old schedule is kept in the import history and can be undone. Appointments are not changed.</>,
      confirmLabel: future ? 'Schedule it' : 'Replace schedule', run: confirm,
    });
  };
  const loadHistory = async () => {
    try {
      const res = await authFetch(`${API}/api/schedule-import/history/${encodeURIComponent(facultyId)}`);
      const data = await res.json();
      setHistory(res.ok ? data : []);
      if (!res.ok) toast({ title: 'Could not load the history', description: data.error, status: 'error', duration: 4000 });
    } catch { toast({ title: 'Could not reach the server', status: 'error', duration: 4000 }); }
  };
  const act = async (id: string, what: 'rollback' | 'cancel') => {
    try {
      const res = await authFetch(`${API}/api/schedule-import/${id}/${what}`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast({ title: what === 'rollback' ? 'Could not undo' : 'Could not cancel', description: data.error, status: 'error', duration: 7000, isClosable: true }); return; }
      toast({ title: what === 'rollback' ? 'Previous schedule restored' : 'Scheduled import cancelled', status: 'success', duration: 3000 });
      if (what === 'rollback') actions.notifyApplied();
      loadHistory();
    } catch { toast({ title: 'Could not reach the server', status: 'error', duration: 4000 }); }
  };
  const askAct = (it: HistoryItem, what: 'rollback' | 'cancel') => setConfirmCfg({
    title: what === 'rollback' ? 'Undo this import?' : 'Cancel this scheduled import?',
    body: what === 'rollback' ? <>The schedule that this import replaced goes back. This only works if nothing changed the schedule since.</> : <>It will not be applied on {it.effectivityDate}.</>,
    confirmLabel: what === 'rollback' ? 'Undo import' : 'Cancel import', run: () => act(it.id, what),
  });

  const issuesOf = useMemo(() => {
    const by = (list: ImportIssue[]) => { const m: Record<string, ImportIssue[]> = {}; list.forEach(i => { if (i.ref) (m[`${i.ref.type}:${i.ref.id}`] ||= []).push(i); }); return m; };
    return { errors: by(report?.errors || []), warnings: by(report?.warnings || []) };
  }, [report]);
  const bg = (type: string, r: Row) => (issuesOf.errors[`${type}:${r.id}`] ? errBg : (r.needsReview || issuesOf.warnings[`${type}:${r.id}`]) ? warnBg : undefined);
  // What to print under a row: its errors, then its warnings. Before the first check the OCR's own reasons stand in for the warnings.
  const note = (type: string, r: Row): { message: string; error?: boolean }[] => [
    ...(issuesOf.errors[`${type}:${r.id}`] || []).map(i => ({ message: i.message, error: true })),
    ...(report ? (issuesOf.warnings[`${type}:${r.id}`] || []) : (r.needsReview ? r.reviewReasons.map(m => ({ message: m })) : [])),
  ];

  // The messages for one row, on their own full-width line under it (same colour as the row)
  const noteRow = (type: string, r: Row, span: number) => {
    const notes = note(type, r);
    return notes.length ? (
      <Tr bg={bg(type, r)}><Td colSpan={span} py={1} borderTop="none">
        {notes.map((n, i) => <Text key={i} fontSize="xs" fontWeight={n.error ? 600 : 400} whiteSpace="normal">{n.message}</Text>)}
      </Td></Tr>
    ) : null;
  };
  const discard = () => setConfirmCfg({
    title: state.kind === 'bulk' ? 'Cancel this schedule review?' : 'Discard this schedule import?',
    body: state.kind === 'bulk'
      ? <>The edits and check results for this PDF will be discarded. The rest of the bulk import will remain.</>
      : <>The PDF, edits, and check results in this import session will be cleared.</>,
    confirmLabel: state.kind === 'bulk' ? 'Cancel review' : 'Discard import',
    run: state.kind === 'bulk' ? actions.closeReview : actions.clear,
  });
  const liveMinutes = hours.reduce((s, h) => { const [a, b] = [h.startTime, h.endTime].map(t => { const [x, y] = t.split(':').map(Number); return x * 60 + y; }); return s + Math.max(0, b - a); }, 0);
  const dayOptions = (days: readonly number[]) => [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map(d => <option key={d} value={d}>{DAY_LONG[d]}</option>);
  const timeOptions = TIMES.map(t => <option key={t} value={t}>{t12(t)}</option>);
  const sel = (value: string | number, onChange: (v: string) => void, options: React.ReactNode, label: string) =>
    <Select size="sm" value={value} onChange={e => onChange(e.target.value)} aria-label={label} minW={label === 'Day' ? '150px' : '125px'}>{options}</Select>;

  return (
    <Modal isOpen={isOpen} onClose={close} size="6xl" scrollBehavior="inside">
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>Import schedule PDF: {facultyName}</ModalHeader>
        <ModalCloseButton />
        <ModalBody pb={6}>
          {outcome ? (
            <VStack align="stretch" spacing={3}>
              <Alert status="success" borderRadius="md"><AlertIcon />
                <Text fontSize="sm">{outcome.status === 'ACTIVE'
                  ? <><b>Schedule applied.</b> {facultyName}'s class schedule and official consultation hours were replaced{outcome.counts ? ` (${outcome.counts.classes} class(es), ${outcome.counts.hours} consultation block(s))` : ''}. The previous schedule is in the import history.</>
                  : <><b>Schedule scheduled.</b> It will be applied on {outcome.effectivityDate} after one more check. The current schedule stays until then.</>}</Text>
              </Alert>
              <HStack justify="flex-end"><Button colorScheme="blue" onClick={state.kind === 'bulk' ? actions.closeReview : actions.clear}>Done</Button></HStack>
            </VStack>
          ) : !parsed ? (
            <VStack align="stretch" spacing={3}>
              <Alert status="info" borderRadius="md"><AlertIcon />
                <Text fontSize="sm">Upload the scanned Faculty Individual Load form (PDF, up to 10 MB). It is read automatically, then you correct and check it here. Nothing is saved or changed yet.</Text>
              </Alert>
              <Input type="file" accept="application/pdf,.pdf" pt={1} isDisabled={reading} onChange={e => { uploadPdf(e.target.files?.[0]); e.target.value = ''; }} aria-label="Schedule PDF" />
              {reading && <HStack><Spinner size="sm" /><Text fontSize="sm" color={muted}>Reading the PDF. This can take up to a minute.</Text></HStack>}
              {uploadError && <Alert status="error" borderRadius="md" role="alert"><AlertIcon /><Text fontSize="sm">{uploadError}</Text></Alert>}
              {mode === 'admin' && (
                <Box borderTopWidth="1px" pt={3}>
                  <Text fontSize="xs" color={muted} mb={1}>Admin only: load a draft file (JSON) written by the OCR program instead.</Text>
                  <Input type="file" accept="application/json,.json" size="sm" pt={1} onChange={e => loadFile(e.target.files?.[0])} aria-label="Schedule draft file" />
                </Box>
              )}
              <Box borderTopWidth="1px" pt={3}>
                <Button size="xs" variant="ghost" onClick={loadHistory}>{history ? 'Refresh import history' : 'Show import history'}</Button>
                {history && (history.length === 0 ? <Text fontSize="xs" color={muted} mt={1}>No imports yet for {facultyName}.</Text> : (
                  <TableContainer mt={1}><Table size="sm"><Thead><Tr><Th>Status</Th><Th>Effective</Th><Th>Term</Th><Th>Blocks</Th><Th /></Tr></Thead>
                    <Tbody>{history.map(h => (
                      <Tr key={h.id}>
                        <Td><Badge colorScheme={h.status === 'ACTIVE' ? 'green' : h.status === 'SCHEDULED' ? 'blue' : h.status === 'FAILED' ? 'red' : 'gray'}>{h.status.replace('_', ' ')}</Badge>{h.failureReason && <Text fontSize="xs" color={muted} whiteSpace="normal">{h.failureReason}</Text>}</Td>
                        <Td>{h.effectivityDate}</Td><Td>{[h.term, h.academicYear].filter(Boolean).join(' ')}</Td><Td>{h.classBlocks} classes, {h.consultationBlocks} consult</Td>
                        <Td>{h.status === 'ACTIVE' && <Button size="xs" variant="outline" onClick={() => askAct(h, 'rollback')}>Undo</Button>}{h.status === 'SCHEDULED' && <Button size="xs" variant="outline" onClick={() => askAct(h, 'cancel')}>Cancel</Button>}</Td>
                      </Tr>))}</Tbody></Table></TableContainer>
                ))}
              </Box>
            </VStack>
          ) : (
            <VStack align="stretch" spacing={5}>
              {state.kind === 'bulk' && (
                <Button variant="link" alignSelf="flex-start" px={0} onClick={actions.backToList}>
                  {'< Back to list'}
                </Button>
              )}
              <Box fontSize="sm" color={muted}>
                {[parsed.metadata.term, parsed.metadata.academicYear && `AY ${parsed.metadata.academicYear}`, parsed.metadata.effectivityDate && `effective ${parsed.metadata.effectivityDate}`].filter(Boolean).join(' · ') || 'Term, year and effectivity date were not read: enter them when confirming.'}
              </Box>
              {parsed.warnings.map((w, i) => <Alert key={i} status="warning" borderRadius="md" py={2}><AlertIcon /><Text fontSize="sm">{w.message}</Text></Alert>)}

              <Box>
                <HStack justify="space-between" mb={2}><Text fontWeight="700">Teaching classes ({classes.length})</Text><Button size="xs" variant="outline" onClick={addClass}>Add class</Button></HStack>
                <TableContainer><Table size="sm"><Thead><Tr><Th>Day</Th><Th>Start</Th><Th>End</Th><Th>Subject</Th><Th>Section</Th><Th>Room</Th><Th /></Tr></Thead>
                  <Tbody>{classes.map(c => (
                    <Fragment key={c.id}>
                    <Tr bg={bg('class', c)}>
                      <Td>{sel(c.dayOfWeek, v => editClass(c.id, { dayOfWeek: Number(v) }), dayOptions(CLASS_DAYS), 'Day')}</Td>
                      <Td>{sel(c.startTime, v => editClass(c.id, { startTime: v }), timeOptions, 'Start time')}</Td>
                      <Td>{sel(c.endTime, v => editClass(c.id, { endTime: v }), timeOptions, 'End time')}</Td>
                      <Td><Input size="sm" value={c.subject || ''} onChange={e => editClass(c.id, { subject: e.target.value })} aria-label="Subject" minW="150px" /></Td>
                      <Td><Input size="sm" value={c.section || ''} onChange={e => editClass(c.id, { section: e.target.value })} aria-label="Section" minW="90px" /></Td>
                      <Td><Input size="sm" value={c.room || ''} onChange={e => editClass(c.id, { room: e.target.value })} aria-label="Room" minW="90px" /></Td>
                      <Td>
                        <HStack spacing={1}>
                          {c.needsReview && <Button size="xs" onClick={() => editClass(c.id, { needsReview: false })} title="I checked this row against the scan">Reviewed</Button>}
                          <IconButton size="xs" variant="ghost" aria-label="Delete class" icon={<DeleteIcon />} onClick={() => actions.removeRow('class', c.id)} />
                        </HStack>
                      </Td>
                    </Tr>
                    {noteRow('class', c, 7)}
                    </Fragment>))}</Tbody></Table></TableContainer>
              </Box>

              <Box>
                <HStack justify="space-between" mb={2}>
                  <Text fontWeight="700">Official consultation hours ({hours.length}) <Badge ml={2} colorScheme={liveMinutes === 240 ? 'green' : 'orange'}>{(liveMinutes / 60).toFixed(1)} of 4 hours</Badge></Text>
                  <Button size="xs" variant="outline" onClick={addHour}>Add block</Button>
                </HStack>
                <TableContainer><Table size="sm"><Thead><Tr><Th>Day</Th><Th>Start</Th><Th>End</Th><Th /></Tr></Thead>
                  <Tbody>{hours.map(h => (
                    <Fragment key={h.id}>
                    <Tr bg={bg('consult', h)}>
                      <Td>{sel(h.dayOfWeek, v => editHour(h.id, { dayOfWeek: Number(v) }), dayOptions(CONSULTATION_DAYS), 'Day')}</Td>
                      <Td>{sel(h.startTime, v => editHour(h.id, { startTime: v }), timeOptions, 'Start time')}</Td>
                      <Td>{sel(h.endTime, v => editHour(h.id, { endTime: v }), timeOptions, 'End time')}</Td>
                      <Td>
                        <HStack spacing={1}>
                          {h.needsReview && <Button size="xs" onClick={() => editHour(h.id, { needsReview: false })}>Reviewed</Button>}
                          <IconButton size="xs" variant="ghost" aria-label="Delete block" icon={<DeleteIcon />} onClick={() => actions.removeRow('consult', h.id)} />
                        </HStack>
                      </Td>
                    </Tr>
                    {noteRow('consult', h, 4)}
                    </Fragment>))}</Tbody></Table></TableContainer>
                <Text fontSize="xs" color={muted} mt={1}>Consultation hours are Monday to Friday only.</Text>
              </Box>

              <Box borderWidth="1px" borderRadius="md" p={3}>
                {report?.identity?.status === 'mismatch' ? (
                  <Text fontSize="sm" color="red.500" fontWeight={600}>The name printed on the sheet ("{report.identity.read}") does not match {facultyName}. Choose the right faculty account or a different document.</Text>
                ) : report?.identity?.status === 'match' ? (
                  <Text fontSize="sm" color="green.500" fontWeight={600}>The name printed on the sheet matches {facultyName}.</Text>
                ) : (
                  <>
                    <Checkbox isChecked={identity} onChange={e => actions.setIdentity(e.target.checked)}>
                      This document belongs to <b>{facultyName}</b>
                    </Checkbox>
                    <Text fontSize="xs" color={muted} mt={1} ml={6}>
                      The printed name could not be read reliably{parsed.metadata.facultyName ? ` (read: "${parsed.metadata.facultyName}"${parsed.metadata.facultyNameConfidence != null ? `, ${Math.round(parsed.metadata.facultyNameConfidence)}% sure` : ''})` : ''}, often because a signature covers it. Compare the scan with the selected account yourself.
                    </Text>
                  </>
                )}
              </Box>

              {report && (
                <VStack align="stretch" spacing={2}>
                  {report.ok
                    ? <Alert status="success" borderRadius="md"><AlertIcon /><Text fontSize="sm"><b>Ready to confirm.</b> No blocking problems{report.warnings.length ? `, ${report.warnings.length} warning(s) to look at` : ''}. Nothing has been changed yet: set the effectivity date and press Confirm.</Text></Alert>
                    : <Alert status="error" borderRadius="md"><AlertIcon /><Text fontSize="sm"><b>{report.errors.length} problem(s) to fix</b> before this schedule could be confirmed.</Text></Alert>}
                  {report.errors.filter(e => !e.ref).map((e, i) => <Alert key={i} status="error" variant="left-accent" py={2}><AlertIcon /><Text fontSize="sm">{e.message}</Text></Alert>)}
                  {report.warnings.filter(w => !w.ref).map((w, i) => <Alert key={i} status="warning" variant="left-accent" py={2}><AlertIcon /><Text fontSize="sm">{w.message}</Text></Alert>)}
                </VStack>
              )}

              {report?.ok && (
                <HStack borderWidth="1px" borderRadius="md" p={3} spacing={3} align="end" wrap="wrap">
                  <Box>
                    <Text fontSize="sm" fontWeight={600} mb={1}>Effectivity date</Text>
                    <Input type="date" size="sm" value={effDate} onChange={e => actions.setEffDate(e.target.value)} aria-label="Effectivity date" maxW="190px" />
                  </Box>
                  <Text fontSize="xs" color={muted} flex="1" minW="220px">Today or earlier: applied right away. A later date: kept until that day, then checked again and applied.{!parsed?.metadata.effectivityDate && ' The date was not read from the document: enter it.'}</Text>
                  <Button colorScheme="green" onClick={askConfirm} isDisabled={!effDate} isLoading={confirming}>Confirm schedule</Button>
                </HStack>
              )}

              <HStack justify="space-between">
                <HStack>
                  {state.kind === 'bulk' && <Button variant="ghost" onClick={actions.backToList}>Back to list</Button>}
                  <Button variant="ghost" onClick={discard}>Cancel / Discard</Button>
                  <Button variant="ghost" onClick={close}>Minimize</Button>
                  {state.kind === 'single' && <Button variant="ghost" onClick={reset} title={fileHash ? `File fingerprint ${fileHash.slice(0, 12)}` : undefined}>Choose another file</Button>}
                </HStack>
                <Button colorScheme="blue" onClick={check} isLoading={busy}>Check schedule</Button>
              </HStack>
            </VStack>
          )}
        </ModalBody>
      </ModalContent>
      <ConfirmAction config={confirmCfg} onClose={() => setConfirmCfg(null)} />
    </Modal>
  );
}
