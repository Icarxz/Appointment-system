import { useEffect, useRef, useState } from 'react';
import { Box, Button, Grid, HStack, Text, useColorModeValue } from '@chakra-ui/react';
import { buildWeekGrid, cellKey } from '../utils/weekGrid';
import type { Busy, Slot } from '../utils/weekGrid';

// The student's weekly booking calendar: Monday to Friday x hour. Click a green or dashed cell to request that
// hour (the parent opens a confirm panel). Class, booked and past hours are shown but cannot be clicked.
// Not the read-only master schedule (WeeklyCalendar.tsx); this one is for booking.

const hourLabel = (h: number) => `${((h + 11) % 12) + 1} ${h >= 12 ? 'PM' : 'AM'}`;
const clock = (t: string) => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}`; };
// Short forms for a phone, where five day columns must share about 320px: "9:00" -> "9", "1 PM" -> "1p".
const clockShort = (t: string) => { const [h, m] = t.split(':').map(Number); return m === 0 ? String(((h + 11) % 12) + 1) : clock(t); };
const hourLabelShort = (h: number) => `${((h + 11) % 12) + 1}${h >= 12 ? 'p' : 'a'}`;
// Below this calendar width the five day columns shrink to fit. Above it they keep room for the full label.
// (Measured on the calendar itself, not the window: the sidebar and the page padding take a different share at every size.)
const COMPACT_BELOW = 560;
const clockAmPm = (t: string) => `${clock(t)} ${Number(t.split(':')[0]) >= 12 ? 'PM' : 'AM'}`;
const dayName = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
const dayDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const dayLong = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });

interface Props {
  slots: Slot[];
  busy: Busy[];
  weekStart: string;     // the Monday of the week shown
  leadHours: number;     // requests close this long before the start
  selectedKey: string;   // "YYYY-MM-DD|HH:MM" of the chosen slot, or ''
  onPick: (slot: Slot) => void;
}

export default function WeeklyBookingCalendar({ slots, busy, weekStart, leadHours, selectedKey, onPick }: Props) {
  const text = useColorModeValue('#0f2240', '#e8f0fe');
  const muted = useColorModeValue('#64748b', '#8fa6c4');
  const consultBg = useColorModeValue('#dcfce7', '#14532d');
  const consultBorder = useColorModeValue('#16a34a', '#4ade80');
  const vacantBg = useColorModeValue('#ffffff', 'transparent');
  const vacantBorder = useColorModeValue('#94a3b8', '#64748b');
  const classBg = useColorModeValue('#cbd5e1', '#334155');
  const redBg = useColorModeValue('#fee2e2', '#7f1d1d');
  const redBorder = useColorModeValue('#ef4444', '#f87171');
  const faintBg = useColorModeValue('#f1f5f9', '#162033');
  const lineColor = useColorModeValue('#e2e8f0', '#1e3048');

  const wrapRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const check = () => setCompact(el.clientWidth < COMPACT_BELOW);
    check();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const range = (a: string, b: string) => (compact ? `${clockShort(a)}–${clockShort(b)}` : `${clock(a)}–${clock(b)}`);

  const grid = buildWeekGrid({ slots, busy, weekStart, nowMs: Date.now(), leadHours });

  const swatch = (bg: string, border: string, dashed = false) => (
    <Box w="14px" h="14px" borderRadius="3px" bg={bg} borderWidth="1px" borderStyle={dashed ? 'dashed' : 'solid'} borderColor={border} flexShrink={0} />
  );

  return (
    <Box ref={wrapRef}>
      <HStack spacing={4} flexWrap="wrap" mb={3} fontSize="xs" color={muted}>
        <HStack spacing={1}>{swatch(consultBg, consultBorder)}<Text>Consultation hours</Text></HStack>
        <HStack spacing={1}>{swatch(vacantBg, vacantBorder, true)}<Text>Vacant hour</Text></HStack>
        <HStack spacing={1}>{swatch(classBg, classBg)}<Text>Class</Text></HStack>
        <HStack spacing={1}>{swatch(redBg, redBorder)}<Text>Booked</Text></HStack>
        <HStack spacing={1}>{swatch(faintBg, lineColor)}<Text>Not available</Text></HStack>
      </HStack>

      {/* Safety net only: below 560px the compact layout fits all five days, and above it the columns have room. */}
      <Box overflowX="auto" pb={1}>
        <Grid
          templateColumns={compact ? `30px repeat(${grid.dates.length}, minmax(0, 1fr))` : `52px repeat(${grid.dates.length}, minmax(80px, 1fr))`}
          gap={compact ? '3px' : '4px'} minW={compact ? undefined : "480px"}>
          <Box />
          {grid.dates.map(d => (
            <Box key={d} textAlign="center" pb={1}>
              <Text fontSize="xs" fontWeight="700" color={text}>{dayName(d)}</Text>
              <Text fontSize="11px" color={muted}>{dayDate(d)}</Text>
            </Box>
          ))}

          {grid.hours.map(h => (
            <Box key={`row-${h}`} display="contents">
              <Text fontSize={compact ? '10px' : '11px'} color={muted} textAlign="right" pr={compact ? 0 : 1} pt="6px">{compact ? hourLabelShort(h) : hourLabel(h)}</Text>
              {grid.dates.map(d => {
                const cell = grid.cells[cellKey(d, h)];
                return (
                  <Box key={cellKey(d, h)} display="flex" flexDirection="column" gap="2px" minH="46px">
                    {cell.parts.map((part, i) => {
                      const slot = part.slot;
                      if (slot && (part.state === 'CONSULT' || part.state === 'VACANT')) {
                        const consult = part.state === 'CONSULT';
                        const selected = `${slot.date}|${slot.start}` === selectedKey;
                        const spots = `${slot.pending} ${slot.pending === 1 ? 'request' : 'requests'} so far`;
                        return (
                          <Button
                            key={slot.start}
                            variant="unstyled"
                            h="auto" minH="44px" w="100%" px={compact ? '2px' : 1} py={1}
                            display="flex" flexDirection="column" alignItems="center" justifyContent="center"
                            fontWeight="600" fontSize={compact ? '10px' : '11px'} lineHeight="1.25" whiteSpace="normal" color={text}
                            bg={consult ? consultBg : vacantBg}
                            borderWidth="1px" borderStyle={consult ? 'solid' : 'dashed'} borderColor={consult ? consultBorder : vacantBorder}
                            boxShadow={selected ? '0 0 0 2px #2563eb' : 'none'}
                            _hover={{ borderColor: '#2563eb' }}
                            onClick={() => onPick(slot)}
                            title={`${clockAmPm(slot.start)} to ${clockAmPm(slot.end)}. ${spots}.${slot.kind === 'ADDED' ? ' Added consultation hours.' : ''}`}
                            aria-label={`${dayLong(slot.date)}, ${clockAmPm(slot.start)} to ${clockAmPm(slot.end)}, ${consult ? 'consultation hours' : 'vacant hour'}, ${spots}`}
                            aria-pressed={selected}
                          >
                            <span>{range(slot.start, slot.end)}</span>
                            {slot.pending > 0 && <Text as="span" fontSize="10px" fontWeight="500" color={muted}>{slot.pending}{compact ? '' : ' requested'}</Text>}
                          </Button>
                        );
                      }
                      if (part.state === 'CLASS') {
                        return <Box key={i} minH="44px" borderRadius="md" bg={classBg} display="flex" alignItems="center" justifyContent="center" fontSize="11px" color={muted} title="The professor is teaching a class">Class</Box>;
                      }
                      if (part.state === 'BOOKED') {
                        return <Box key={i} minH="44px" borderRadius="md" bg={redBg} borderWidth="1px" borderColor={redBorder} display="flex" alignItems="center" justifyContent="center" fontSize="11px" color={text} title="Already booked with another student">Booked</Box>;
                      }
                      const why = part.state === 'PAST' ? 'This time has already started' : part.state === 'SOON' ? `Requests close ${leadHours} hour before the start time` : 'Not available';
                      return <Box key={i} minH="44px" borderRadius="md" bg={faintBg} title={why} />;
                    })}
                  </Box>
                );
              })}
            </Box>
          ))}
        </Grid>
      </Box>
      <Text fontSize="xs" color={muted} mt={3}>Several students can request the same hour; the professor accepts one. Requests close {leadHours} hour before the start time.</Text>
    </Box>
  );
}
