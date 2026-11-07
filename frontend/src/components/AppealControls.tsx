import { useState } from 'react';
import {
  Badge, Button, Text, VStack, useToast, useColorModeValue,
  Modal, ModalOverlay, ModalContent, ModalHeader, ModalCloseButton, ModalBody, ModalFooter,
} from '@chakra-ui/react';
import { authFetch } from './authFetch';
import CancelReasonPicker, { STUDENT_APPEAL_REASONS, FACULTY_APPEAL_REASONS } from './CancelReasonPicker';

// Which statuses each side may appeal (must match the backend).
const APPEALABLE: Record<string, string[]> = {
  STUDENT: ['MISSED (STUDENT)', 'CANCELLED BY STUDENT'],
  FACULTY: ['MISSED (FACULTY)', 'CANCELLED BY FACULTY'],
};

interface Props {
  apt: any;
  role: 'STUDENT' | 'FACULTY' | 'DEAN';
  onChanged: () => void;
}

/**
 * "Add reason" button / status for one appointment row.
 *  - STUDENT and FACULTY can add a reason for their own missed or cancelled consultations (reason dropdown + "Other Reason").
 *  - A reason is a record only. Nobody accepts or rejects it. (The code and the API still call it an "appeal".)
 */
export default function AppealControls({ apt, role, onChanged }: Props) {
  const toast = useToast();
  const mutedText = useColorModeValue('#6b7fa0', '#7a93b0');
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const base = `${import.meta.env.VITE_API_URL}/api/faculty/appointment/${apt._id}/appeal`;
  const appeal = apt.appeal && apt.appeal.status ? apt.appeal : null;
  const canAppeal = !appeal && role !== 'DEAN' && APPEALABLE[role].includes(apt.status);

  const send = async (url: string, method: string, body: object, okTitle: string) => {
    setBusy(true);
    try {
      const res = await authFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Something went wrong.');
      toast({ title: okTitle, status: 'success', position: 'top' });
      setOpen(false);
      onChanged();
    } catch (e: any) {
      toast({ title: 'Could not complete that', description: e.message, status: 'error', position: 'top' });
    }
    setBusy(false);
  };

  if (!appeal && !canAppeal) return null;

  return (
    <VStack align="start" spacing={1} mt={1}>
      {appeal && (
        <>
          <Badge colorScheme="blue" textTransform="none">
            {appeal.by === 'FACULTY' && role !== 'FACULTY' ? 'Faculty reason' : appeal.by === 'STUDENT' && role !== 'STUDENT' ? 'Student reason' : 'Your reason'}: submitted
          </Badge>
          <Text fontSize="xs" color={mutedText}>Reason: {appeal.reason}</Text>
        </>
      )}
      {canAppeal && (
        <Button size="xs" variant="outline" colorScheme="blue" onClick={() => { setReason(''); setOpen(true); }}>Add reason</Button>
      )}

      <Modal isOpen={open} onClose={() => !busy && setOpen(false)} isCentered>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Add your reason</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Text fontSize="sm" mb={3}>
              {role === 'STUDENT'
                ? 'Tell the professor why you missed or cancelled. It is a record of your reason; no approval is needed.'
                : 'Tell the Dean why you missed or cancelled. It is a record of your reason; no approval is needed.'}
            </Text>
            <CancelReasonPicker key={apt._id} options={role === 'STUDENT' ? STUDENT_APPEAL_REASONS : FACULTY_APPEAL_REASONS} onChange={setReason} />
          </ModalBody>
          <ModalFooter gap={2}>
            <Button variant="ghost" onClick={() => setOpen(false)} isDisabled={busy}>Close</Button>
            <Button colorScheme="blue" isLoading={busy} isDisabled={!reason.trim()} onClick={() => send(base, 'POST', { reason }, 'Reason submitted')}>Submit reason</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </VStack>
  );
}
