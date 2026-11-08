import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, ModalOverlay, Text, VStack } from '@chakra-ui/react';
import { formatDate, formatTime } from './dateUtils';

// Asks before a consultation is marked Completed or Missed. Nothing is saved until Confirm is pressed.
export type EndKind = 'COMPLETE' | 'MISSED';
export interface EndTarget { kind: EndKind; person: string; personLabel: string; date: string; time: string; run: () => Promise<void> }

interface Props { target: EndTarget | null; busy: boolean; onClose: () => void; onConfirm: () => void }

export default function ConfirmEndModal({ target, busy, onClose, onConfirm }: Props) {
  const complete = target?.kind === 'COMPLETE';
  return (
    <Modal isOpen={!!target} onClose={() => !busy && onClose()} isCentered>
      <ModalOverlay />
      <ModalContent mx={4}>
        <ModalHeader>{complete ? 'Confirm this consultation has already ended?' : 'Mark this consultation as missed?'}</ModalHeader>
        <ModalBody>
          {target && (
            <VStack align="stretch" spacing={1} fontSize="sm">
              <Text><b>{target.personLabel}:</b> {target.person}</Text>
              <Text><b>Date:</b> {formatDate(target.date)}</Text>
              <Text><b>Time:</b> {formatTime(target.time)}</Text>
              <Text mt={2} color="gray.500">
                {complete
                  ? 'It will be recorded as Completed. Whoever confirms first decides; this cannot be undone here.'
                  : 'It will be recorded as Missed. Whoever reports first decides; this cannot be undone here.'}
              </Text>
            </VStack>
          )}
        </ModalBody>
        <ModalFooter gap={2}>
          <Button variant="ghost" onClick={onClose} isDisabled={busy}>Cancel</Button>
          <Button colorScheme={complete ? 'green' : 'red'} onClick={onConfirm} isLoading={busy}>Confirm</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
