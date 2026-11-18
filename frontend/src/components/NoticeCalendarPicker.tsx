import { useState } from 'react';
import { Box, Button, Flex, HStack, Text, useColorModeValue } from '@chakra-ui/react';

// A week grid (Monday to Friday, 7 AM to 8 PM) for choosing WHEN a meeting or leave happens by tapping,
// the same kind of calendar as the Master Schedule. Your classes and consultation hours are shown behind
// the cells so you can see what the meeting or leave covers. No typing.
//   Meeting: tap the first half-hour, then the last half-hour (same day).
//   Leave:   tap the first day, then the last day (tap the same day twice for one day).

interface Block { dayOfWeek: number; startTime: string; endTime: string }
export interface PickedWhen { startDate: string; endDate: string; startTime: string; endTime: string }
interface Props {
  mode: 'IN_MEETING' | 'ON_LEAVE';
  classes: Block[];
  consult: Block[];
  /** Today in Manila, "YYYY-MM-DD". Earlier days cannot be picked. */
  today: string;
  /** Called when the second tap completes a choice. The parent asks for confirmation. */
  onPick: (p: PickedWhen) => void;
}

const FIRST_MIN = 7 * 60;
const SLOT = 30;
const ROWS = 26; // 7:00 AM to 8:00 PM
const ROW_PX = 22;
const MAX_WEEKS_AHEAD = 52;

const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
const toHHMM = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const mondayOf = (d: string) => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));
const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const hourLabel = (min: number) => `${((Math.floor(min / 60) + 11) % 12) + 1}${Math.floor(min / 60) >= 12 ? 'PM' : 'AM'}`;
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

const manilaNowMin = () => {
  const t = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hour12: false });
  return toMin(t);
};

export default function NoticeCalendarPicker({ mode, classes, consult, today, onPick }: Props) {
  const border = useColorModeValue('#dde3ec', '#1e3048');
  const muted = useColorModeValue('#6b7fa0', '#7a93b0');
  const text = useColorModeValue('#0f2240', '#e8f0fe');
  const surface = useColorModeValue('#ffffff', '#0f1f33');
  const classBg = useColorModeValue('#e2e8f0', '#2d3b50');
  const consultBg = useColorModeValue('#c6f6d5', '#1f4d3a');
  const pickBg = useColorModeValue('#bee3f8', '#2a4a7a');
  const pickEdge = useColorModeValue('#2b6cb0', '#63b3ed');

  const thisMonday = mondayOf(today);
  const [weekStart, setWeekStart] = useState(thisMonday);
  const [anchor, setAnchor] = useState<{ date: string; row: number } | null>(null); // first tap
  const [range, setRange] = useState<{ date: string; lo: number; hi: number } | null>(null); // meeting choice
  const [dayRange, setDayRange] = useState<{ lo: string; hi: string } | null>(null); // leave choice

  const dates = DAY_NAMES.map((_, i) => addDays(weekStart, i));
  const nowMin = manilaNowMin();
  const maxMonday = addDays(thisMonday, MAX_WEEKS_AHEAD * 7);

  const covers = (blocks: Block[], dow: number, row: number) => {
    const s = FIRST_MIN + row * SLOT, e = s + SLOT;
    return blocks.some(b => b.dayOfWeek === dow && toMin(b.startTime) < e && toMin(b.endTime) > s);
  };
  const isPast = (date: string, row: number) =>
    date < today || (mode === 'IN_MEETING' && date === today && FIRST_MIN + (row + 1) * SLOT <= nowMin);

  const tap = (date: string, row: number) => {
    if (isPast(date, row)) return;
    if (mode === 'IN_MEETING') {
      if (!anchor || anchor.date !== date) { setAnchor({ date, row }); setRange(null); return; }
      const lo = Math.min(anchor.row, row), hi = Math.max(anchor.row, row);
      setAnchor(null); setRange({ date, lo, hi });
      onPick({ startDate: date, endDate: date, startTime: toHHMM(FIRST_MIN + lo * SLOT), endTime: toHHMM(FIRST_MIN + (hi + 1) * SLOT) });
      return;
    }
    if (!anchor) { setAnchor({ date, row: 0 }); setDayRange(null); return; }
    const lo = anchor.date <= date ? anchor.date : date;
    const hi = anchor.date <= date ? date : anchor.date;
    setAnchor(null); setDayRange({ lo, hi });
    onPick({ startDate: lo, endDate: hi, startTime: '', endTime: '' });
  };

  const hint = mode === 'IN_MEETING'
    ? (anchor ? 'Now tap the last half-hour of the meeting (tap the same one for a 30-minute meeting).' : 'Tap the first half-hour of the meeting. Your classes are grey and your consultation hours are green.')
    : (anchor ? `First day: ${dayLabel(anchor.date)}. Now tap the last day of your leave (tap the same day again for one day).` : 'Tap the first day of your leave.');

  return (
    <Box w="100%">
      <Flex justify="space-between" align="center" mb={2} gap={2}>
        <Button size="xs" variant="outline" isDisabled={weekStart <= thisMonday} onClick={() => setWeekStart(addDays(weekStart, -7))}>Previous week</Button>
        <Text fontSize="sm" fontWeight="600" color={text}>{dayLabel(weekStart)} to {dayLabel(addDays(weekStart, 4))}</Text>
        <Button size="xs" variant="outline" isDisabled={weekStart >= maxMonday} onClick={() => setWeekStart(addDays(weekStart, 7))}>Next week</Button>
      </Flex>
      <Text fontSize="xs" color={muted} mb={2}>{hint}</Text>

      <Box overflowX="auto">
        <Box display="grid" gridTemplateColumns="44px repeat(5, minmax(56px, 1fr))" minW="360px" borderWidth="1px" borderColor={border} borderRadius="md" overflow="hidden" bg={surface}>
          <Box />
          {dates.map((d, i) => {
            const inDays = dayRange && d >= dayRange.lo && d <= dayRange.hi;
            const isAnchorDay = anchor?.date === d && mode === 'ON_LEAVE';
            return (
              <Box key={d} textAlign="center" py={1} borderLeftWidth="1px" borderColor={border}
                bg={mode === 'ON_LEAVE' && (inDays || isAnchorDay) ? pickBg : undefined}>
                <Text fontSize="xs" fontWeight="700" color={text}>{DAY_NAMES[i]}</Text>
                <Text fontSize="10px" color={muted}>{dayLabel(d)}</Text>
              </Box>
            );
          })}

          {Array.from({ length: ROWS }, (_, r) => (
            <Box key={r} display="contents">
              <Text h={`${ROW_PX}px`} fontSize="10px" color={muted} textAlign="right" pr={1} lineHeight={`${ROW_PX}px`}>
                {(FIRST_MIN + r * SLOT) % 60 === 0 ? hourLabel(FIRST_MIN + r * SLOT) : ''}
              </Text>
              {dates.map((d, i) => {
                const dow = i + 1;
                const past = isPast(d, r);
                const isClass = covers(classes, dow, r);
                const isConsult = covers(consult, dow, r);
                const meetingPicked = mode === 'IN_MEETING' && range && range.date === d && r >= range.lo && r <= range.hi;
                const meetingAnchor = mode === 'IN_MEETING' && anchor && anchor.date === d && anchor.row === r;
                const leavePicked = mode === 'ON_LEAVE' && ((dayRange && d >= dayRange.lo && d <= dayRange.hi) || anchor?.date === d);
                const bg = meetingPicked || meetingAnchor || leavePicked ? pickBg : isClass ? classBg : isConsult ? consultBg : undefined;
                return (
                  <Box
                    key={d}
                    as="button"
                    {...({ type: 'button', disabled: past } as any)}
                    aria-label={`${DAY_NAMES[i]} ${dayLabel(d)} ${hourLabel(FIRST_MIN + r * SLOT)}`}
                    onClick={() => tap(d, r)}
                    h={`${ROW_PX}px`}
                    bg={bg}
                    borderLeftWidth="1px" borderTopWidth={(FIRST_MIN + r * SLOT) % 60 === 0 ? '1px' : 0} borderColor={border}
                    outline={meetingAnchor ? `2px solid ${pickEdge}` : undefined} outlineOffset="-2px"
                    opacity={past ? 0.35 : 1} cursor={past ? 'not-allowed' : 'pointer'}
                    _hover={past ? undefined : { filter: 'brightness(0.94)' }}
                  />
                );
              })}
            </Box>
          ))}
        </Box>
      </Box>

      <HStack spacing={4} mt={2} fontSize="xs" color={muted} flexWrap="wrap">
        <HStack spacing={1}><Box w="10px" h="10px" bg={classBg} borderRadius="sm" /><Text>Class</Text></HStack>
        <HStack spacing={1}><Box w="10px" h="10px" bg={consultBg} borderRadius="sm" /><Text>Consultation Hours</Text></HStack>
        <HStack spacing={1}><Box w="10px" h="10px" bg={pickBg} borderRadius="sm" /><Text>Your choice</Text></HStack>
      </HStack>
    </Box>
  );
}
