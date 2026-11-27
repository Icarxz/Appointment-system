import { useState } from 'react';
import {
  Modal, ModalOverlay, ModalContent, ModalHeader, ModalCloseButton, ModalBody, ModalFooter,
  Button, Text, useToast,
} from '@chakra-ui/react';
import CancelReasonPicker, { STUDENT_APPEAL_REASONS, FACULTY_APPEAL_REASONS } from './CancelReasonPicker';
import { authFetch } from './authFetch';
import { friendlyError, responseError } from '../utils/friendlyError';

interface Props {
  apt: any | null;                 // the missed / cancelled appointment being appealed
  role: 'STUDENT' | 'FACULTY';
  describe: string;                // e.g. "Prof. X · Oct 27, 9:00 AM"
  onClose: () => void;
  onDone: () => void;
}

// Add a reason for a missed or cancelled consultation: pick a reason (or type your own) and submit.
export default function AppealDialog({ apt, role, describe, onClose, onDone }: Props) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!apt) return;
    setBusy(true);
    try {
      const res = await authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/appointment/${apt._id}/appeal`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }),
      });
      const data = await res.json();
      if (!res.ok) throw responseError(res, data.error || 'Could not submit your reason. Please try again.');
      toast({ title: 'Reason submitted', description: role === 'STUDENT' ? 'Your professor can see it.' : 'The Dean can see it.', status: 'success' });
      onDone();
    } catch (e: any) {
      toast({ title: 'Could not submit reason', description: friendlyError(e, 'Could not submit your reason. Please try again.'), status: 'error', position: 'top' });
    }
    setBusy(false);
  };

  return (
    <Modal isOpen={!!apt} onClose={() => !busy && onClose()} isCentered>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>Add your reason</ModalHeader>
        <ModalCloseButton isDisabled={busy} />
        <ModalBody>
          <Text fontSize="sm" mb={4}>{describe}</Text>
          {apt && (
            <CancelReasonPicker
              key={apt._id}
              options={role === 'STUDENT' ? STUDENT_APPEAL_REASONS : FACULTY_APPEAL_REASONS}
              onChange={setReason}
            />
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" mr={3} onClick={onClose} isDisabled={busy}>Close</Button>
          <Button colorScheme="blue" onClick={submit} isLoading={busy} isDisabled={!reason.trim()}>Submit reason</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
