import { useRef } from 'react';
import type { ReactNode } from 'react';
import {
  AlertDialog, AlertDialogOverlay, AlertDialogContent, AlertDialogHeader, AlertDialogBody, AlertDialogFooter, Button,
} from '@chakra-ui/react';

export interface ConfirmConfig {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  /** Runs when the person presses the confirm button; the dialog closes first. */
  run: () => void;
}

// One "Are you sure?" dialog for buttons that change saved data. The text names the action, so the person knows what
// pressing the confirm button will do. Cancel is focused first, so Enter never confirms by accident.
export default function ConfirmAction({ config, onClose }: { config: ConfirmConfig | null; onClose: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog isOpen={!!config} leastDestructiveRef={cancelRef} onClose={onClose} isCentered motionPreset="scale">
      <AlertDialogOverlay>
        <AlertDialogContent mx={4}>
          <AlertDialogHeader>{config?.title}</AlertDialogHeader>
          <AlertDialogBody fontSize="sm">{config?.body}</AlertDialogBody>
          <AlertDialogFooter gap={3}>
            <Button ref={cancelRef} variant="ghost" onClick={onClose}>Cancel</Button>
            <Button colorScheme="blue" onClick={() => { const run = config?.run; onClose(); run?.(); }}>{config?.confirmLabel}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogOverlay>
    </AlertDialog>
  );
}
