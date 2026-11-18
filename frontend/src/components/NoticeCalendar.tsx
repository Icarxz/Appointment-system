import { useEffect, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Box, Button, Flex, HStack, IconButton, Text } from '@chakra-ui/react';
import { ChevronLeftIcon, ChevronRightIcon } from '@chakra-ui/icons';
import { useNavPalette } from '../utils/uiTokens';
import {
  CAL_END_HOUR, CAL_START_HOUR, addDays, dayText, hourText, leaveCoverage, leaveQuestion, mondayOf, meetingQuestion,
  pickLeave, pickMeeting,
} from '../utils/noticePicker';
import type { DayPart, LeavePick, MeetingPick } from '../utils/noticePicker';

// The week grid used by Post a Notice. Monday to Friday, 7:00 AM to 5:00 PM.
// Classes are grey and consultation hours are green, so conflicts are visible before posting.
//   Meeting: tap a start hour, then an end hour on the same day.
//   Leave:   tap the first day, then the last day (whole day, or the morning / afternoon half). The arrows move between weeks
//            and the first day stays picked, so a leave can run over several weeks.
// Nothing is saved here: when a range is finished it is handed to the parent (onComplete), which asks for confirmation.

const ROW = 44;                                  // pixels per hour
const HOURS = Array.from({ length: CAL_END_HOUR - CAL_START_HOUR }, (_, i) => CAL_START_HOUR + i); // 7 ... 16
const BODY = HOURS.length * ROW;
const FOOT = 22;                                 // the thin "5:00 PM" row: a meeting may end there
const NOON_TOP = (12 - CAL_START_HOUR) * ROW;
const DAYS = [0, 1, 2, 3, 4];                    // Monday ... Friday

const mins = (t: string) => { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
const topOf = (t: string) => ((mins(t) - CAL_START_HOUR * 60) / 60) * ROW;

export type NoticePick = { type: 'IN_MEETING'; meeting: MeetingPick } | { type: 'ON_LEAVE'; leave: LeavePick };

interface Props {
  mode: 'IN_MEETING' | 'ON_LEAVE';
  classes: any[];            // { dayOfWeek, startTime, endTime, subject }
  consult: any[];            // { dayOfWeek, startTime, endTime }: fixed plus added consultation hours
  today: string;             // Manila "YYYY-MM-DD"
  maxDate: string;           // the furthest day a notice may start on (the server enforces it too)
  onComplete: (pick: NoticePick) => void;   // a range was finished: ask the faculty to confirm it
  onChange: (pick: NoticePick | null) => void; // the finished range changed, or was cleared
}

export default function NoticeCalendar({ mode, classes, consult, today, maxDate, onComplete, onChange }: Props) {
  const p = useNavPalette();
  const [weekStart, setWeekStart] = useState(mondayOf(today));
  const [meeting, setMeeting] = useState<MeetingPick | null>(null);
  const [leave, setLeave] = useState<LeavePick>({ start: null, end: null });
  const [size, setSize] = useState<'FULL' | 'HALF'>('FULL');
  const [error, setError] = useState('');

  // A different notice type starts from a clean selection.
  useEffect(() => { setMeeting(null); setLeave({ start: null, end: null }); setError(''); onChange(null); }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const dates = DAYS.map((i) => addDays(weekStart, i));
  const canPrev = weekStart > mondayOf(today);
  const canNext = addDays(weekStart, 7) <= maxDate;
  const enabled = (d: string) => d >= today && d <= maxDate;

  const classGrey = p.dk ? '#4a5568' : '#cbd5e0';
  const consultGreen = p.dk ? '#2f855a' : '#9ae6b4';
  const blockText = p.dk ? '#f7fafc' : '#1a202c';
  const selBlue = 'rgba(49,130,206,0.45)';
  const leavePurple = 'rgba(128,90,213,0.40)';

  const clear = () => { setMeeting(null); setLeave({ start: null, end: null }); setError(''); onChange(null); };

  const tapMeeting = (date: string, hour: number) => {
    const r = pickMeeting(meeting, date, hour);
    setError(r.error || '');
    if (r.error || !r.sel) return;
    setMeeting(r.sel);
    if (r.done) { const pick: NoticePick = { type: 'IN_MEETING', meeting: r.sel }; onChange(pick); onComplete(pick); }
    else onChange(null); // a new start: the earlier finished range no longer stands
  };

  const tapLeave = (date: string, part: DayPart) => {
    const r = pickLeave(leave, { date, part });
    setError(r.error || '');
    if (r.error || !r.sel) return;
    setLeave(r.sel);
    if (r.done) { const pick: NoticePick = { type: 'ON_LEAVE', leave: r.sel }; onChange(pick); onComplete(pick); }
    else onChange(null);
  };

  const tapCell = (date: string, hour: number) => {
    if (mode === 'IN_MEETING') tapMeeting(date, hour);
    else tapLeave(date, size === 'FULL' ? 'FULL' : hour < 12 ? 'AM' : 'PM');
  };

  const weekText = `${dayText(dates[0])} – ${dayText(dates[4])}`;
  const meetingPending = mode === 'IN_MEETING' && meeting && meeting.endHour === null;
  const leavePending = mode === 'ON_LEAVE' && leave.start && !leave.end;

  const help = (() => {
    if (mode === 'IN_MEETING') {
      if (meetingPending) return `Start ${hourText(meeting!.startHour)} on ${dayText(meeting!.date)}. Now tap the hour it ends (tap 3 PM for a meeting that ends at 3:00 PM).`;
      if (meeting) return `${meetingQuestion(meeting).replace(/\?$/, '')}. Tap a new start hour to change it.`;
      return 'Tap the hour the meeting starts, then the hour it ends.';
    }
    if (leavePending) return `First day: ${dayText(leave.start!.date)}. Now tap the last day. Use the arrows to go to another week.`;
    if (leave.start && leave.end) return `${leaveQuestion(leave).replace(/\?$/, '')}. Tap a day to start a new range.`;
    return 'Tap the first day of your leave, then the last day. Use the arrows to move between weeks.';
  })();

  return (
    <Box w="100%">
      <Flex align="center" justify="space-between" gap={3} mb={2} wrap="wrap">
        <HStack spacing={1}>
          <IconButton aria-label="Previous week" size="sm" variant="outline" icon={<ChevronLeftIcon />} isDisabled={!canPrev} onClick={() => setWeekStart(addDays(weekStart, -7))} />
          <Text fontSize="sm" fontWeight="semibold" color={p.text} minW="150px" textAlign="center">{weekText}</Text>
          <IconButton aria-label="Next week" size="sm" variant="outline" icon={<ChevronRightIcon />} isDisabled={!canNext} onClick={() => setWeekStart(addDays(weekStart, 7))} />
        </HStack>
        {mode === 'ON_LEAVE' && (
          <HStack spacing={0} role="group" aria-label="Day length">
            <Button size="xs" borderRightRadius={0} variant={size === 'FULL' ? 'solid' : 'outline'} colorScheme="blue" onClick={() => setSize('FULL')}>Whole day</Button>
            <Button size="xs" borderLeftRadius={0} variant={size === 'HALF' ? 'solid' : 'outline'} colorScheme="blue" onClick={() => setSize('HALF')}>Half day</Button>
          </HStack>
        )}
        {(meeting || leave.start) && <Button size="xs" variant="ghost" onClick={clear}>Clear selection</Button>}
      </Flex>

      <HStack spacing={4} mb={2} fontSize="xs" color={p.textMid} wrap="wrap">
        <HStack spacing={1}><Box w={3} h={3} borderRadius="sm" bg={classGrey} /><Text>Classes</Text></HStack>
        <HStack spacing={1}><Box w={3} h={3} borderRadius="sm" bg={consultGreen} /><Text>Consultation hours</Text></HStack>
        <HStack spacing={1}><Box w={3} h={3} borderRadius="sm" bg={mode === 'ON_LEAVE' ? leavePurple : selBlue} borderWidth="1px" borderColor={mode === 'ON_LEAVE' ? '#805ad5' : '#3182ce'} /><Text>{mode === 'ON_LEAVE' ? 'Leave' : 'Meeting'}</Text></HStack>
        {mode === 'ON_LEAVE' && size === 'HALF' && <Text>Tap above or below the noon line for the morning or afternoon.</Text>}
      </HStack>

      {/* Narrow screens scroll sideways so the day and time grid keeps its shape. */}
      <Box overflowX="auto" borderWidth="1px" borderColor={p.border} borderRadius="md" bg={p.surface}>
        <Box minW="540px">
          <Flex>
            <Box w="46px" flexShrink={0} />
            {dates.map((d, i) => {
              const ok = enabled(d);
              const covered = mode === 'ON_LEAVE' ? leaveCoverage(leave, d) : { am: false, pm: false };
              const inLeave = covered.am || covered.pm;
              return (
                <Box
                  key={d} flex="1" textAlign="center" py={1} borderLeftWidth="1px" borderColor={p.border}
                  role={mode === 'ON_LEAVE' && ok ? 'button' : undefined}
                  tabIndex={mode === 'ON_LEAVE' && ok ? 0 : undefined}
                  cursor={mode === 'ON_LEAVE' && ok ? 'pointer' : undefined}
                  onClick={mode === 'ON_LEAVE' && ok ? () => tapLeave(d, 'FULL') : undefined}
                  onKeyDown={mode === 'ON_LEAVE' && ok ? (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tapLeave(d, 'FULL'); } } : undefined}
                  aria-label={mode === 'ON_LEAVE' && ok ? `${dayText(d)}, whole day` : undefined}
                  opacity={ok ? 1 : 0.45}
                  bg={inLeave ? leavePurple : undefined}
                >
                  <Text fontSize="xs" color={p.textMid}>{['Mon', 'Tue', 'Wed', 'Thu', 'Fri'][i]}</Text>
                  <Text fontSize="sm" fontWeight="semibold" color={p.text}>{Number(d.slice(8))}</Text>
                  {d === today && <Text fontSize="10px" color="blue.400">Today</Text>}
                </Box>
              );
            })}
          </Flex>

          <Flex>
            <Box w="46px" flexShrink={0} position="relative" h={`${BODY + FOOT}px`}>
              {HOURS.map((h) => (
                <Text key={h} position="absolute" top={`${(h - CAL_START_HOUR) * ROW - 7}px`} right="6px" fontSize="10px" color={p.textMid}>
                  {h === 7 ? '' : hourText(h).replace(':00', '')}
                </Text>
              ))}
              <Text position="absolute" top={`${BODY - 7}px`} right="6px" fontSize="10px" color={p.textMid}>5 PM</Text>
            </Box>

            {dates.map((d, i) => {
              const ok = enabled(d);
              const dow = i + 1; // Monday = 1 ... Friday = 5 (stored day numbers)
              const covered = mode === 'ON_LEAVE' ? leaveCoverage(leave, d) : { am: false, pm: false };
              const m = mode === 'IN_MEETING' && meeting && meeting.date === d ? meeting : null;
              const sameDayPending = !!(meetingPending && meeting!.date === d);
              return (
                <Box key={d} flex="1" position="relative" h={`${BODY + FOOT}px`} borderLeftWidth="1px" borderColor={p.border} opacity={ok ? 1 : 0.45}>
                  {HOURS.map((h) => (
                    <Box
                      key={h} as="button" role="group" type="button" disabled={!ok}
                      position="absolute" left={0} right={0} top={`${(h - CAL_START_HOUR) * ROW}px`} h={`${ROW}px`}
                      borderTopWidth="1px" borderColor={p.border} cursor={ok ? 'pointer' : 'not-allowed'}
                      _hover={ok ? { bg: p.dk ? 'whiteAlpha.100' : 'blackAlpha.50' } : undefined}
                      aria-label={`${dayText(d)}, ${hourText(h)}${meetingPending ? `, end at ${hourText(h)}` : ''}`}
                      onClick={() => ok && tapCell(d, h)}
                    >
                      {sameDayPending && h > meeting!.startHour && (
                        <Text fontSize="10px" color={p.textMid} opacity={0} _groupHover={{ opacity: 1 }} textAlign="center">ends {hourText(h).replace(':00', '')}</Text>
                      )}
                    </Box>
                  ))}
                  {mode === 'IN_MEETING' && (
                    <Box
                      as="button" type="button" disabled={!ok || !sameDayPending}
                      position="absolute" left={0} right={0} top={`${BODY}px`} h={`${FOOT}px`}
                      borderTopWidth="1px" borderColor={p.border} fontSize="10px" color={p.textMid}
                      cursor={ok && sameDayPending ? 'pointer' : 'default'}
                      aria-label={`${dayText(d)}, end at 5:00 PM`}
                      onClick={() => ok && tapMeeting(d, CAL_END_HOUR)}
                    >
                      {sameDayPending ? 'ends 5 PM' : ''}
                    </Box>
                  )}

                  {/* Classes (grey) and consultation hours (green). They do not take taps, so the cell underneath still gets them. */}
                  {classes.filter((b) => b.dayOfWeek === dow).map((b, k) => (
                    <Box key={`c${k}`} position="absolute" left="2px" right="2px" top={`${Math.max(0, topOf(b.startTime))}px`}
                      h={`${Math.max(8, Math.min(BODY, topOf(b.endTime)) - Math.max(0, topOf(b.startTime)))}px`}
                      bg={classGrey} color={blockText} borderRadius="sm" px={1} overflow="hidden" fontSize="10px" lineHeight="1.2" pointerEvents="none" zIndex={1}>
                      {b.subject || 'Class'}
                    </Box>
                  ))}
                  {consult.filter((b) => b.dayOfWeek === dow).map((b, k) => (
                    <Box key={`h${k}`} position="absolute" left="2px" right="2px" top={`${Math.max(0, topOf(b.startTime))}px`}
                      h={`${Math.max(8, Math.min(BODY, topOf(b.endTime)) - Math.max(0, topOf(b.startTime)))}px`}
                      bg={consultGreen} color={blockText} borderRadius="sm" px={1} overflow="hidden" fontSize="10px" lineHeight="1.2" pointerEvents="none" zIndex={1}>
                      Consultation
                    </Box>
                  ))}

                  {/* The selection */}
                  {m && (
                    <Box position="absolute" left="0" right="0" zIndex={2} pointerEvents="none"
                      top={`${(m.startHour - CAL_START_HOUR) * ROW}px`}
                      h={`${((m.endHour ?? m.startHour + 1) - m.startHour) * ROW}px`}
                      bg={selBlue} borderWidth="2px" borderColor="#3182ce" borderStyle={m.endHour === null ? 'dashed' : 'solid'} borderRadius="sm"
                      color={blockText} fontSize="10px" fontWeight="semibold" px={1} overflow="hidden">
                      {m.endHour === null
                        ? `Start ${hourText(m.startHour).replace(':00', '')}`
                        : `${hourText(m.startHour).replace(':00', '')} to ${hourText(m.endHour).replace(':00', '')}`}
                    </Box>
                  )}
                  {covered.am && (
                    <Box position="absolute" left="0" right="0" top="0" h={`${NOON_TOP}px`} zIndex={2} pointerEvents="none" bg={leavePurple} borderWidth="2px" borderColor="#805ad5" borderBottomWidth={covered.pm ? 0 : '2px'}>
                      <Text fontSize="10px" fontWeight="semibold" color={blockText} px={1}>{covered.pm ? 'Leave' : 'Leave AM'}</Text>
                    </Box>
                  )}
                  {covered.pm && (
                    <Box position="absolute" left="0" right="0" top={`${NOON_TOP}px`} h={`${BODY - NOON_TOP}px`} zIndex={2} pointerEvents="none" bg={leavePurple} borderWidth="2px" borderColor="#805ad5" borderTopWidth={covered.am ? 0 : '2px'}>
                      {!covered.am && <Text fontSize="10px" fontWeight="semibold" color={blockText} px={1}>Leave PM</Text>}
                    </Box>
                  )}
                  {mode === 'ON_LEAVE' && size === 'HALF' && (
                    <Box position="absolute" left={0} right={0} top={`${NOON_TOP}px`} borderTopWidth="1px" borderStyle="dashed" borderColor={p.textMid} zIndex={3} pointerEvents="none" />
                  )}
                </Box>
              );
            })}
          </Flex>
        </Box>
      </Box>

      <Text mt={2} fontSize="sm" color={p.text}>{help}</Text>
      {error && <Text mt={1} fontSize="sm" color="red.400" role="alert">{error}</Text>}
    </Box>
  );
}
