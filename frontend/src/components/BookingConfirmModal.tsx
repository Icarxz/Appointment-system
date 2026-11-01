import type { FormEvent } from 'react';
import {
  Box, Button, FormControl, FormLabel, Modal, ModalBody, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalOverlay,
  Select, Text, Textarea, VStack, useColorModeValue,
} from '@chakra-ui/react';
import type { Slot } from '../utils/weekGrid';

// The confirm step after a student clicks a calendar cell: shows the chosen hour and its length, and asks for the
// purpose of the meeting. The parent owns the form state and the submit (it posts the request).
interface Props {
  isOpen: boolean;
  onClose: () => void;
  facultyName: string;
  slot: Slot | undefined;
  whenLabel: string;          // e.g. "Tue, Nov 3 · 9:00 AM – 10:00 AM"
  maxPending: number;
  purposeOptions: string[];
  purpose: string;
  onPurposeChange: (value: string) => void;
  reason: string;
  onReasonChange: (value: string) => void;
  isSubmitting: boolean;
  onSubmit: (e: FormEvent) => void;
}

export default function BookingConfirmModal({
  isOpen, onClose, facultyName, slot, whenLabel, maxPending, purposeOptions, purpose, onPurposeChange, reason, onReasonChange, isSubmitting, onSubmit,
}: Props) {
  const muted = useColorModeValue('#64748b', '#8fa6c4');
  const label = (t: string) => <Text fontSize="xs" fontWeight="700" color={muted} textTransform="uppercase" mb="2px">{t}</Text>;

  return (
    <Modal isOpen={isOpen} onClose={() => { if (!isSubmitting) onClose(); }} isCentered>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>Request this consultation</ModalHeader>
        <ModalCloseButton isDisabled={isSubmitting} />
        <form onSubmit={onSubmit}>
          <ModalBody>
            <VStack align="stretch" spacing={4}>
              <Box>{label('Professor')}<Text fontSize="sm">{facultyName}</Text></Box>
              <Box>{label('When')}<Text fontSize="sm">{whenLabel}</Text></Box>
              <Box>
                {label('Length')}
                <Text fontSize="sm">{slot ? `${slot.duration} minutes` : ''}</Text>
                <Text fontSize="xs" color={muted}>Your professor can shorten it when accepting.</Text>
              </Box>
              {slot && slot.pending > 0 && (
                <Text fontSize="xs" color={muted}>{slot.pending} of {maxPending} request spots for this hour are already taken. The professor accepts one.</Text>
              )}
              <FormControl isRequired>
                <FormLabel>Purpose of Meeting</FormLabel>
                <Select placeholder="Select a purpose" value={purpose} onChange={(e) => onPurposeChange(e.target.value)}>
                  {purposeOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </Select>
                {purpose === 'Others' && (
                  <Textarea mt={2} placeholder="Please specify your purpose..." value={reason} onChange={(e) => onReasonChange(e.target.value)} />
                )}
              </FormControl>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" mr={3} onClick={onClose} isDisabled={isSubmitting}>Back to calendar</Button>
            <Button type="submit" colorScheme="blue" isLoading={isSubmitting}>Submit request</Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}
