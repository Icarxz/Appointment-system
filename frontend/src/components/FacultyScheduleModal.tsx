import { useEffect, useState } from 'react';
import {
  Button, HStack, IconButton, Modal, ModalBody, ModalCloseButton, ModalContent, ModalHeader, ModalOverlay, Text,
  useColorModeValue,
} from '@chakra-ui/react';
import { ChevronLeftIcon, ChevronRightIcon } from '@chakra-ui/icons';
import { authFetch } from './authFetch';
import WeeklyCalendar from './WeeklyCalendar';
import type { Booking } from './WeeklyCalendar';

const API = import.meta.env.VITE_API_URL;
const bookingsUrl = (facultyId: string) => `${API}/api/faculty/schedule-bookings/${facultyId}`;

// "YYYY-MM-DD" for today in Philippine time, and date maths on plain ISO dates (no time zone surprises)
const manilaToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const mondayOf = (iso: string) => { const dow = new Date(`${iso}T00:00:00Z`).getUTCDay(); return addDays(iso, dow === 0 ? -6 : 1 - dow); };
const rangeLabel = (monday: string) => {
  const f = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${f(monday)} – ${f(addDays(monday, 5))}`;
};

interface Props { faculty: { _id: string; name?: string } | null; isOpen: boolean; onClose: () => void }

// One faculty member's schedule: classes, consultation hours, added hours, plus accepted ("Occupied") and
// "Completed" consultations for the week shown. Pending requests are not shown. Used by Student and Admin.
export default function FacultyScheduleModal({ faculty, isOpen, onClose }: Props) {
  const muted = useColorModeValue('#64748b', '#8fa6c4');
  const [data, setData] = useState<{ classes: any[]; official: any[]; added: any[] }>({ classes: [], official: [], added: [] });
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(false);
  const [weekStart, setWeekStart] = useState(() => mondayOf(manilaToday()));
  const id = faculty?._id;

  // Reset to this week and load the weekly pattern each time the modal opens for a professor
  useEffect(() => {
    if (!isOpen || !id) return;
    let cancelled = false;
    setWeekStart(mondayOf(manilaToday()));
    setLoading(true);
    const base = `${API}/api/faculty`;
    const get = (path: string) => authFetch(`${base}/${path}`).then(r => r.json()).then(j => (Array.isArray(j) ? j : []));
    Promise.all([get(`my-schedule/${id}`), get(`consultation-hours/${id}`), get(`added-hours/of/${id}`)])
      .then(([classes, official, added]) => { if (!cancelled) setData({ classes, official, added }); })
      .catch(() => { if (!cancelled) setData({ classes: [], official: [], added: [] }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen, id]);

  // Accepted and completed consultations of the shown week
  useEffect(() => {
    if (!isOpen || !id) return;
    let cancelled = false;
    authFetch(`${bookingsUrl(id)}?from=${weekStart}&to=${addDays(weekStart, 5)}`)
      .then(r => r.json())
      .then(j => { if (!cancelled) setBookings(Array.isArray(j) ? j : []); })
      .catch(() => { if (!cancelled) setBookings([]); });
    return () => { cancelled = true; };
  }, [isOpen, id, weekStart]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="4xl" isCentered scrollBehavior="inside">
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>{faculty?.name}: Schedule</ModalHeader>
        <ModalCloseButton />
        <ModalBody pb={6}>
          {loading ? <Text color={muted}>Loading schedule...</Text> : (
            <>
              <HStack mb={3} spacing={2}>
                <IconButton aria-label="Previous week" icon={<ChevronLeftIcon boxSize={5} />} size="sm" variant="outline" onClick={() => setWeekStart(addDays(weekStart, -7))} />
                <Text fontWeight="600" fontSize="sm" minW="130px" textAlign="center">{rangeLabel(weekStart)}</Text>
                <IconButton aria-label="Next week" icon={<ChevronRightIcon boxSize={5} />} size="sm" variant="outline" onClick={() => setWeekStart(addDays(weekStart, 7))} />
                <Button size="sm" variant="ghost" onClick={() => setWeekStart(mondayOf(manilaToday()))}>This week</Button>
              </HStack>
              <WeeklyCalendar classes={data.classes} official={data.official} added={data.added} weekStart={weekStart} bookings={bookings} />
            </>
          )}
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}

