import { Fragment, useMemo, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import {
  Alert, AlertIcon, Badge, Box, Button, Checkbox, Flex, FormControl, FormLabel, HStack, IconButton, Input, Modal, ModalBody, ModalCloseButton, ModalContent,
  ModalFooter, ModalHeader, ModalOverlay, Select, Spinner, Table, TableContainer, Tbody, Td, Text, Th, Thead, Tr, VStack, useColorModeValue, useToast,
} from '@chakra-ui/react';
import { DeleteIcon } from '@chakra-ui/icons';
import { authFetch } from './authFetch';
import { DAY_LONG, DAY_SHORT, CONSULTATION_DAYS, visibleDays } from '../utils/daySettings';

const API = import.meta.env.VITE_API_URL;

// Faculty Schedule PDF Importer (phases 4-5): upload the scanned PDF, REVIEW and CHECK the draft. It never changes a schedule: a draft that
// passes is only "ready to confirm" (activation is a later phase). Used from three places: Admin > Class Schedules, Admin > Provision Account
// and Faculty > Master Schedule. Admins can also load a draft JSON written by ocr/schedule_ocr.py (fallback while OCR hosting is undecided).

interface Row { id: string; dayOfWeek: number; startTime: string; endTime: string; needsReview: boolean; reviewReasons: string[]; rawText?: string;
  subject?: string; section?: string; room?: string; label?: string }
interface Issue { code: string; message: string; ref: { type: 'class' | 'consult'; id: string } | null }
interface Report { ok: boolean; errors: Issue[]; warnings: Issue[]; summary: { weeklyConsultationMinutes: number }; identity?: { status: 'match' | 'mismatch' | 'unreadable'; read: string } }
interface Parsed { metadata: { term: string; academicYear: string; effectivityDate: string; facultyName: string; facultyNameConfidence: number | null; facultyNameNeedsReview: boolean };
  workload: { lectureHours: number | null; laboratoryHours: number | null };
  classes: Row[]; consultationHours: Row[]; warnings: Issue[]; excludedWeekendConsultations: number }

// 07:00 ... 19:00 in 30-minute steps: a list to pick from, so a misaligned time cannot be typed
const TIMES = Array.from({ length: 25 }, (_, i) => { const m = 420 + i * 30; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; });
const t12 = (t: string) => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };

// Weekly grid for the teaching classes: same layout as Admin > Class Schedules (7:00 AM to 7:00 PM, a line every 30 minutes).
// It only edits the draft in this window; nothing is saved to the server from here.
const FIRST = 7 * 60, LAST = 19 * 60, STEP = 30, ROW_PX = 24;
const ROWS = (LAST - FIRST) / STEP;
const toMin = (t: string): number => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
const toHHMM = (min: number): string => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const clock = (min: number): string => t12(toHHMM(min));
const range = (from: number, to: number): number[] => Array.from({ length: Math.floor((to - from) / STEP) + 1 }, (_, i) => from + i * STEP);
const classLabel = (r: Row) => `${r.subject || '(no subject)'}${r.section ? ` (${r.section})` : ''}`;
interface Draft { id: string | null; subject: string; section: string; room: string; day: number; start: number; end: number; needsReview: boolean }

// Classes that overlap in time share the column side by side instead of hiding each other
const layoutDay = (items: Row[]): Record<string, { lane: number; lanes: number }> => {
  const out: Record<string, { lane: number; lanes: number }> = {};
  const sorted = [...items].sort((a, b) => toMin(a.startTime) - toMin(b.startTime) || toMin(a.endTime) - toMin(b.endTime));
  let cluster: Row[] = [];
  let clusterEnd = 0;
  const flush = () => {
    const laneEnds: number[] = [];
    const assigned: { id: string; lane: number }[] = [];
    cluster.forEach(r => {
      let l = laneEnds.findIndex(e => e <= toMin(r.startTime));
      if (l === -1) { l = laneEnds.length; laneEnds.push(0); }
      laneEnds[l] = toMin(r.endTime);
      assigned.push({ id: r.id, lane: l });
    });
    assigned.forEach(a => { out[a.id] = { lane: a.lane, lanes: laneEnds.length }; });
    cluster = [];
  };
  sorted.forEach(r => {
    if (cluster.length && toMin(r.startTime) >= clusterEnd) flush();
    clusterEnd = cluster.length ? Math.max(clusterEnd, toMin(r.endTime)) : toMin(r.endTime);
    cluster.push(r);
  });
  if (cluster.length) flush();
  return out;
};

interface Props { facultyId: string; facultyName: string; mode: 'admin' | 'faculty'; isOpen: boolean; onClose: () => void }
const MAX_BYTES = 10 * 1024 * 1024;

export default function SchedulePdfImporter({ facultyId, facultyName, mode, isOpen, onClose }: Props) {
  const toast = useToast();
  const muted = useColorModeValue('#64748b', '#8fa6c4');
  const errBg = useColorModeValue('#fee2e2', '#4c1d1d');
  const warnBg = useColorModeValue('#fef3c7', '#4a3a12');
  const gridBorder = useColorModeValue('#dde3ec', '#1e3048');
  const gridText = useColorModeValue('#0f2240', '#e8f0fe');
  const blockBg = useColorModeValue('#cbd5e1', '#334155');
  const blockErrBg = useColorModeValue('#fecaca', '#7f1d1d');
  const blockWarnBg = useColorModeValue('#fde68a', '#78350f');
  const [showWeekend, setShowWeekend] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [classes, setClasses] = useState<Row[]>([]);
  const [hours, setHours] = useState<Row[]>([]);
  const [identity, setIdentity] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [nextId, setNextId] = useState(1);
  const [reading, setReading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [fileHash, setFileHash] = useState('');

  const reset = () => { setParsed(null); setClasses([]); setHours([]); setIdentity(false); setReport(null); setUploadError(''); setFileHash(''); };
  const close = () => { reset(); onClose(); };

  // Step 1a: upload the scanned PDF; the server reads it with OCR and sends back editable rows
  const uploadPdf = async (file: File | undefined) => {
    if (!file) return;
    setUploadError('');
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { setUploadError('Choose a PDF file.'); return; }
    if (file.size > MAX_BYTES) { setUploadError('That PDF is larger than 10 MB.'); return; }
    setReading(true);
    try {
      const res = await authFetch(`${API}/api/schedule-import/preview?facultyId=${encodeURIComponent(facultyId)}`, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: file });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setUploadError(data.error || 'Could not read that PDF.'); return; }
      setParsed(data); setClasses(data.classes); setHours(data.consultationHours); setReport(null); setIdentity(false); setFileHash(data.fileHash || '');
    } catch { setUploadError('Could not reach the server.'); }
    finally { setReading(false); }
  };

  // Step 1b (admin fallback): read the draft file and let the server clean it up (weekend consultations are left out with a warning)
  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    setUploadError('');
    if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') { setUploadError('That is a PDF. Use the PDF upload box above. This box is only for the JSON draft file the OCR program writes.'); return; }
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
  // Grid editing (draft only)
  const openNew = (day: number, start: number) => { setConfirmDelete(false); setDraft({ id: null, subject: '', section: '', room: '', day, start, end: Math.min(start + 60, LAST), needsReview: false }); };
  const openEdit = (r: Row) => { setConfirmDelete(false); setDraft({ id: r.id, subject: r.subject || '', section: r.section || '', room: r.room || '', day: r.dayOfWeek, start: toMin(r.startTime), end: toMin(r.endTime), needsReview: r.needsReview }); };
  const setD = (patch: Partial<Draft>) => setDraft(d => (d ? { ...d, ...patch } : d));
  const onColumnClick = (day: number, e: ReactMouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const row = Math.min(ROWS - 1, Math.max(0, Math.floor((e.clientY - rect.top) / ROW_PX)));
    openNew(day, FIRST + row * STEP);
  };
  // Saving a class from this window means the admin has looked at it, so its "needs review" flag is cleared
  const saveDraft = () => {
    if (!draft) return;
    const patch = { subject: draft.subject.trim(), section: draft.section.trim(), room: draft.room.trim(), dayOfWeek: draft.day, startTime: toHHMM(draft.start), endTime: toHHMM(draft.end), needsReview: false };
    if (draft.id) editClass(draft.id, patch);
    else { setClasses(rs => [...rs, { id: `n${nextId}`, ...patch, reviewReasons: [] }]); setNextId(n => n + 1); setReport(null); }
    setDraft(null);
  };
  const deleteDraft = () => { if (!draft?.id) return; setClasses(rs => rs.filter(r => r.id !== draft.id)); setReport(null); setDraft(null); };
  const markReviewed = () => { if (draft?.id) editClass(draft.id, { needsReview: false }); setDraft(null); };
  const addHour = () => { setHours(rs => [...rs, { id: `n${nextId}`, dayOfWeek: 1, startTime: '09:00', endTime: '10:00', label: 'CONSULTATION HOURS', needsReview: false, reviewReasons: [] }]); setNextId(n => n + 1); setReport(null); };

  // Step 2: the server re-checks everything (it never trusts what the browser says)
  const check = async () => {
    setBusy(true);
    try {
      const res = await authFetch(`${API}/api/schedule-import/validate`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facultyId, classes, consultationHours: hours, metadata: parsed?.metadata, workload: parsed?.workload, identityConfirmed: identity }) });
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

  // Columns: Monday to Friday, plus Saturday / Sunday when a class sits there or "Show weekend" is on
  const DAY_VALUES = visibleDays({ classDays: classes.map(c => c.dayOfWeek), showWeekend });
  const DAYS = DAY_VALUES.map(d => DAY_SHORT[d]);
  const weekendHasClass = classes.some(c => c.dayOfWeek === 0 || c.dayOfWeek === 6);
  const rowLabels = Array.from({ length: ROWS }, (_, i) => FIRST + i * STEP);

  return (
    <Modal isOpen={isOpen} onClose={close} size="6xl" scrollBehavior="inside">
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>Import schedule PDF: {facultyName}</ModalHeader>
        <ModalCloseButton />
        <ModalBody pb={6}>
          {!parsed ? (
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
            </VStack>
          ) : (
            <VStack align="stretch" spacing={5}>
              <Box fontSize="sm" color={muted}>
                {[parsed.metadata.term, parsed.metadata.academicYear && `AY ${parsed.metadata.academicYear}`, parsed.metadata.effectivityDate && `effective ${parsed.metadata.effectivityDate}`].filter(Boolean).join(' · ') || 'Term, year and effectivity date were not read: enter them when confirming.'}
              </Box>
              {parsed.warnings.map((w, i) => <Alert key={i} status="warning" borderRadius="md" py={2}><AlertIcon /><Text fontSize="sm">{w.message}</Text></Alert>)}

              <Box>
                <HStack justify="space-between" mb={2} wrap="wrap">
                  <Box>
                    <Text fontWeight="700">Teaching classes ({classes.length})</Text>
                    <Text fontSize="xs" color={muted}>Click an empty spot to add a class. Click a class to change or delete it. Yellow needs a look, red has a problem.</Text>
                  </Box>
                  <HStack spacing={2}>
                    <Button size="xs" variant={showWeekend ? 'solid' : 'outline'} colorScheme="blue" aria-pressed={showWeekend} onClick={() => setShowWeekend(v => !v)}
                      title={weekendHasClass ? 'A weekend column that has classes is always shown' : 'Show empty Saturday and Sunday columns, to add a weekend class'}>Show weekend</Button>
                    <Button size="xs" variant="outline" onClick={() => openNew(1, 8 * 60)}>Add class</Button>
                  </HStack>
                </HStack>
                <Box overflowX="auto">
                  <Flex minW={`${58 + DAYS.length * 92}px`} borderWidth="1px" borderColor={gridBorder} borderRadius="md" overflow="hidden">
                    <Box w="58px" flexShrink={0} borderRightWidth="1px" borderColor={gridBorder}>
                      <Box h="28px" />
                      {rowLabels.map(min => (
                        <Text key={min} h={`${ROW_PX}px`} fontSize="10px" color={muted} textAlign="right" pr={1} lineHeight={`${ROW_PX}px`}>{clock(min)}</Text>
                      ))}
                    </Box>
                    {DAYS.map((day, i) => {
                      const dayClasses = classes.filter(c => c.dayOfWeek === DAY_VALUES[i]);
                      const lanes = layoutDay(dayClasses);
                      return (
                        <Box key={day} flex="1" minW="0" borderRightWidth={i < DAYS.length - 1 ? '1px' : 0} borderColor={gridBorder}>
                          <Text h="28px" lineHeight="28px" textAlign="center" fontSize="xs" fontWeight="700" color={gridText} borderBottomWidth="1px" borderColor={gridBorder}>{day}</Text>
                          <Box position="relative" h={`${ROWS * ROW_PX}px`} cursor="cell" onClick={e => onColumnClick(DAY_VALUES[i], e)} aria-label={`${day} column`}>
                            {rowLabels.map((min, r) => (
                              <Box key={min} position="absolute" left={0} right={0} top={`${r * ROW_PX}px`} borderTopWidth={r ? '1px' : 0}
                                borderTopStyle={min % 60 === 0 ? 'solid' : 'dashed'} borderColor={gridBorder} opacity={min % 60 === 0 ? 0.9 : 0.5} pointerEvents="none" />
                            ))}
                            {dayClasses.map(c => {
                              const top = Math.max(0, ((toMin(c.startTime) - FIRST) / STEP) * ROW_PX);
                              const height = Math.max(ROW_PX - 2, ((toMin(c.endTime) - toMin(c.startTime)) / STEP) * ROW_PX - 2);
                              const { lane, lanes: n } = lanes[c.id] || { lane: 0, lanes: 1 };
                              const hasError = !!issuesOf.errors[`class:${c.id}`];
                              const needsLook = c.needsReview || !!issuesOf.warnings[`class:${c.id}`];
                              return (
                                <Box
                                  as="button" key={c.id} position="absolute" top={`${top + 1}px`} h={`${height}px`}
                                  left={`calc(${(lane / n) * 100}% + 2px)`} w={`calc(${100 / n}% - 4px)`}
                                  bg={hasError ? blockErrBg : needsLook ? blockWarnBg : blockBg} color={gridText} borderRadius="sm" px={1} py="1px" overflow="hidden" textAlign="left" cursor="pointer"
                                  _hover={{ boxShadow: '0 0 0 2px #2563eb' }}
                                  onClick={(e: ReactMouseEvent) => { e.stopPropagation(); openEdit(c); }}
                                  title={`${classLabel(c)} · ${c.room || 'no room'} · ${t12(c.startTime)} to ${t12(c.endTime)}`}
                                  aria-label={`${classLabel(c)}, ${day} ${t12(c.startTime)} to ${t12(c.endTime)}. Edit`}
                                >
                                  <Text fontSize="10px" fontWeight="700" lineHeight="1.2" noOfLines={2}>{classLabel(c)}</Text>
                                  {height > 34 && <Text fontSize="9px" lineHeight="1.1">{c.room}</Text>}
                                </Box>
                              );
                            })}
                          </Box>
                        </Box>
                      );
                    })}
                  </Flex>
                </Box>
                {classes.map(c => {
                  const notes = note('class', c);
                  return notes.length ? (
                    <Box key={c.id} bg={bg('class', c)} borderRadius="md" px={3} py={1} mt={2} cursor="pointer" onClick={() => openEdit(c)}>
                      <Text fontSize="xs" fontWeight={700}>{classLabel(c)} · {DAY_LONG[c.dayOfWeek]} {t12(c.startTime)} to {t12(c.endTime)}</Text>
                      {notes.map((n, i) => <Text key={i} fontSize="xs" fontWeight={n.error ? 600 : 400} whiteSpace="normal">{n.message}</Text>)}
                    </Box>
                  ) : null;
                })}
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
                {report?.identity?.status === 'mismatch' ? (
                  <Text fontSize="sm" color="red.500" fontWeight={600}>The name printed on the sheet ("{report.identity.read}") does not match {facultyName}. Choose the right faculty account or a different document.</Text>
                ) : report?.identity?.status === 'match' ? (
                  <Text fontSize="sm" color="green.500" fontWeight={600}>The name printed on the sheet matches {facultyName}.</Text>
                ) : (
                  <>
                    <Checkbox isChecked={identity} onChange={e => { setIdentity(e.target.checked); setReport(null); }}>
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
                    ? <Alert status="success" borderRadius="md"><AlertIcon /><Text fontSize="sm"><b>Ready to confirm.</b> No blocking problems{report.warnings.length ? `, ${report.warnings.length} warning(s) to look at` : ''}. Nothing has been changed: activating a schedule comes in a later step.</Text></Alert>
                    : <Alert status="error" borderRadius="md"><AlertIcon /><Text fontSize="sm"><b>{report.errors.length} problem(s) to fix</b> before this schedule could be confirmed.</Text></Alert>}
                  {report.errors.filter(e => !e.ref).map((e, i) => <Alert key={i} status="error" variant="left-accent" py={2}><AlertIcon /><Text fontSize="sm">{e.message}</Text></Alert>)}
                  {report.warnings.filter(w => !w.ref).map((w, i) => <Alert key={i} status="warning" variant="left-accent" py={2}><AlertIcon /><Text fontSize="sm">{w.message}</Text></Alert>)}
                </VStack>
              )}

              <HStack justify="space-between">
                <Button variant="ghost" onClick={reset} title={fileHash ? `File fingerprint ${fileHash.slice(0, 12)}` : undefined}>Choose another file</Button>
                <HStack><Button variant="ghost" onClick={close}>Close</Button><Button colorScheme="blue" onClick={check} isLoading={busy}>Check schedule</Button></HStack>
              </HStack>
            </VStack>
          )}
        </ModalBody>

      <Modal isOpen={!!draft} onClose={() => setDraft(null)} isCentered>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>{draft?.id ? 'Change class' : 'Add class'}</ModalHeader>
          <ModalCloseButton />
          {draft && (
            <>
              <ModalBody>
                <FormControl mb={3}>
                  <FormLabel>Subject</FormLabel>
                  <Input value={draft.subject} maxLength={100} onChange={e => setD({ subject: e.target.value })} placeholder="e.g. INFOT 8 - Platform Technologies" />
                </FormControl>
                <HStack align="flex-start" mb={3}>
                  <FormControl>
                    <FormLabel>Section</FormLabel>
                    <Input value={draft.section} maxLength={40} onChange={e => setD({ section: e.target.value })} placeholder="e.g. BSIT 3-D" />
                  </FormControl>
                  <FormControl>
                    <FormLabel>Room</FormLabel>
                    <Input value={draft.room} maxLength={60} onChange={e => setD({ room: e.target.value })} placeholder="e.g. IICT 307" />
                  </FormControl>
                </HStack>
                <FormControl mb={3}>
                  <FormLabel>Day</FormLabel>
                  <Select value={draft.day} onChange={e => setD({ day: Number(e.target.value) })}>
                    {DAY_VALUES.map(d => <option key={d} value={d}>{DAY_LONG[d]}</option>)}
                  </Select>
                </FormControl>
                <HStack align="flex-start">
                  <FormControl>
                    <FormLabel>Start</FormLabel>
                    <Select value={draft.start} onChange={e => { const st = Number(e.target.value); setD({ start: st, end: draft.end <= st ? Math.min(st + 60, LAST) : draft.end }); }}>
                      {range(FIRST, LAST - STEP).map(m => <option key={m} value={m}>{clock(m)}</option>)}
                    </Select>
                  </FormControl>
                  <FormControl>
                    <FormLabel>End</FormLabel>
                    <Select value={draft.end} onChange={e => setD({ end: Number(e.target.value) })}>
                      {range(draft.start + STEP, LAST).map(m => <option key={m} value={m}>{clock(m)}</option>)}
                    </Select>
                  </FormControl>
                </HStack>
              </ModalBody>
              <ModalFooter>
                {draft.id && (
                  <Button mr="auto" variant="outline" colorScheme="red" onClick={() => (confirmDelete ? deleteDraft() : setConfirmDelete(true))}>
                    {confirmDelete ? 'Click again to delete' : 'Delete class'}
                  </Button>
                )}
                {draft.id && draft.needsReview && <Button variant="outline" mr={3} onClick={markReviewed} title="I checked this class against the scan">Mark reviewed</Button>}
                <Button variant="ghost" mr={3} onClick={() => setDraft(null)}>Cancel</Button>
                <Button colorScheme="blue" onClick={saveDraft}>Save</Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
      </ModalContent>
    </Modal>
  );
}
