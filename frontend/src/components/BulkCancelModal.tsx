import { useMemo, useState } from 'react';
import {
  Button, Checkbox, Flex, HStack, Modal, ModalBody, ModalCloseButton, ModalContent, ModalFooter, ModalHeader,
  ModalOverlay, Text, VStack, useColorModeValue, useToast,
} from '@chakra-ui/react';
import { authFetch } from './authFetch';
import CancelReasonPicker, { STUDENT_CANCEL_REASONS, FACULTY_CANCEL_REASONS } from './CancelReasonPicker';
import { formatDate } from './dateUtils';
import { hasStarted, isBeforeCutoff, CANCEL_CUTOFF_HOURS } from './appointmentStatus';
import { friendlyError, responseError } from '../utils/friendlyError';

const fmtTime = (t: string) => {
  const [h, m] = (t || '00:00').split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

interface Props {
  isOpen: boolean;
  onClose: () => void;
  role: 'STUDENT' | 'FACULTY';
  appointments: any[];           // the person's own appointments (any status; this component picks the open ones)
  onDone: () => void;
}

// Pick several upcoming appointments with checkboxes and cancel them with one reason.
// Rows inside the last hour stay visible but cannot be ticked. The server checks every rule again.
export default function BulkCancelModal({ isOpen, onClose, role, appointments, onDone }: Props) {
  const toast = useToast();
  const muted = useColorModeValue('#6b7fa0', '#7a93b0');
  const text = useColorModeValue('#0f2240', '#e8f0fe');
  const border = useColorModeValue('#dde3ec', '#1e3048');
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  // Open items that have not started yet, soonest first.
  const rows = useMemo(() => appointments
    .filter(a => ['PENDING', 'APPROVED'].includes(a.status) && !hasStarted(a.date, a.time))
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)), [appointments]);

  // Students and faculty cancel approved ones only until 1 hour before. A faculty member may still
  // decline a pending request until it starts.
  const canTick = (a: any) => (role === 'FACULTY' && a.status === 'PENDING') || isBeforeCutoff(a.date, a.time);
  const tickable = rows.filter(canTick);
  const chosen = tickable.filter(a => picked[a._id]);
  const allOn = tickable.length > 0 && chosen.length === tickable.length;
  const who = (a: any) => role === 'STUDENT' ? (a.facultyId?.name || 'Professor') : `${a.studentName} (${a.studentSection})`;

  const close = () => { if (!busy) { setPicked({}); setReason(''); onClose(); } };

  const submit = async () => {
    setBusy(true);
    try {
      const res = await authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/appointments/bulk-cancel`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: chosen.map(a => a._id), reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw responseError(res, data.error || 'Could not cancel the selected appointments. Please try again.');
      toast({ title: data.message, status: data.skipped?.length ? 'warning' : 'success', position: 'top' });
      setPicked({}); setReason(''); onDone(); onClose();
    } catch (e: any) {
      toast({ title: 'Could not cancel', description: friendlyError(e, 'Could not cancel the selected appointments. Please try again.'), status: 'error', position: 'top' });
    }
    setBusy(false);
  };

  return (
    <Modal isOpen={isOpen} onClose={close} isCentered size="lg" scrollBehavior="inside">
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>Cancel several appointments</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          {rows.length === 0 ? <Text color={muted}>You have no upcoming appointments to cancel.</Text> : (
            <VStack align="stretch" spacing={3}>
              <Checkbox isChecked={allOn} isIndeterminate={chosen.length > 0 && !allOn} isDisabled={tickable.length === 0}
                onChange={(e) => setPicked(e.target.checked ? Object.fromEntries(tickable.map(a => [a._id, true])) : {})}>
                <Text fontSize="sm" fontWeight="600" color={text}>Select all ({tickable.length})</Text>
              </Checkbox>
              <VStack align="stretch" spacing={0} borderWidth="1px" borderColor={border} borderRadius="md">
                {rows.map(a => {
                  const ok = canTick(a);
                  return (
                    <Flex key={a._id} px={3} py={2} gap={3} align="center" borderBottomWidth="1px" borderColor={border} opacity={ok ? 1 : 0.55}>
                      <Checkbox isDisabled={!ok} isChecked={!!picked[a._id]} onChange={(e) => setPicked({ ...picked, [a._id]: e.target.checked })} />
                      <VStack align="start" spacing={0} flex="1">
                        <Text fontSize="sm" fontWeight="600" color={text}>{who(a)}</Text>
                        <Text fontSize="xs" color={muted}>{formatDate(a.date)} at {fmtTime(a.time)} · {a.status === 'PENDING' ? (role === 'FACULTY' ? 'Waiting for your answer (will be declined)' : 'Waiting for Faculty Approval') : 'Approved'}</Text>
                      </VStack>
                      {!ok && <Text fontSize="xs" color={muted}>Within {CANCEL_CUTOFF_HOURS} hour</Text>}
                    </Flex>
                  );
                })}
              </VStack>
              <Text fontSize="sm" fontWeight="600" color={text}>Reason (applies to all selected)</Text>
              <CancelReasonPicker options={role === 'STUDENT' ? STUDENT_CANCEL_REASONS : FACULTY_CANCEL_REASONS} onChange={setReason} />
            </VStack>
          )}
        </ModalBody>
        <ModalFooter>
          <HStack spacing={2}>
            <Button variant="ghost" onClick={close} isDisabled={busy}>Close</Button>
            <Button colorScheme="red" isLoading={busy} isDisabled={chosen.length === 0 || !reason.trim()} onClick={submit}>
              Cancel {chosen.length || ''} selected
            </Button>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
