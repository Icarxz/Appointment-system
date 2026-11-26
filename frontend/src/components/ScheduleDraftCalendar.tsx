import { useEffect, useMemo, useState } from 'react';
import {
  Alert, AlertIcon, Badge, Box, Button, Checkbox, Flex, FormControl, FormLabel, HStack, Input, Modal, ModalBody,
  ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalOverlay, Select, Spinner, Text, Tooltip, VStack,
  useColorModeValue,
} from '@chakra-ui/react';
import { authFetch } from './authFetch';
import type { ImportIssue, ImportRow } from '../context/ImportSessionContext';
import { useImportSession } from '../context/ImportSessionContextCore';
import {
  CALENDAR_SLOT_COUNT, CALENDAR_STEP_MINUTES, calendarEventPosition, calendarTimeAtSlot, findOverlappingIds, timeToMinutes,
} from '../utils/calendarMath';
import { CLASS_DAYS, CONSULTATION_DAYS, DAY_LONG, DAY_SHORT, visibleDays } from '../utils/daySettings';

const API = import.meta.env.VITE_API_URL;
const SLOT_HEIGHT = 24;
const HEADER_HEIGHT = 32;
const TIMES = Array.from({ length: 25 }, (_, index) => {
  const minutes = 7 * 60 + index * CALENDAR_STEP_MINUTES;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
});

type EventType = 'class' | 'consult';
type CalendarView = 'current' | 'imported' | 'both';

interface CalendarItem extends ImportRow {
  type: EventType;
}

interface CurrentScheduleItem {
  id: string;
  type: EventType;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  subject?: string;
  section?: string;
  room?: string;
  label?: string;
}

interface EditorDraft {
  id: string | null;
  type: EventType;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  subject: string;
  section: string;
  room: string;
  needsReview: boolean;
  reviewReasons: string[];
  isNew: boolean;
}

interface CurrentSchedule {
  classes: CurrentScheduleItem[];
  hours: CurrentScheduleItem[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function currentRows(value: unknown, type: EventType, source: string): CurrentScheduleItem[] {
  if (!Array.isArray(value)) throw new Error('The server returned an invalid current schedule.');
  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new Error('The server returned an invalid current schedule row.');
    const rawDay = entry.dayOfWeek;
    const dayOfWeek = typeof rawDay === 'number' || (typeof rawDay === 'string' && rawDay.trim() !== '')
      ? Number(rawDay)
      : Number.NaN;
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6
      || typeof entry.startTime !== 'string' || typeof entry.endTime !== 'string') {
      throw new Error('The server returned a current schedule row with invalid day or time values.');
    }
    const rawId = typeof entry._id === 'string' ? entry._id : typeof entry.id === 'string' ? entry.id : String(index);
    return {
      id: `current-${source}-${rawId}`,
      type,
      dayOfWeek,
      startTime: entry.startTime,
      endTime: entry.endTime,
      subject: typeof entry.subject === 'string' ? entry.subject : undefined,
      section: typeof entry.section === 'string' ? entry.section : undefined,
      room: typeof entry.room === 'string' ? entry.room : undefined,
      label: typeof entry.label === 'string' ? entry.label : undefined,
    };
  });
}

function formatClock(time: string): string {
  const minutes = timeToMinutes(time);
  if (minutes === null) return time;
  const hour = Math.floor(minutes / 60);
  return `${((hour + 11) % 12) + 1}:${String(minutes % 60).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function eventName(item: Pick<CalendarItem, 'type' | 'subject' | 'section' | 'room' | 'label'>): string {
  if (item.type === 'consult') return item.label || 'Consultation hours';
  return [item.subject || 'Untitled class', item.section, item.room].filter(Boolean).join(' · ');
}

function displayDay(day: number): number {
  return Number.isInteger(day) && day >= 0 && day <= 6 ? day : 1;
}

function isFutureDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date)
    && date > new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

export default function ScheduleDraftCalendar() {
  const { state, actions } = useImportSession();
  const [view, setView] = useState<CalendarView>('imported');
  const [editor, setEditor] = useState<EditorDraft | null>(null);
  const [current, setCurrent] = useState<CurrentSchedule | null>(null);
  const [currentError, setCurrentError] = useState('');
  const border = useColorModeValue('#cbd5e1', '#334155');
  const muted = useColorModeValue('#64748b', '#8fa6c4');
  const classBg = useColorModeValue('#bfdbfe', '#1e3a8a');
  const classFg = useColorModeValue('#172554', '#eff6ff');
  const consultBg = useColorModeValue('#bbf7d0', '#166534');
  const consultFg = useColorModeValue('#14532d', '#f0fdf4');
  const currentClassBg = useColorModeValue('#dbeafe', '#1e293b');
  const currentConsultBg = useColorModeValue('#dcfce7', '#1f2937');
  const errorBg = useColorModeValue('#fee2e2', '#4c1d1d');
  const warningBg = useColorModeValue('#fef3c7', '#4a3a12');
  const { classes, hours, facultyId, report, parsed, effDate, minimized } = state;

  useEffect(() => {
    if (minimized || !parsed || !facultyId) return undefined;
    let cancelled = false;
    const getRows = async (path: string): Promise<unknown> => {
      const response = await authFetch(`${API}/api/faculty/${path}`);
      const data: unknown = await response.json();
      if (!response.ok) {
        const message = isRecord(data) && typeof data.error === 'string' ? data.error : 'Could not load the current schedule.';
        throw new Error(message);
      }
      return data;
    };

    void Promise.all([
      getRows(`my-schedule/${encodeURIComponent(facultyId)}`),
      getRows(`consultation-hours/${encodeURIComponent(facultyId)}`),
      getRows(`added-hours/of/${encodeURIComponent(facultyId)}`),
    ]).then(([classData, officialData, addedData]) => {
      if (cancelled) return;
      setCurrentError('');
      setCurrent({
        classes: currentRows(classData, 'class', 'classes'),
        hours: [...currentRows(officialData, 'consult', 'official'), ...currentRows(addedData, 'consult', 'added')],
      });
    }).catch((error: unknown) => {
      if (cancelled) return;
      setCurrentError(error instanceof Error ? error.message : 'Could not load the current schedule.');
    });

    return () => { cancelled = true; };
  }, [facultyId, minimized, parsed]);

  const imported = useMemo<CalendarItem[]>(() => [
    ...classes.map(row => ({ ...row, type: 'class' as const })),
    ...hours.map(row => ({ ...row, type: 'consult' as const })),
  ], [classes, hours]);
  const overlapIds = useMemo(() => new Set(findOverlappingIds(imported)), [imported]);
  const issuesByRow = useMemo(() => {
    const map = new Map<string, { errors: string[]; warnings: string[] }>();
    const add = (issue: ImportIssue, kind: 'errors' | 'warnings') => {
      if (!issue.ref) return;
      const key = `${issue.ref.type}:${issue.ref.id}`;
      const existing = map.get(key) || { errors: [], warnings: [] };
      existing[kind].push(issue.message);
      map.set(key, existing);
    };
    report?.errors.forEach(issue => add(issue, 'errors'));
    report?.warnings.forEach(issue => add(issue, 'warnings'));
    return map;
  }, [report]);
  const draftDays = visibleDays({ classDays: classes.map(row => displayDay(row.dayOfWeek)) });
  const visibleCurrent = view !== 'imported' && current;
  const visibleImported = view !== 'current';
  const effectivityDate = effDate || parsed?.metadata.effectivityDate || '';
  const future = isFutureDate(effectivityDate);
  const consultationMinutes = hours.reduce((total, row) => {
    const start = timeToMinutes(row.startTime);
    const end = timeToMinutes(row.endTime);
    return start !== null && end !== null ? total + Math.max(0, end - start) : total;
  }, 0);

  const openNew = (dayOfWeek: number, startTime: string) => {
    const start = timeToMinutes(startTime) ?? 8 * 60;
    const end = Math.min(start + 60, 19 * 60);
    setEditor({
      id: null,
      type: 'class',
      dayOfWeek,
      startTime,
      endTime: `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`,
      subject: '',
      section: '',
      room: '',
      needsReview: false,
      reviewReasons: [],
      isNew: true,
    });
  };

  const openEdit = (item: CalendarItem) => setEditor({
    id: item.id,
    type: item.type,
    dayOfWeek: item.dayOfWeek,
    startTime: item.startTime,
    endTime: item.endTime,
    subject: item.subject || '',
    section: item.section || '',
    room: item.room || '',
    needsReview: item.needsReview,
    reviewReasons: item.reviewReasons,
    isNew: false,
  });

  const saveEditor = () => {
    if (!editor) return;
    const patch: Partial<ImportRow> = {
      dayOfWeek: editor.dayOfWeek,
      startTime: editor.startTime,
      endTime: editor.endTime,
      needsReview: editor.needsReview,
      reviewReasons: editor.reviewReasons,
    };
    if (editor.type === 'class') {
      Object.assign(patch, { subject: editor.subject, section: editor.section, room: editor.room });
      if (editor.isNew) {
        actions.addClass();
        actions.editClass(`n${state.nextId}`, patch);
      } else if (editor.id) {
        actions.editClass(editor.id, patch);
      }
    } else if (editor.isNew) {
      actions.addHour();
      actions.editHour(`n${state.nextId}`, patch);
    } else if (editor.id) {
      actions.editHour(editor.id, patch);
    }
    setEditor(null);
  };

  const deleteEditor = () => {
    if (!editor?.id || editor.isNew) return;
    actions.removeRow(editor.type, editor.id);
    setEditor(null);
  };

  const eventIssues = (item: CalendarItem): { errors: string[]; warnings: string[] } =>
    issuesByRow.get(`${item.type}:${item.id}`) || { errors: [], warnings: [] };

  const renderImported = (item: CalendarItem, split: boolean) => {
    const position = calendarEventPosition(item.startTime, item.endTime, SLOT_HEIGHT) || { top: 0, height: SLOT_HEIGHT - 2 };
    const issues = eventIssues(item);
    const localOverlap = overlapIds.has(item.id);
    const messages = [
      ...(item.needsReview ? (item.reviewReasons.length ? item.reviewReasons : ['Check this row against the scan.']) : []),
      ...(localOverlap ? ['Overlaps another event in this imported draft.'] : []),
      ...issues.errors,
      ...issues.warnings,
    ];
    const hasError = issues.errors.length > 0;
    const hasWarning = item.needsReview || localOverlap || issues.warnings.length > 0;
    return (
      <Tooltip key={`imported-${item.type}-${item.id}`} label={messages.length ? messages.join('\n') : `${eventName(item)}: ${formatClock(item.startTime)}–${formatClock(item.endTime)}`} hasArrow placement="top">
        <Button
          type="button"
          size="xs"
          variant="solid"
          position="absolute"
          left={split ? '50%' : '2px'}
          right="2px"
          top={`${position.top}px`}
          height={`${position.height}px`}
          minH="14px"
          zIndex={2}
          overflow="hidden"
          whiteSpace="normal"
          justifyContent="flex-start"
          alignItems="flex-start"
          px={1}
          py="1px"
          bg={hasError ? errorBg : hasWarning ? warningBg : item.type === 'class' ? classBg : consultBg}
          color={hasError ? 'red.900' : hasWarning ? 'orange.900' : item.type === 'class' ? classFg : consultFg}
          borderWidth="1px"
          borderColor={hasError ? 'red.500' : hasWarning ? 'orange.500' : 'transparent'}
          borderStyle={hasWarning && !hasError ? 'dashed' : 'solid'}
          _hover={{ filter: 'brightness(0.96)' }}
          aria-label={`${eventName(item)}, ${DAY_LONG[item.dayOfWeek]}, ${formatClock(item.startTime)} to ${formatClock(item.endTime)}${messages.length ? `. ${messages.join(' ')}` : ''}`}
          onClick={() => openEdit(item)}
        >
          <Box minW={0} textAlign="left">
            <Text fontSize="10px" fontWeight="700" noOfLines={1}>{eventName(item)}</Text>
            <Text fontSize="9px" noOfLines={1}>{formatClock(item.startTime)}–{formatClock(item.endTime)}</Text>
          </Box>
        </Button>
      </Tooltip>
    );
  };

  const renderCurrent = (item: CurrentScheduleItem, split: boolean) => {
    const position = calendarEventPosition(item.startTime, item.endTime, SLOT_HEIGHT);
    if (!position) return null;
    const bg = item.type === 'class' ? currentClassBg : currentConsultBg;
    return (
      <Box
        key={item.id}
        position="absolute"
        left="2px"
        right={split ? '51%' : '2px'}
        top={`${position.top}px`}
        height={`${position.height}px`}
        minH="14px"
        zIndex={1}
        overflow="hidden"
        borderRadius="sm"
        borderWidth="1px"
        borderColor={border}
        bg={bg}
        opacity={0.45}
        pointerEvents="none"
        px={1}
        py="1px"
        title={`Current: ${item.subject || item.label || 'Consultation hours'} ${formatClock(item.startTime)}–${formatClock(item.endTime)}`}
      >
        <Text fontSize="10px" fontWeight="600" noOfLines={1}>{item.subject || item.label || 'Consultation hours'}</Text>
        <Text fontSize="9px" noOfLines={1}>{formatClock(item.startTime)}–{formatClock(item.endTime)}</Text>
      </Box>
    );
  };

  const dayOptions = (days: readonly number[]) =>
    [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
      .map(day => <option key={day} value={day}>{DAY_LONG[day]}</option>);
  const timeOptions = TIMES.map(time => <option key={time} value={time}>{formatClock(time)}</option>);
  const editorRow = editor?.id
    ? imported.find(item => item.id === editor.id && item.type === editor.type)
    : undefined;
  const editorMessages = editorRow ? [
    ...(editorRow.needsReview ? (editorRow.reviewReasons.length ? editorRow.reviewReasons : ['Check this row against the scan.']) : []),
    ...(overlapIds.has(editorRow.id) ? ['Overlaps another event in this imported draft.'] : []),
    ...eventIssues(editorRow).errors,
    ...eventIssues(editorRow).warnings,
  ] : [];

  return (
    <VStack align="stretch" spacing={3}>
      <HStack justify="space-between" align="start" wrap="wrap">
        <VStack align="start" spacing={1}>
          <HStack wrap="wrap" fontSize="sm">
            <Text fontWeight="700">Weekly schedule draft</Text>
            <Badge colorScheme="blue">{classes.length} classes</Badge>
            <Badge colorScheme="green">{hours.length} consultation blocks</Badge>
            <Badge colorScheme={consultationMinutes === 240 ? 'green' : 'orange'}>{(consultationMinutes / 60).toFixed(1)} of 4 hours</Badge>
          </HStack>
          <Text fontSize="xs" color={muted}>Effectivity date: {effectivityDate || 'not set'}</Text>
        </VStack>
        <HStack role="group" aria-label="Schedule layers" spacing={1}>
          {(['current', 'imported', 'both'] as const).map(option => (
            <Button
              key={option}
              size="sm"
              variant={view === option ? 'solid' : 'outline'}
              colorScheme="blue"
              aria-pressed={view === option}
              onClick={() => setView(option)}
            >
              {option === 'current' ? 'Current' : option === 'imported' ? 'Imported' : 'Both'}
            </Button>
          ))}
        </HStack>
      </HStack>

      {future && (
        <Alert status="info" borderRadius="md" py={2}>
          <AlertIcon />
          <Text fontSize="sm">The current schedule stays in place until {effectivityDate}.</Text>
        </Alert>
      )}
      {view !== 'imported' && !current && !currentError && <HStack><Spinner size="xs" /><Text fontSize="xs" color={muted}>Loading current schedule...</Text></HStack>}
      {view !== 'imported' && currentError && (
        <Alert status="error" borderRadius="md" py={2}><AlertIcon /><Text fontSize="sm">Could not load the current schedule: {currentError}</Text></Alert>
      )}
      {overlapIds.size > 0 && (
        <Alert status="warning" borderRadius="md" py={2}>
          <AlertIcon />
          <Text fontSize="sm">{overlapIds.size} draft event(s) overlap another imported event. Select a highlighted event for details.</Text>
        </Alert>
      )}

      <Box overflowX="auto">
        <Flex
          minW={`${72 + draftDays.length * (view === 'both' ? 190 : 130)}px`}
          borderWidth="1px"
          borderColor={border}
          borderRadius="md"
          overflow="hidden"
        >
          <Box w="72px" flexShrink={0} position="relative" borderRightWidth="1px" borderColor={border}>
            <Box h={`${HEADER_HEIGHT}px`} borderBottomWidth="1px" borderColor={border} />
            <Box position="relative" height={`${CALENDAR_SLOT_COUNT * SLOT_HEIGHT}px`}>
              {Array.from({ length: 13 }, (_, index) => (
                <Text
                  key={index}
                  position="absolute"
                  top={`${Math.min(
                    Math.max(0, index * 2 * SLOT_HEIGHT - 7),
                    CALENDAR_SLOT_COUNT * SLOT_HEIGHT - 14,
                  )}px`}
                  right={1}
                  fontSize="10px"
                  color={muted}
                >
                  {formatClock(`${String(7 + index).padStart(2, '0')}:00`)}
                </Text>
              ))}
            </Box>
          </Box>
          {draftDays.map(day => {
            const currentItems = [
              ...(current?.classes || []),
              ...(current?.hours || []),
            ].filter(item => item.dayOfWeek === day);
            const draftItems = imported.filter(item => displayDay(item.dayOfWeek) === day);
            const split = view === 'both';
            return (
              <Box
                key={day}
                flex="1"
                minW={view === 'both' ? '190px' : '130px'}
                borderRightWidth={day !== draftDays[draftDays.length - 1] ? '1px' : 0}
                borderColor={border}
              >
                <Text
                  h={`${HEADER_HEIGHT}px`}
                  lineHeight={`${HEADER_HEIGHT}px`}
                  textAlign="center"
                  fontSize="xs"
                  fontWeight="700"
                  color={muted}
                  borderBottomWidth="1px"
                  borderColor={border}
                >
                  {DAY_SHORT[day]}
                </Text>
                <Box position="relative" height={`${CALENDAR_SLOT_COUNT * SLOT_HEIGHT}px`}>
                  {Array.from({ length: CALENDAR_SLOT_COUNT }, (_, slot) => {
                    const time = calendarTimeAtSlot(slot);
                    return time ? (
                      <Button
                        key={time}
                        type="button"
                        variant="unstyled"
                        position="absolute"
                        left={0}
                        right={0}
                        top={`${slot * SLOT_HEIGHT}px`}
                        width="100%"
                        height={`${SLOT_HEIGHT}px`}
                        minH={`${SLOT_HEIGHT}px`}
                        p={0}
                        borderTopWidth="1px"
                        borderColor={border}
                        borderRadius={0}
                        aria-label={`Add an event on ${DAY_LONG[day]} at ${formatClock(time)}`}
                        onClick={() => openNew(day, time)}
                      />
                    ) : null;
                  })}
                  {visibleCurrent && currentItems.map(item => renderCurrent(item, split))}
                  {visibleImported && draftItems.map(item => renderImported(item, split))}
                </Box>
              </Box>
            );
          })}
        </Flex>
      </Box>

      <HStack spacing={4} fontSize="xs" color={muted} wrap="wrap">
        <HStack><Box w="12px" h="12px" bg={classBg} borderRadius="sm" /><Text>Imported class</Text></HStack>
        <HStack><Box w="12px" h="12px" bg={consultBg} borderRadius="sm" /><Text>Imported consultation hours</Text></HStack>
        <HStack><Box w="12px" h="12px" bg={warningBg} borderWidth="1px" borderStyle="dashed" borderColor="orange.500" borderRadius="sm" /><Text>Review / draft clash</Text></HStack>
        <HStack><Box w="12px" h="12px" bg={currentClassBg} opacity={0.5} borderWidth="1px" borderColor={border} borderRadius="sm" /><Text>Current schedule (faint)</Text></HStack>
      </HStack>
      <Text fontSize="xs" color={muted}>Click an event to edit it. Click an empty 30-minute slot to add a class or consultation block.</Text>

      <Modal isOpen={!!editor} onClose={() => setEditor(null)} size="lg" isCentered>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>{editor?.isNew ? 'Add schedule event' : 'Edit schedule event'}</ModalHeader>
          <ModalCloseButton />
          {editor && (
            <>
              <ModalBody>
                <VStack align="stretch" spacing={3}>
                  {editorMessages.length > 0 && (
                    <Alert status={editorRow && eventIssues(editorRow).errors.length ? 'error' : 'warning'} borderRadius="md">
                      <AlertIcon />
                      <VStack align="start" spacing={0}>
                        {editorMessages.map((message, index) => <Text key={index} fontSize="sm">{message}</Text>)}
                      </VStack>
                    </Alert>
                  )}
                  {editor.isNew && (
                    <FormControl>
                      <FormLabel fontSize="sm">Event type</FormLabel>
                      <Select
                        size="sm"
                        value={editor.type}
                        onChange={event => {
                          const type: EventType = event.target.value === 'consult' ? 'consult' : 'class';
                          setEditor(currentEditor => currentEditor ? {
                            ...currentEditor,
                            type,
                            dayOfWeek: type === 'consult' && !CONSULTATION_DAYS.includes(currentEditor.dayOfWeek as (typeof CONSULTATION_DAYS)[number])
                              ? 1
                              : currentEditor.dayOfWeek,
                          } : null);
                        }}
                      >
                        <option value="class">Class</option>
                        <option value="consult">Consultation hours</option>
                      </Select>
                    </FormControl>
                  )}
                  {editor.type === 'class' && (
                    <>
                      <FormControl>
                        <FormLabel fontSize="sm">Subject</FormLabel>
                        <Input size="sm" value={editor.subject} onChange={event => setEditor({ ...editor, subject: event.target.value })} />
                      </FormControl>
                      <FormControl>
                        <FormLabel fontSize="sm">Section</FormLabel>
                        <Input size="sm" value={editor.section} onChange={event => setEditor({ ...editor, section: event.target.value })} />
                      </FormControl>
                      <FormControl>
                        <FormLabel fontSize="sm">Room</FormLabel>
                        <Input size="sm" value={editor.room} onChange={event => setEditor({ ...editor, room: event.target.value })} />
                      </FormControl>
                    </>
                  )}
                  <FormControl>
                    <FormLabel fontSize="sm">Day</FormLabel>
                    <Select
                      size="sm"
                      value={editor.dayOfWeek}
                      onChange={event => setEditor({ ...editor, dayOfWeek: Number(event.target.value) })}
                    >
                      {dayOptions(editor.type === 'class' ? CLASS_DAYS : CONSULTATION_DAYS)}
                    </Select>
                  </FormControl>
                  <Flex gap={3}>
                    <FormControl>
                      <FormLabel fontSize="sm">Start</FormLabel>
                      <Select size="sm" value={editor.startTime} onChange={event => setEditor({ ...editor, startTime: event.target.value })}>
                        {timeOptions}
                      </Select>
                    </FormControl>
                    <FormControl>
                      <FormLabel fontSize="sm">End</FormLabel>
                      <Select size="sm" value={editor.endTime} onChange={event => setEditor({ ...editor, endTime: event.target.value })}>
                        {timeOptions}
                      </Select>
                    </FormControl>
                  </Flex>
                  {editor.needsReview && (
                    <Checkbox isChecked={false} onChange={() => setEditor({ ...editor, needsReview: false })}>
                      I checked this row against the scan
                    </Checkbox>
                  )}
                  {editor.type === 'consult' && <Text fontSize="xs" color={muted}>Consultation hours are Monday to Friday only.</Text>}
                </VStack>
              </ModalBody>
              <ModalFooter gap={2}>
                {!editor.isNew && <Button variant="outline" colorScheme="red" mr="auto" onClick={deleteEditor}>Delete</Button>}
                <Button variant="ghost" onClick={() => setEditor(null)}>Cancel</Button>
                <Button colorScheme="blue" onClick={saveEditor}>{editor.isNew ? 'Add event' : 'Save changes'}</Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </VStack>
  );
}
