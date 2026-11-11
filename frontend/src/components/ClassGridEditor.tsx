import { useCallback, useEffect, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import {
  Box, Button, Flex, FormControl, FormLabel, HStack, Input, Modal, ModalBody, ModalCloseButton, ModalContent, ModalFooter,
  ModalHeader, ModalOverlay, Select, Text, useColorModeValue, useToast,
} from '@chakra-ui/react';
import { authFetch } from './authFetch';
import { visibleDays, DAY_SHORT, DAY_LONG } from '../utils/daySettings';

// The admin's class schedule editor: an empty weekly grid with a line every 30 minutes (7:00 AM to 7:00 PM,
// Monday to Friday, plus Saturday / Sunday when needed). Click an empty spot to add a class, click a class to change or delete it.
// Every save goes to the server, which checks the times (30-minute steps, no overlap with another class, no clash
// with an approved consultation) and answers with a plain message when it refuses.

interface ClassBlock { _id: string; subject: string; room: string; dayOfWeek: number; startTime: string; endTime: string }
interface Draft { id: string | null; subject: string; room: string; day: number; start: number; end: number }

const FIRST = 7 * 60;      // 7:00 AM
const LAST = 19 * 60;      // 7:00 PM
const STEP = 30;
const ROW_PX = 24;         // height of one 30-minute row
// The columns come from utils/daySettings.ts: Monday to Friday always, Saturday / Sunday only when needed (see below).
const ROWS = (LAST - FIRST) / STEP;

const toMin = (t: string): number => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
const toHHMM = (min: number): string => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const clock = (min: number): string => `${((Math.floor(min / 60) + 11) % 12) + 1}:${String(min % 60).padStart(2, '0')} ${Math.floor(min / 60) >= 12 ? 'PM' : 'AM'}`;
const range = (from: number, to: number): number[] => Array.from({ length: Math.floor((to - from) / STEP) + 1 }, (_, i) => from + i * STEP);

interface Props {
  facultyId: string;
  facultyName: string;
}

export default function ClassGridEditor({ facultyId, facultyName }: Props) {
  const toast = useToast();
  const border = useColorModeValue('#dde3ec', '#1e3048');
  const muted = useColorModeValue('#6b7fa0', '#7a93b0');
  const text = useColorModeValue('#0f2240', '#e8f0fe');
  const classBg = useColorModeValue('#cbd5e1', '#334155');
  const classFg = useColorModeValue('#0f2240', '#ffffff');
  const [blocks, setBlocks] = useState<ClassBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showWeekend, setShowWeekend] = useState(false); // display preference: reveal empty Saturday / Sunday columns
  // Monday to Friday, plus Saturday / Sunday when this faculty has a class that day or "Show weekend" is on. A weekend column
  // that holds a class is always shown. Each column carries its stored day (Sunday is 0).
  const DAY_VALUES = visibleDays({ classDays: blocks.map(b => b.dayOfWeek), showWeekend });
  const DAYS = DAY_VALUES.map(d => DAY_SHORT[d]);
  const DAY_NAMES = DAY_VALUES.map(d => DAY_LONG[d]);
  const weekendHasClass = blocks.some(b => b.dayOfWeek === 0 || b.dayOfWeek === 6);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/my-schedule/${facultyId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load the schedule.');
      setBlocks(Array.isArray(data) ? data : []);
    } catch (e: any) {
      toast({ title: 'Could not load the schedule', description: e.message, status: 'error' });
    }
    setLoading(false);
  }, [facultyId, toast]);

  useEffect(() => { load(); }, [load]);

  const openNew = (day: number, start: number) => {
    setConfirmDelete(false);
    setDraft({ id: null, subject: '', room: '', day, start, end: Math.min(start + 60, LAST) });
  };
  const openEdit = (b: ClassBlock) => {
    setConfirmDelete(false);
    setDraft({ id: b._id, subject: b.subject, room: b.room, day: b.dayOfWeek, start: toMin(b.startTime), end: toMin(b.endTime) });
  };

  const onColumnClick = (day: number, e: ReactMouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const row = Math.min(ROWS - 1, Math.max(0, Math.floor((e.clientY - rect.top) / ROW_PX)));
    openNew(day, FIRST + row * STEP);
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const body = JSON.stringify({ facultyId, subject: draft.subject, room: draft.room, dayOfWeek: draft.day, startTime: toHHMM(draft.start), endTime: toHHMM(draft.end) });
      const res = await authFetch(
        `${import.meta.env.VITE_API_URL}/api/faculty/schedule${draft.id ? `/${draft.id}` : '/add'}`,
        { method: draft.id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save the class.');
      toast({ title: draft.id ? 'Class updated' : 'Class added', status: 'success', duration: 2500 });
      setDraft(null);
      await load();
    } catch (e: any) {
      toast({ title: 'Not saved', description: e.message, status: 'error', duration: 7000 });
    }
    setSaving(false);
  };

  const remove = async () => {
    if (!draft || !draft.id) return;
    setSaving(true);
    try {
      const res = await authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/schedule/${draft.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not remove the class.');
      toast({ title: 'Class removed', status: 'success', duration: 2500 });
      setDraft(null);
      await load();
    } catch (e: any) {
      toast({ title: 'Not removed', description: e.message, status: 'error' });
    }
    setSaving(false);
  };

  const set = (patch: Partial<Draft>) => setDraft(d => (d ? { ...d, ...patch } : d));
  const rowLabels = Array.from({ length: ROWS }, (_, i) => FIRST + i * STEP);

  return (
    <Box>
      <Flex justify="space-between" align="center" mb={3} gap={3} wrap="wrap">
        <Box>
          <Text fontWeight="700" color={text}>{facultyName}</Text>
          <Text fontSize="xs" color={muted}>Click an empty spot to add a class. Click a class to change or delete it.</Text>
        </Box>
        <HStack spacing={2}>
          <Button size="sm" variant={showWeekend ? 'solid' : 'outline'} colorScheme="blue" aria-pressed={showWeekend}
            title={weekendHasClass ? 'A weekend column that has classes is always shown' : 'Show empty Saturday and Sunday columns, to add a weekend class'}
            onClick={() => setShowWeekend(v => !v)}>Show weekend</Button>
          <Button size="sm" colorScheme="blue" onClick={() => openNew(1, 8 * 60)}>Add class</Button>
        </HStack>
      </Flex>

      <Box overflowX="auto" opacity={loading ? 0.6 : 1}>
        <Flex minW={`${58 + DAYS.length * 92}px`} borderWidth="1px" borderColor={border} borderRadius="md" overflow="hidden">
          <Box w="58px" flexShrink={0} borderRightWidth="1px" borderColor={border}>
            <Box h="28px" />
            {rowLabels.map(min => (
              <Text key={min} h={`${ROW_PX}px`} fontSize="10px" color={muted} textAlign="right" pr={1} lineHeight={`${ROW_PX}px`}>
                {clock(min)}
              </Text>
            ))}
          </Box>
          {DAYS.map((day, i) => (
            <Box key={day} flex="1" minW="0" borderRightWidth={i < DAYS.length - 1 ? '1px' : 0} borderColor={border}>
              <Text h="28px" lineHeight="28px" textAlign="center" fontSize="xs" fontWeight="700" color={text} borderBottomWidth="1px" borderColor={border}>{day}</Text>
              <Box position="relative" h={`${ROWS * ROW_PX}px`} cursor="cell" onClick={(e) => onColumnClick(DAY_VALUES[i], e)} aria-label={`${day} column`}>
                {rowLabels.map((min, r) => (
                  <Box key={min} position="absolute" left={0} right={0} top={`${r * ROW_PX}px`} borderTopWidth={r ? '1px' : 0}
                    borderTopStyle={min % 60 === 0 ? 'solid' : 'dashed'} borderColor={border} opacity={min % 60 === 0 ? 0.9 : 0.5} pointerEvents="none" />
                ))}
                {blocks.filter(b => b.dayOfWeek === DAY_VALUES[i]).map(b => {
                  const top = ((toMin(b.startTime) - FIRST) / STEP) * ROW_PX;
                  const height = Math.max(ROW_PX - 2, ((toMin(b.endTime) - toMin(b.startTime)) / STEP) * ROW_PX - 2);
                  return (
                    <Box
                      as="button" key={b._id} position="absolute" left="2px" right="2px" top={`${top + 1}px`} h={`${height}px`}
                      bg={classBg} color={classFg} borderRadius="sm" px={1} py="1px" overflow="hidden" textAlign="left" cursor="pointer"
                      _hover={{ boxShadow: '0 0 0 2px #2563eb' }}
                      onClick={(e: ReactMouseEvent) => { e.stopPropagation(); openEdit(b); }}
                      title={`${b.subject} · ${b.room} · ${clock(toMin(b.startTime))} to ${clock(toMin(b.endTime))}`}
                      aria-label={`${b.subject}, ${DAYS[i]} ${clock(toMin(b.startTime))} to ${clock(toMin(b.endTime))}. Edit`}
                    >
                      <Text fontSize="10px" fontWeight="700" lineHeight="1.2" noOfLines={2}>{b.subject}</Text>
                      {height > 34 && <Text fontSize="9px" lineHeight="1.1">{b.room}</Text>}
                    </Box>
                  );
                })}
              </Box>
            </Box>
          ))}
        </Flex>
      </Box>
      {!loading && blocks.length === 0 && <Text fontSize="xs" color={muted} mt={2}>No classes yet. Faculty can still be booked in vacant hours (Mon to Fri, 8 AM to 5 PM).</Text>}

      <Modal isOpen={!!draft} onClose={() => { if (!saving) setDraft(null); }} isCentered>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>{draft?.id ? 'Change class' : 'Add class'}</ModalHeader>
          <ModalCloseButton isDisabled={saving} />
          {draft && (
            <>
              <ModalBody>
                <FormControl isRequired mb={3}>
                  <FormLabel>Subject</FormLabel>
                  <Input value={draft.subject} maxLength={100} onChange={e => set({ subject: e.target.value })} placeholder="e.g. LIS 6 (BLIS 2-A)" />
                </FormControl>
                <FormControl isRequired mb={3}>
                  <FormLabel>Room</FormLabel>
                  <Input value={draft.room} maxLength={60} onChange={e => set({ room: e.target.value })} placeholder="e.g. ICT 309" />
                </FormControl>
                <FormControl mb={3}>
                  <FormLabel>Day</FormLabel>
                  <Select value={draft.day} onChange={e => set({ day: Number(e.target.value) })}>
                    {DAYS.map((d, i) => <option key={d} value={DAY_VALUES[i]}>{DAY_NAMES[i]}</option>)}
                  </Select>
                </FormControl>
                <HStack align="flex-start">
                  <FormControl>
                    <FormLabel>Start</FormLabel>
                    <Select value={draft.start} onChange={e => { const s = Number(e.target.value); set({ start: s, end: draft.end <= s ? Math.min(s + 60, LAST) : draft.end }); }}>
                      {range(FIRST, LAST - STEP).map(m => <option key={m} value={m}>{clock(m)}</option>)}
                    </Select>
                  </FormControl>
                  <FormControl>
                    <FormLabel>End</FormLabel>
                    <Select value={draft.end} onChange={e => set({ end: Number(e.target.value) })}>
                      {range(draft.start + STEP, LAST).map(m => <option key={m} value={m}>{clock(m)}</option>)}
                    </Select>
                  </FormControl>
                </HStack>
              </ModalBody>
              <ModalFooter>
                {draft.id && (
                  <Button mr="auto" variant="outline" colorScheme="red" onClick={() => (confirmDelete ? remove() : setConfirmDelete(true))} isDisabled={saving}>
                    {confirmDelete ? 'Click again to delete' : 'Delete class'}
                  </Button>
                )}
                <Button variant="ghost" mr={3} onClick={() => setDraft(null)} isDisabled={saving}>Cancel</Button>
                <Button colorScheme="blue" onClick={save} isLoading={saving} isDisabled={!draft.subject.trim() || !draft.room.trim()}>Save</Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </Box>
  );
}
