import { useCallback, useEffect, useState } from 'react';
import { Badge, Box, Button, Divider, Flex, Heading, HStack, Spinner, Text, VStack, useColorModeValue } from '@chakra-ui/react';
import { authFetch } from './authFetch';
import { useLocation, useNavigate } from 'react-router-dom';

interface HistoryEvent {
  _id: string;
  eventType: string;
  actorRole: string;
  occurredAt: string;
  details: Record<string, unknown>;
}

interface AppointmentHistory {
  _id: string;
  historyRole: 'STUDENT' | 'FACULTY';
  facultyId?: { name?: string } | string;
  studentName?: string;
  date: string;
  time: string;
  status: string;
  reason?: string;
  casePresented?: string;
  interventionTaken?: string;
  remarks?: string;
}

interface PersonalHistory {
  activatedAt: string | null;
  events: HistoryEvent[];
  appointments: AppointmentHistory[];
  statuses: Array<{ _id: string; timestamp: string; status: string; note?: string }>;
  schedule: {
    classes: Array<{ _id: string; dayOfWeek: number; startTime: string; endTime: string; subject: string; room: string }>;
    consultationHours: Array<{ _id: string; dayOfWeek: number; startTime: string; endTime: string }>;
    addedHours: Array<{ _id: string; dayOfWeek: number; startTime: string; endTime: string }>;
    imports: Array<{
      _id: string; status: string; effectivityDate: string; term: string; academicYear: string; createdAt: string;
      classes: Array<{ dayOfWeek: number; startTime: string; endTime: string; subject: string; room: string }>;
      consultationHours: Array<{ dayOfWeek: number; startTime: string; endTime: string }>;
    }>;
  };
}

const API = import.meta.env.VITE_API_URL;
const dateText = (value?: string | null) => value ? new Date(value).toLocaleString() : 'Not available';
const asText = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? value as Record<string, unknown> : {};

function eventSummary(event: HistoryEvent) {
  const details = event.details || {};
  if (event.eventType === 'ROLE_CHANGED') {
    const old = asRecord(details.previousRoleDetails);
    const priorDetails = [asText(old.programPosition), asText(old.program),
      old.schoolId && `School ID ${asText(old.schoolId)}`,
      old.facultyId && `Faculty ID ${asText(old.facultyId)}`, asText(old.employmentType)].filter(Boolean).join(' · ');
    return `Role changed from ${asText(details.fromRole)} to ${asText(details.toRole)}${priorDetails ? `. Previous details: ${priorDetails}` : '.'}`;
  }
  if (event.eventType === 'PROFILE_UPDATED') {
    const fields = Array.isArray(details.fields) ? details.fields.map(asText).filter(Boolean).join(', ') : '';
    return `Profile fields updated: ${fields}.`;
  }
  if (event.eventType.startsWith('CLASS_SCHEDULE_')) {
    const block = asRecord(details.after || details);
    return `${event.eventType.replace(/_/g, ' ').toLowerCase()}: ${asText(block.subject)} ${asText(block.startTime)}-${asText(block.endTime)}`.trim();
  }
  if (event.eventType.includes('CONSULTATION_HOURS')) return `${event.eventType.replace(/_/g, ' ').toLowerCase()}.`;
  if (event.eventType.startsWith('SCHEDULE_IMPORT_')) return `${event.eventType.replace(/_/g, ' ').toLowerCase()}${details.effectivityDate ? ` for ${asText(details.effectivityDate)}` : ''}.`;
  if (event.eventType.startsWith('ACCOUNT_')) return `${event.eventType.replace(/_/g, ' ').toLowerCase()}.`;
  if (event.eventType.startsWith('APPOINTMENT_') || event.eventType.startsWith('CONSULTATION_')) {
    return `${event.eventType.replace(/_/g, ' ').toLowerCase()}${details.fromStatus ? `: ${asText(details.fromStatus)} -> ${asText(details.toStatus)}` : ''}.`;
  }
  return event.eventType.replace(/_/g, ' ').toLowerCase();
}

export default function PersonalHistoryPanel() {
  const [history, setHistory] = useState<PersonalHistory | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const border = useColorModeValue('gray.200', 'whiteAlpha.300');
  const muted = useColorModeValue('gray.600', 'gray.300');
  const navigate = useNavigate();
  const location = useLocation();
  const canOpenHistory = ['STUDENT', 'FACULTY', 'DEAN'].includes(localStorage.getItem('userRole') || '');

  const fetchHistory = useCallback(() => {
    authFetch(`${API}/api/history/me`)
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error();
        return data as PersonalHistory;
      })
      .then(data => { setHistory(data); setError(''); })
      .catch(() => setError('Could not load your history. Please try again.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const retry = () => {
    setError('');
    setLoading(true);
    fetchHistory();
  };

  const download = async () => {
    setExporting(true);
    try {
      const response = await authFetch(`${API}/api/history/me/export.csv`);
      if (!response.ok) {
        throw new Error();
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = 'my-history.csv';
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('Could not export your history. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <Box mt={8} pt={7} borderTopWidth="1px" borderColor={border}>
      <Flex
        direction={{ base: 'column', sm: 'row' }}
        alignItems="flex-start"
        justifyContent="space-between"
        gap={3}
        mb={4}
      >
        <Box>
          <Heading size="sm">My history</Heading>
          <Text fontSize="sm" color={muted} mt={1}>Your appointments, role changes, account events, and schedule history.</Text>
        </Box>
        <HStack spacing={2} flexShrink={0}>
          {canOpenHistory && <Button size="sm" variant="outline" whiteSpace="nowrap" onClick={() => navigate({ pathname: location.pathname, search: '?page=history' })}>Open History</Button>}
          <Button size="sm" variant="outline" whiteSpace="nowrap" onClick={download} isLoading={exporting} isDisabled={!history}>Export CSV</Button>
        </HStack>
      </Flex>

      {loading && <Spinner size="sm" />}
      {error && <Text color="red.500" fontSize="sm" mb={3}>{error}</Text>}
      {!loading && error && <Button size="xs" variant="link" onClick={retry}>Try again</Button>}
      {history && (
        <VStack align="stretch" spacing={5}>
          <Box>
            <Text fontWeight="semibold">Account activated</Text>
            <Text fontSize="sm" color={muted}>{dateText(history.activatedAt)}</Text>
          </Box>

          <Box>
            <Text fontWeight="semibold" mb={2}>Consultations and requests ({history.appointments.length})</Text>
            {history.appointments.length === 0 ? <Text fontSize="sm" color={muted}>No consultation records yet.</Text> : (
              <VStack align="stretch" spacing={2}>
                {history.appointments.map(appointment => {
                  const person = appointment.historyRole === 'STUDENT'
                    ? (typeof appointment.facultyId === 'object' ? appointment.facultyId?.name : appointment.facultyId)
                    : appointment.studentName;
                  return (
                    <Box key={appointment._id} p={3} borderWidth="1px" borderColor={border} borderRadius="md">
                      <HStack justify="space-between" align="start">
                        <Text fontWeight="medium">{appointment.historyRole === 'STUDENT' ? 'Student request' : 'Faculty consultation'} · {person || 'Consultation'}</Text>
                        <Badge>{appointment.status}</Badge>
                      </HStack>
                      <Text fontSize="sm" color={muted}>{appointment.date} at {appointment.time}</Text>
                      {appointment.reason && <Text fontSize="sm" mt={1}>Purpose: {appointment.reason}</Text>}
                      {appointment.casePresented && <Text fontSize="sm" mt={1}>Case: {appointment.casePresented}</Text>}
                      {appointment.interventionTaken && <Text fontSize="sm">Intervention: {appointment.interventionTaken}</Text>}
                      {appointment.remarks && <Text fontSize="sm">Remarks: {appointment.remarks}</Text>}
                    </Box>
                  );
                })}
              </VStack>
            )}
          </Box>

          <Box>
            <Text fontWeight="semibold" mb={2}>Account and schedule events ({history.events.length})</Text>
            {history.events.length === 0 ? <Text fontSize="sm" color={muted}>No events recorded yet.</Text> : (
              <VStack align="stretch" spacing={2}>
                {history.events.map(event => (
                  <Box key={event._id} p={3} borderWidth="1px" borderColor={border} borderRadius="md">
                    <Text fontWeight="medium">{eventSummary(event)}</Text>
                    <Text fontSize="sm" color={muted}>{dateText(event.occurredAt)} · {event.actorRole}</Text>
                  </Box>
                ))}
              </VStack>
            )}
          </Box>

          <Box>
            <Text fontWeight="semibold" mb={2}>Current and imported schedules</Text>
            {history.schedule.classes.map(block => (
              <Text key={block._id} fontSize="sm">{block.subject} · Day {block.dayOfWeek} · {block.startTime}-{block.endTime} · {block.room}</Text>
            ))}
            {history.schedule.consultationHours.map(block => (
              <Text key={block._id} fontSize="sm" color={muted}>Consultation · Day {block.dayOfWeek} · {block.startTime}-{block.endTime}</Text>
            ))}
            {history.schedule.addedHours.map(block => (
              <Text key={block._id} fontSize="sm" color={muted}>Added consultation · Day {block.dayOfWeek} · {block.startTime}-{block.endTime}</Text>
            ))}
            {history.schedule.imports.map(entry => (
              <Box key={entry._id} mb={2}>
                <Text fontSize="sm" color={muted}>
                  Import {entry.status} · effective {entry.effectivityDate} · {entry.term} {entry.academicYear} · {dateText(entry.createdAt)}
                </Text>
                {entry.classes.map((block, index) => (
                  <Text key={`${entry._id}-class-${index}`} fontSize="xs" color={muted}>
                    Class: {block.subject} · Day {block.dayOfWeek} · {block.startTime}-{block.endTime} · {block.room}
                  </Text>
                ))}
                {entry.consultationHours.map((block, index) => (
                  <Text key={`${entry._id}-hours-${index}`} fontSize="xs" color={muted}>
                    Consultation: Day {block.dayOfWeek} · {block.startTime}-{block.endTime}
                  </Text>
                ))}
              </Box>
            ))}
            {!history.schedule.classes.length && !history.schedule.consultationHours.length
              && !history.schedule.addedHours.length && !history.schedule.imports.length
              && <Text fontSize="sm" color={muted}>No schedule records.</Text>}
          </Box>

          {!!history.statuses.length && (
            <Box>
              <Divider mb={4} />
              <Text fontWeight="semibold" mb={2}>Availability status history</Text>
              {history.statuses.map(status => (
                <Text key={status._id} fontSize="sm" color={muted}>{status.status} · {dateText(status.timestamp)}{status.note ? ` · ${status.note}` : ''}</Text>
              ))}
            </Box>
          )}
        </VStack>
      )}
    </Box>
  );
}
