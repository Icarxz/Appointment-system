import { useEffect, useState } from 'react';
import {
  Badge, Box, Drawer, DrawerBody, DrawerCloseButton, DrawerContent, DrawerHeader, DrawerOverlay,
  Spinner, Text, VStack, useColorModeValue,
} from '@chakra-ui/react';
import type { ReactNode } from 'react';
import { authFetch } from './authFetch';
import { formatDate, formatDateTime } from './dateUtils';
import { statusColor, statusLabel, REASON_TIME_TAKEN } from './appointmentStatus';

const API = import.meta.env.VITE_API_URL;

const fmtTime = (t?: string) => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  const muted = useColorModeValue('#64748b', '#8fa6c4');
  return (
    <Box>
      <Text fontSize="xs" fontWeight="700" color={muted} textTransform="uppercase" mb="2px">{label}</Text>
      <Box fontSize="sm">{children}</Box>
    </Box>
  );
}

interface Props {
  aptId: string | null; // the ?apt= value from a notification link; null keeps the drawer closed
  onClose: () => void;
}

// Read-only details of ONE appointment, opened from a mailbox notification (or an emailed link).
// The server decides who may see it: students their own, faculty theirs, Dean and Admin all.
export default function AppointmentDetailsDrawer({ aptId, onClose }: Props) {
  const muted = useColorModeValue('#64748b', '#8fa6c4');
  const [result, setResult] = useState<{ id: string; apt: any; error: string } | null>(null);

  useEffect(() => {
    if (!aptId) return;
    const id: string = aptId; // a const keeps the "not null" type inside the callbacks below
    let cancelled = false;
    authFetch(`${API}/api/faculty/appointment/${id}`)
      .then(async (res) => {
        if (res.ok) return { id, apt: await res.json(), error: '' };
        return {
          id, apt: null,
          error: res.status === 404
            ? 'This appointment is not available to your account. It may have been removed, or the link belongs to a different account.'
            : 'Could not load this appointment. Please try again.',
        };
      })
      .catch(() => ({ id, apt: null, error: 'Could not reach the server. Check your connection and try again.' }))
      .then((r) => { if (!cancelled) setResult(r); });
    return () => { cancelled = true; };
  }, [aptId]);

  // Only trust a result that belongs to the appointment currently asked for
  const loaded = result && result.id === aptId ? result : null;
  const apt = loaded?.apt;
  const taken = !!apt && apt.cancelReason === REASON_TIME_TAKEN;
  const expired = !!apt && apt.status === 'REJECTED' && apt.autoRejected && !taken;

  return (
    <Drawer isOpen={!!aptId} placement="right" size="md" onClose={onClose}>
      <DrawerOverlay />
      <DrawerContent>
        <DrawerCloseButton />
        <DrawerHeader fontSize="md">Appointment details</DrawerHeader>
        <DrawerBody pb={8}>
          {!loaded && <Box textAlign="center" py={10}><Spinner /></Box>}
          {loaded && loaded.error && <Text fontSize="sm" color={muted}>{loaded.error}</Text>}
          {apt && (
            <VStack align="stretch" spacing={4}>
              <Field label="Status">
                <Badge colorScheme={statusColor(apt.status)} px={2} py={1} borderRadius="md">
                  {expired ? 'Expired (not answered in time)' : taken ? 'Declined (time went to another student)' : statusLabel(apt.status)}
                </Badge>
                {apt.cancelReason && <Text fontSize="xs" color={muted} mt={1}>Reason: {apt.cancelReason}</Text>}
              </Field>
              <Field label="Faculty"><Text>{apt.facultyId?.name || 'Unknown'}</Text></Field>
              <Field label="Student"><Text>{apt.studentName}{apt.studentSection ? ` (${apt.studentSection})` : ''}</Text></Field>
              <Field label="When">
                <Text>{formatDate(apt.date)} at {fmtTime(apt.time)}</Text>
                {apt.requestedTime && apt.requestedTime !== apt.time && <Text fontSize="xs" color={muted}>Requested for {fmtTime(apt.requestedTime)}; the professor approved this time instead.</Text>}
                <Text fontSize="xs" color={muted}>{apt.duration || 60} minutes (Philippine time)</Text>
              </Field>
              <Field label="Purpose"><Text whiteSpace="pre-wrap">{apt.reason}</Text></Field>

              {apt.appeal?.reason && (
                <Field label={`Reason given by ${apt.appeal.by === 'FACULTY' ? 'faculty' : 'student'}`}>
                  <Text whiteSpace="pre-wrap">{apt.appeal.reason}</Text>
                  {apt.appeal.submittedAt && <Text fontSize="xs" color={muted}>Submitted {formatDateTime(apt.appeal.submittedAt)}</Text>}
                </Field>
              )}

              {apt.status === 'COMPLETED' && (
                <>
                  <Field label="Case presented"><Text whiteSpace="pre-wrap">{apt.casePresented || '—'}</Text></Field>
                  <Field label="Intervention / action taken"><Text whiteSpace="pre-wrap">{apt.interventionTaken || '—'}</Text></Field>
                  <Field label="Signed off"><Text>{formatDateTime(apt.completedAt)}</Text></Field>
                </>
              )}

              <Text fontSize="xs" color={muted}>This is a read-only summary. Approve, cancel or sign off from the page behind this panel.</Text>
            </VStack>
          )}
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
