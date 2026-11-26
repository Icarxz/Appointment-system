import { useState } from 'react';
import { Box, Button, HStack, Progress, Text, useColorModeValue, VStack } from '@chakra-ui/react';
import ConfirmAction from '../components/ConfirmAction';
import type { ConfirmConfig } from '../components/ConfirmAction';
import { useImportSession } from './ImportSessionContextCore';

export default function ImportSessionMinimizedBar() {
  const { state, actions } = useImportSession();
  const [confirmCfg, setConfirmCfg] = useState<ConfirmConfig | null>(null);
  const bg = useColorModeValue('white', 'gray.800');
  const border = useColorModeValue('gray.200', 'whiteAlpha.300');
  if (!state.active || !state.minimized) return null;

  let status: string;
  let progress: number;
  let progressLabel: string;
  if (state.kind === 'bulk') {
    const total = state.files.length;
    const pending = state.files.filter(i => i.importState === 'pending');
    const checked = state.files.filter(i => i.importState !== 'pending'
      || (i.batchCheck && i.batchCheck.status !== 'checking')).length;
    const submitted = state.files.filter(i => i.importState !== 'pending'
      || i.batchCheck?.status === 'submitFailed').length;
    const attention = pending.filter(i => !i.facultyId || i.ocr === 'failed' || i.identity === 'mismatch'
      || i.batchCheck?.status === 'blocked' || i.batchCheck?.status === 'failed' || i.batchCheck?.status === 'submitFailed').length;
    const busy = pending.filter(i => i.facultyId && i.ocr !== 'failed' && i.identity !== 'mismatch'
      && (i.ocr === 'queued' || i.ocr === 'reading' || i.identity === 'checking')).length;
    const ready = pending.length - attention - busy;
    const processed = state.files.filter(i => i.importState !== 'pending' || i.ocr === 'done' || i.ocr === 'failed').length;
    if (state.bulkSubmitting) {
      status = `Bulk import: submitting ${submitted} of ${total}; ${pending.length - submitted} remain`;
      progress = total ? Math.round(submitted / total * 100) : 0;
      progressLabel = `${submitted} of ${total} submitted or failed`;
    } else if (state.bulkChecking) {
      status = `Bulk import: checking ${checked} of ${total}`;
      progress = total ? Math.round(checked / total * 100) : 0;
      progressLabel = `${checked} of ${total} checked`;
    } else {
      status = total
        ? `Bulk import: ${ready} of ${total} ready, ${attention} need attention`
        : 'Bulk import: choose PDFs to begin';
      progress = total ? Math.round(processed / total * 100) : 0;
      progressLabel = `${processed} of ${total} read`;
    }
  } else {
    status = state.reading ? 'Schedule import: reading PDF'
      : state.outcome ? 'Schedule import: complete'
        : state.parsed ? (state.report ? 'Schedule import: checked, ready to confirm' : 'Schedule import: draft ready to review')
          : 'Schedule import: choose a PDF';
    progress = state.outcome ? 100 : state.reading ? 35 : state.report ? 85 : state.parsed ? 60 : 0;
    progressLabel = state.outcome ? 'Complete' : state.reading ? 'Reading PDF' : state.parsed ? 'Draft ready' : 'Waiting for PDF';
  }

  return (
    <>
      <Box position="fixed" right={4} bottom={4} zIndex={1600} width={{ base: 'calc(100vw - 32px)', sm: '380px' }}
        bg={bg} borderWidth="1px" borderColor={border} borderRadius="lg" boxShadow="xl" p={4}>
        <VStack align="stretch" spacing={2}>
          <Text fontSize="sm" fontWeight="700">{status}</Text>
          <HStack spacing={3}>
            <Progress value={progress} size="sm" borderRadius="full" flex="1" colorScheme="blue" aria-label="Import progress" />
            <Text fontSize="xs" color="gray.500" whiteSpace="nowrap">{progressLabel}</Text>
          </HStack>
          <HStack justify="flex-end">
            <Button size="sm" variant="ghost" isDisabled={state.bulkSubmitting} onClick={() => setConfirmCfg({
              title: 'Discard this import?',
              body: <>The PDFs, edits, and check results in this import session will be cleared.</>,
              confirmLabel: 'Discard import',
              run: actions.clear,
            })}>Discard</Button>
            <Button size="sm" colorScheme="blue" onClick={actions.restore}>Open</Button>
          </HStack>
        </VStack>
      </Box>
      <ConfirmAction config={confirmCfg} onClose={() => setConfirmCfg(null)} />
    </>
  );
}
