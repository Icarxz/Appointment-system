import { useEffect, useMemo, useState } from 'react';
import {
  Badge, Box, Button, Flex, Heading, HStack, Input, Select, SimpleGrid, Spinner, Text, VStack,
  useColorModeValue,
} from '@chakra-ui/react';
import { authFetch } from './authFetch';

interface Term {
  academicYear: string;
  name: string;
  startDate: string;
  endDate: string;
}

interface Consultation {
  _id: string;
  date: string;
  time: string;
  duration: number;
  status: string;
  reason: string;
  historyRole: 'STUDENT' | 'FACULTY';
  studentName?: string;
  studentId?: { name?: string } | string;
  facultyId?: { name?: string } | string;
  academicYear: string | null;
  term: string | null;
  casePresented?: string;
  interventionTaken?: string;
  remarks?: string;
  cancelReason?: string;
  missReason?: string;
}

interface HistoryEvent {
  _id: string;
  eventType: string;
  actorRole: string;
  occurredAt: string;
  details: Record<string, unknown>;
}

interface PersonalHistory {
  activatedAt: string | null;
  events: HistoryEvent[];
  schedule: {
    imports: Array<{
      _id: string;
      status: string;
      effectivityDate: string;
      term: string;
      academicYear: string;
      createdAt: string;
    }>;
  };
}

interface ConsultationResponse {
  appointments: Consultation[];
  page: number;
  limit: number;
  total: number;
  pages: number;
  statusCounts: Record<string, number>;
  academicYears: string[];
}

const API = import.meta.env.VITE_API_URL;
const FRIENDLY_ERROR = 'Could not load history. Please try again.';
const ROLE_LABELS: Record<string, string> = { STUDENT: 'Student', FACULTY: 'Faculty', DEAN: 'Dean', ADMIN: 'Admin' };
const DEFAULT_SEMESTERS = ['First Semester', 'Second Semester'];
const ACCOUNT_EVENTS = new Set([
  'ACCOUNT_ACTIVATED', 'ACCOUNT_PROVISIONED', 'ACCOUNT_ONBOARDED', 'ACCOUNT_DETAILS_CONFIRMED',
  'ACCOUNT_DISABLED', 'ACCOUNT_ENABLED', 'ROLE_CHANGED', 'POSITION_CHANGED', 'PROFILE_UPDATED', 'SIGN_IN_BLOCKED',
]);

const displayDate = (date: string) => date || 'Date unavailable';
const displayTimestamp = (value?: string | null) => value
  ? new Date(value).toLocaleString(undefined, { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })
  : 'Date unavailable';
const formatTime = (value: string) => {
  const [hour, minute] = value.split(':').map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return value;
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
};
const endTime = (start: string, duration: number) => {
  const [hour, minute] = start.split(':').map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return '';
  const total = hour * 60 + minute + (Number(duration) || 0);
  const end = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}${total >= 1440 ? ' (+1 day)' : ''}`;
};
const appointmentPerson = (appointment: Consultation) => appointment.historyRole === 'STUDENT'
  ? (typeof appointment.facultyId === 'object' ? appointment.facultyId?.name : appointment.facultyId)
  : (typeof appointment.studentId === 'object' ? appointment.studentId?.name : appointment.studentName);

function eventText(event: HistoryEvent) {
  const details = event.details || {};
  const text = (value: unknown) => typeof value === 'string' ? value : '';
  switch (event.eventType) {
    case 'ACCOUNT_ACTIVATED': return 'Account activated or approved.';
    case 'ACCOUNT_PROVISIONED': return 'Account provisioned.';
    case 'ACCOUNT_ONBOARDED': return 'Account onboarding completed.';
    case 'ACCOUNT_DETAILS_CONFIRMED': return 'Account details confirmed.';
    case 'ACCOUNT_DISABLED': return 'Account disabled.';
    case 'ACCOUNT_ENABLED': return 'Account enabled.';
    case 'SIGN_IN_BLOCKED': return 'Sign-in blocked for this account.';
    case 'ROLE_CHANGED': return `Role changed from ${ROLE_LABELS[text(details.fromRole)] || text(details.fromRole)} to ${ROLE_LABELS[text(details.toRole)] || text(details.toRole)}.`;
    case 'POSITION_CHANGED': return `Position changed from ${text(details.fromPosition) || 'unspecified'} to ${text(details.toPosition) || 'unspecified'}.`;
    case 'CLASS_SCHEDULE_ADDED': return 'Class added to the schedule.';
    case 'CLASS_SCHEDULE_UPDATED': return 'Class schedule updated.';
    case 'CLASS_SCHEDULE_REMOVED': return 'Class removed from the schedule.';
    case 'CONSULTATION_HOURS_REPLACED': return 'Consultation hours updated.';
    case 'ADDED_CONSULTATION_HOURS': return 'Additional consultation hours added.';
    case 'ADDED_CONSULTATION_HOURS_REMOVED': return 'Additional consultation hours removed.';
    case 'NOTICE_POSTED': return 'A notice was posted.';
    case 'NOTICE_CANCELLED': return 'A notice was cancelled.';
    default: return event.eventType.replace(/_/g, ' ').toLowerCase();
  }
}

function HistoryCard({ children }: { children: React.ReactNode }) {
  const bg = useColorModeValue('white', 'gray.800');
  const border = useColorModeValue('gray.200', 'whiteAlpha.300');
  return <Box borderWidth="1px" borderColor={border} borderRadius="lg" p={{ base: 3, md: 4 }} bg={bg}>{children}</Box>;
}

export default function HistoryPage({ showScheduleAccount = false }: { showScheduleAccount?: boolean }) {
  const [terms, setTerms] = useState<Term[]>([]);
  const [consultations, setConsultations] = useState<ConsultationResponse | null>(null);
  const [personalHistory, setPersonalHistory] = useState<PersonalHistory | null>(null);
  const [academicYear, setAcademicYear] = useState('');
  const [term, setTerm] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'consultations' | 'schedule'>('consultations');
  const muted = useColorModeValue('gray.600', 'gray.300');

  useEffect(() => {
    let active = true;
    authFetch(`${API}/api/terms`)
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return response.json() as Promise<Term[]>;
      })
      .then((data) => { if (active) setTerms(data); })
      .catch(() => { if (active) setError(FRIENDLY_ERROR); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ page: String(page), limit: '20' });
    if (academicYear) params.set('academicYear', academicYear);
    if (term) params.set('term', term);
    if (status) params.set('status', status);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    authFetch(`${API}/api/history/consultations?${params}`)
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return response.json() as Promise<ConsultationResponse>;
      })
      .then((consultationData) => {
        if (!active) return;
        setConsultations(consultationData);
      })
      .catch(() => { if (active) setError(FRIENDLY_ERROR); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [academicYear, term, status, from, to, page]);

  useEffect(() => {
    if (!showScheduleAccount) return;
    let active = true;
    authFetch(`${API}/api/history/me`)
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return response.json() as Promise<PersonalHistory>;
      })
      .then((data) => { if (active) setPersonalHistory(data); })
      .catch(() => { if (active) setError(FRIENDLY_ERROR); });
    return () => { active = false; };
  }, [showScheduleAccount]);

  const academicYears = useMemo(() => [...new Set([
    ...terms.map((item) => item.academicYear),
    ...(consultations?.academicYears || []),
  ])].sort().reverse(), [terms, consultations?.academicYears]);
  const semesterOptions = useMemo(() => [...new Set([
    ...DEFAULT_SEMESTERS,
    ...terms.map((item) => item.name),
  ])].sort((a, b) => {
    const ai = DEFAULT_SEMESTERS.indexOf(a), bi = DEFAULT_SEMESTERS.indexOf(b);
    return ai >= 0 || bi >= 0 ? (ai < 0 ? 1 : bi < 0 ? -1 : ai - bi) : a.localeCompare(b);
  }), [terms]);
  const statusCounts = consultations?.statusCounts || {};
  const currentRole = localStorage.getItem('userRole') || '';
  const statusOptions = [...new Set([...Object.keys(statusCounts), 'PENDING', 'APPROVED', 'REJECTED', 'COMPLETED', 'MISSED (STUDENT)', 'MISSED (FACULTY)', 'CANCELLED BY STUDENT', 'CANCELLED BY FACULTY'])].sort();
  const scheduleEvents = (personalHistory?.events || []).filter((event) =>
    event.eventType.startsWith('CLASS_SCHEDULE_')
    || event.eventType.includes('CONSULTATION_HOURS')
    || event.eventType.startsWith('ADDED_CONSULTATION_HOURS')
    || event.eventType.startsWith('NOTICE_'),
  );
  const accountEvents = (personalHistory?.events || []).filter((event) => ACCOUNT_EVENTS.has(event.eventType));
  const roleChanges = accountEvents.filter((event) => event.eventType === 'ROLE_CHANGED')
    .sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
  const roleTimeline = useMemo(() => {
    const initialRole = roleChanges.length
      ? String(roleChanges[0].details.fromRole || currentRole)
      : currentRole;
    const timeline = [{
      role: ROLE_LABELS[initialRole] || initialRole,
      since: personalHistory?.activatedAt || (roleChanges[0] && roleChanges[0].occurredAt) || null,
    }];
    roleChanges.forEach((event) => {
      const nextRole = String(event.details.toRole || '');
      if (nextRole) timeline.push({ role: ROLE_LABELS[nextRole] || nextRole, since: event.occurredAt });
    });
    return timeline;
  }, [roleChanges, currentRole, personalHistory?.activatedAt]);

  const exportCsv = async () => {
    setExporting(true);
    setError('');
    const params = new URLSearchParams();
    if (academicYear) params.set('academicYear', academicYear);
    if (term) params.set('term', term);
    if (status) params.set('status', status);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    try {
      const response = await authFetch(`${API}/api/history/consultations/export.csv?${params}`);
      if (!response.ok) throw new Error();
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = 'consultation-history.csv';
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('Could not export history. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const changeFilter = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setPage(1);
  };

  return (
    <Box flex="1" minH={0} overflowY="auto" p={{ base: 3, md: 6 }}>
      <Heading size="lg" mb={4}>History</Heading>
      {showScheduleAccount && (
        <HStack mb={4} spacing={2} flexWrap="wrap">
          <Button size="sm" variant={activeTab === 'consultations' ? 'solid' : 'outline'} colorScheme="blue" onClick={() => setActiveTab('consultations')}>Consultations</Button>
          <Button size="sm" variant={activeTab === 'schedule' ? 'solid' : 'outline'} colorScheme="blue" onClick={() => setActiveTab('schedule')}>My schedule and account</Button>
        </HStack>
      )}
      {error && <Text role="alert" color="red.500" mb={3}>{error}</Text>}

      {activeTab === 'consultations' && (
        <VStack align="stretch" spacing={4}>
          <HistoryCard>
            <SimpleGrid columns={{ base: 1, sm: 2, lg: 3 }} spacing={3}>
              <Box><Text fontSize="sm" mb={1}>Academic year</Text>
                <Select aria-label="Academic year" value={academicYear} onChange={(event) => changeFilter(setAcademicYear)(event.target.value)}>
                  <option value="">All academic years</option>
                  {academicYears.map((year) => <option key={year} value={year}>{year}</option>)}
                </Select>
              </Box>
              <Box><Text fontSize="sm" mb={1}>Semester</Text>
                <Select aria-label="Semester" value={term} onChange={(event) => changeFilter(setTerm)(event.target.value)}>
                  <option value="">All semesters</option>
                  {semesterOptions.map((name) => <option key={name} value={name}>{name}</option>)}
                  <option value="NONE">Outside a term</option>
                </Select>
              </Box>
              <Box><Text fontSize="sm" mb={1}>Status</Text>
                <Select aria-label="Status" value={status} onChange={(event) => changeFilter(setStatus)(event.target.value)}>
                  <option value="">All statuses</option>
                  {statusOptions.map((value) => <option key={value} value={value}>{value}</option>)}
                </Select>
              </Box>
              <Box><Text fontSize="sm" mb={1}>From</Text><Input aria-label="From date" type="date" value={from} onChange={(event) => changeFilter(setFrom)(event.target.value)} /></Box>
              <Box><Text fontSize="sm" mb={1}>To</Text><Input aria-label="To date" type="date" value={to} onChange={(event) => changeFilter(setTo)(event.target.value)} /></Box>
            </SimpleGrid>
            <Flex mt={4} justify="space-between" align="center" gap={3} flexWrap="wrap">
              <Text fontSize="sm" color={muted}>{consultations?.total || 0} consultations</Text>
              <Button size="sm" colorScheme="blue" variant="outline" onClick={exportCsv} isLoading={exporting}>Export CSV</Button>
            </Flex>
          </HistoryCard>

          {!!Object.keys(statusCounts).length && (
            <Flex gap={2} flexWrap="wrap" aria-label="Consultation counts by status">
              {Object.entries(statusCounts).sort(([a], [b]) => a.localeCompare(b)).map(([key, count]) => (
                <Badge key={key} px={2} py={1} borderRadius="full">{key}: {count}</Badge>
              ))}
            </Flex>
          )}

          {loading && <Flex justify="center" py={8}><Spinner /></Flex>}
          {!loading && !error && !consultations?.appointments.length && (
            <HistoryCard><Text color={muted}>No consultations match these filters.</Text></HistoryCard>
          )}
          {!loading && consultations?.appointments.map((appointment) => {
            const person = appointmentPerson(appointment);
            const earlierRole = appointment.historyRole !== currentRole && !(currentRole === 'DEAN' && appointment.historyRole === 'FACULTY');
            const notes = [
              appointment.cancelReason && `Cancellation: ${appointment.cancelReason}`,
              appointment.missReason && `Missed: ${appointment.missReason}`,
              appointment.casePresented && `Case: ${appointment.casePresented}`,
              appointment.interventionTaken && `Intervention: ${appointment.interventionTaken}`,
              appointment.remarks && `Notes: ${appointment.remarks}`,
            ].filter(Boolean);
            return (
              <HistoryCard key={appointment._id}>
                <Flex justify="space-between" align="start" gap={2} flexWrap="wrap">
                  <Heading size="sm">{displayDate(appointment.date)}</Heading>
                  <HStack spacing={2} flexWrap="wrap">
                    <Badge>{appointment.status}</Badge>
                    {earlierRole && <Badge colorScheme="purple">as {appointment.historyRole === 'STUDENT' ? 'Student' : 'Faculty'}</Badge>}
                  </HStack>
                </Flex>
                <Text mt={2}>{formatTime(appointment.time)} – {formatTime(endTime(appointment.time, appointment.duration).replace(' (+1 day)', ''))} · {appointment.duration} minutes</Text>
                {endTime(appointment.time, appointment.duration).includes('+1 day') && <Text fontSize="xs" color={muted}>Ends the following day</Text>}
                <Text color={muted} mt={1}>With {person || 'unknown'}</Text>
                {appointment.reason && <Text mt={2}><b>Purpose:</b> {appointment.reason}</Text>}
                {appointment.academicYear && appointment.term && <Text fontSize="sm" color={muted}>{appointment.term} · {appointment.academicYear}</Text>}
                {!!notes.length && <Text fontSize="sm" mt={2} whiteSpace="pre-wrap">{notes.join(' · ')}</Text>}
              </HistoryCard>
            );
          })}
          {!loading && !!consultations && consultations.pages > 1 && (
            <Flex justify="space-between" align="center">
              <Button size="sm" onClick={() => setPage((value) => Math.max(1, value - 1))} isDisabled={page <= 1}>Previous</Button>
              <Text fontSize="sm" color={muted}>Page {page} of {consultations.pages}</Text>
              <Button size="sm" onClick={() => setPage((value) => Math.min(consultations.pages, value + 1))} isDisabled={page >= consultations.pages}>Next</Button>
            </Flex>
          )}
        </VStack>
      )}

      {activeTab === 'schedule' && showScheduleAccount && (
        <VStack align="stretch" spacing={4}>
          <HistoryCard>
            <Heading size="sm" mb={3}>Schedule imports</Heading>
            {!personalHistory?.schedule.imports.length
              ? <Text color={muted}>No schedule imports yet.</Text>
              : personalHistory.schedule.imports.map((item) => (
                <Text key={item._id} fontSize="sm" py={1}>
                  {item.status} · effective {item.effectivityDate} · {item.term || 'Term not specified'} {item.academicYear} · added {displayTimestamp(item.createdAt)}
                </Text>
              ))}
          </HistoryCard>
          <HistoryCard>
            <Heading size="sm" mb={3}>Manual schedule changes</Heading>
            {!scheduleEvents.length
              ? <Text color={muted}>No manual schedule changes recorded.</Text>
              : scheduleEvents.map((event) => (
                <Text key={event._id} fontSize="sm" py={1}>{eventText(event)} · {displayTimestamp(event.occurredAt)}</Text>
              ))}
          </HistoryCard>
          <HistoryCard>
            <Heading size="sm" mb={3}>Account and role history</Heading>
            <Text fontWeight="semibold" mb={2}>Role timeline</Text>
            {roleTimeline.map((item, index) => (
              <Text key={`${item.role}-${index}`} fontSize="sm">{item.role} since {displayTimestamp(item.since)}</Text>
            ))}
            <Text fontWeight="semibold" mt={4} mb={2}>Account events</Text>
            {!accountEvents.length
              ? <Text color={muted}>No account events recorded.</Text>
              : [...accountEvents].sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()).map((event) => (
                <Text key={event._id} fontSize="sm" py={1}>{eventText(event)} · {displayTimestamp(event.occurredAt)}</Text>
              ))}
          </HistoryCard>
        </VStack>
      )}
    </Box>
  );
}
