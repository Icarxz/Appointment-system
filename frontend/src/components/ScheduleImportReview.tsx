import { Fragment, useMemo, useState } from 'react';
import {
  Alert, AlertIcon, Badge, Box, Button, Checkbox, HStack, IconButton, Input, Modal, ModalBody, ModalCloseButton, ModalContent,
  ModalHeader, ModalOverlay, Select, Table, TableContainer, Tbody, Td, Text, Th, Thead, Tr, VStack, useColorModeValue, useToast,
} from '@chakra-ui/react';
import { DeleteIcon } from '@chakra-ui/icons';
import { authFetch } from './authFetch';
import { DAY_LONG, CONSULTATION_DAYS, CLASS_DAYS } from '../utils/daySettings';

const API = import.meta.env.VITE_API_URL;

// Phase 4 of the Faculty Schedule PDF Importer: REVIEW and CHECK a schedule draft. It never changes a schedule: a draft that passes is only
// "ready to confirm". Activation, PDF upload and the three entry points come in later phases.
// For now the draft is the JSON that backend/ocr/schedule_extractor.py writes (loaded from a file) so this screen can be tried with real output.

interface Row { id: string; dayOfWeek: number; startTime: string; endTime: string; needsReview: boolean; reviewReasons: string[]; rawText?: string;
  subject?: string; section?: string; room?: string; label?: string }
interface Issue { code: string; message: string; ref: { type: 'class' | 'consult'; id: string } | null }
interface Report { ok: boolean; errors: Issue[]; warnings: Issue[]; summary: { weeklyConsultationMinutes: number } }
interface Parsed { document: { term: string; academicYear: string; effectivityDate: string; facultyNameHint: string };
  classes: Row[]; consultationHours: Row[]; warnings: Issue[]; excludedWeekendConsultations: number }

// 07:00 ... 19:00 in 30-minute steps: a list to pick from, so a misaligned time cannot be typed
const TIMES = Array.from({ length: 25 }, (_, i) => { const m = 420 + i * 30; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; });
const t12 = (t: string) => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };

interface Props { facultyId: string; facultyName: string; isOpen: boolean; onClose: () => void }

export default function ScheduleImportReview({ facultyId, facultyName, isOpen, onClose }: Props) {
  const toast = useToast();
  const muted = useColorModeValue('#64748b', '#8fa6c4');
  const errBg = useColorModeValue('#fee2e2', '#4c1d1d');
  const warnBg = useColorModeValue('#fef3c7', '#4a3a12');
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [classes, setClasses] = useState<Row[]>([]);
  const [hours, setHours] = useState<Row[]>([]);
  const [identity, setIdentity] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [nextId, setNextId] = useState(1);

  const reset = () => { setParsed(null); setClasses([]); setHours([]); setIdentity(false); setReport(null); };
  const close = () => { reset(); onClose(); };

  // Step 1: read the draft file and let the server clean it up (weekend consultations are left out with a warning)
  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const draft = JSON.parse(await file.text());
      const res = await authFetch(`${API}/api/schedule-import/parse`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft }) });
      const data = await res.json();
      if (!res.ok) { toast({ title: 'Could not read the draft', description: data.error, status: 'error', duration: 5000 }); return; }
      setParsed(data); setClasses(data.classes); setHours(data.consultationHours); setReport(null); setIdentity(false);
    } catch { toast({ title: 'That file is not a schedule draft', description: 'Choose the JSON file the OCR program wrote.', status: 'error', duration: 5000 }); }
  };

  // Any edit makes the last check out of date
  const editClass = (id: string, patch: Partial<Row>) => { setClasses(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r))); setReport(null); };
  const editHour = (id: string, patch: Partial<Row>) => { setHours(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r))); setReport(null); };
  const addClass = () => { setClasses(rs => [...rs, { id: `n${nextId}`, dayOfWeek: 1, startTime: '08:00', endTime: '09:00', subject: '', section: '', room: '', needsReview: false, reviewReasons: [] }]); setNextId(n => n + 1); setReport(null); };
  const addHour = () => { setHours(rs => [...rs, { id: `n${nextId}`, dayOfWeek: 1, startTime: '09:00', endTime: '10:00', label: 'CONSULTATION HOURS', needsReview: false, reviewReasons: [] }]); setNextId(n => n + 1); setReport(null); };

  // Step 2: the server re-checks everything (it never trusts what the browser says)
  const check = async () => {
    setBusy(true);
    try {
      const res = await authFetch(`${API}/api/schedule-import/validate`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facultyId, classes, consultationHours: hours, identityConfirmed: identity }) });
      const data = await res.json();
      if (!res.ok) { toast({ title: 'Could not check the schedule', description: data.error, status: 'error', duration: 5000 }); return; }
      setReport(data);
    } catch { toast({ title: 'Could not reach the server', status: 'error', duration: 4000 }); }
    finally { setBusy(false); }
  };

  const issuesOf = useMemo(() => {
    const by = (list: Issue[]) => { const m: Record<string, Issue[]> = {}; list.forEach(i => { if (i.ref) (m[`${i.ref.type}:${i.ref.id}`] ||= []).push(i); }); return m; };
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
  const liveMinutes = hours.reduce((s, h) => { const [a, b] = [h.startTime, h.endTime].map(t => { const [x, y] = t.split(':').map(Number); return x * 60 + y; }); return s + Math.max(0, b - a); }, 0);
  const dayOptions = (days: readonly number[]) => [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map(d => <option key={d} value={d}>{DAY_LONG[d]}</option>);
  const timeOptions = TIMES.map(t => <option key={t} value={t}>{t12(t)}</option>);
  const sel = (value: string | number, onChange: (v: string) => void, options: React.ReactNode, label: string) =>
    <Select size="sm" value={value} onChange={e => onChange(e.target.value)} aria-label={label} minW={label === 'Day' ? '150px' : '125px'}>{options}</Select>;

  return (
    <Modal isOpen={isOpen} onClose={close} size="6xl" scrollBehavior="inside">
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>Review schedule draft: {facultyName}</ModalHeader>
        <ModalCloseButton />
        <ModalBody pb={6}>
          {!parsed ? (
            <VStack align="stretch" spacing={3}>
              <Alert status="info" borderRadius="md"><AlertIcon />
                <Text fontSize="sm">Preview of the schedule importer. Load the draft file the OCR program wrote (JSON). You can correct it and check it here; nothing is saved or changed.</Text>
              </Alert>
              <Input type="file" accept="application/json,.json" pt={1} onChange={e => loadFile(e.target.files?.[0])} aria-label="Schedule draft file" />
            </VStack>
          ) : (
            <VStack align="stretch" spacing={5}>
              <Box fontSize="sm" color={muted}>
                {[parsed.document.term, parsed.document.academicYear && `AY ${parsed.document.academicYear}`, parsed.document.effectivityDate && `effective ${parsed.document.effectivityDate}`].filter(Boolean).join(' · ') || 'Term, year and effectivity date were not read: enter them when confirming.'}
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
                          <IconButton size="xs" variant="ghost" aria-label="Delete class" icon={<DeleteIcon />} onClick={() => { setClasses(rs => rs.filter(r => r.id !== c.id)); setReport(null); }} />
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
                          <IconButton size="xs" variant="ghost" aria-label="Delete block" icon={<DeleteIcon />} onClick={() => { setHours(rs => rs.filter(r => r.id !== h.id)); setReport(null); }} />
                        </HStack>
                      </Td>
                    </Tr>
                    {noteRow('consult', h, 4)}
                    </Fragment>))}</Tbody></Table></TableContainer>
                <Text fontSize="xs" color={muted} mt={1}>Consultation hours are Monday to Friday only.</Text>
              </Box>

              <Box borderWidth="1px" borderRadius="md" p={3}>
                <Checkbox isChecked={identity} onChange={e => { setIdentity(e.target.checked); setReport(null); }}>
                  This document belongs to <b>{facultyName}</b>
                </Checkbox>
                <Text fontSize="xs" color={muted} mt={1} ml={6}>The name on the form is covered by a signature, so it cannot be read reliably{parsed.document.facultyNameHint ? ` (fragment read: "${parsed.document.facultyNameHint}")` : ''}. Compare it with the scan yourself.</Text>
              </Box>

              {report && (
                <VStack align="stretch" spacing={2}>
                  {report.ok
                    ? <Alert status="success" borderRadius="md"><AlertIcon /><Text fontSize="sm"><b>Ready to confirm.</b> No blocking problems{report.warnings.length ? `, ${report.warnings.length} warning(s) to look at` : ''}. Nothing has been changed: activating a schedule comes in a later step.</Text></Alert>
                    : <Alert status="error" borderRadius="md"><AlertIcon /><Text fontSize="sm"><b>{report.errors.length} problem(s) to fix</b> before this schedule could be confirmed.</Text></Alert>}
                  {report.errors.filter(e => !e.ref).map((e, i) => <Alert key={i} status="error" variant="left-accent" py={2}><AlertIcon /><Text fontSize="sm">{e.message}</Text></Alert>)}
                  {report.warnings.filter(w => !w.ref).map((w, i) => <Alert key={i} status="warning" variant="left-accent" py={2}><AlertIcon /><Text fontSize="sm">{w.message}</Text></Alert>)}
                </VStack>
              )}

              <HStack justify="space-between">
                <Button variant="ghost" onClick={reset}>Choose another file</Button>
                <HStack><Button variant="ghost" onClick={close}>Close</Button><Button colorScheme="blue" onClick={check} isLoading={busy}>Check schedule</Button></HStack>
              </HStack>
            </VStack>
          )}
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
