import { Fragment, useMemo, useState } from 'react';
import {
  Alert, AlertIcon, Badge, Button, Checkbox, HStack, IconButton, Input, Modal, ModalBody, ModalCloseButton, ModalContent, ModalHeader,
  ModalOverlay, Select, Spinner, Table, TableContainer, Tbody, Td, Text, Th, Thead, Tr, VStack, useColorModeValue,
} from '@chakra-ui/react';
import { DeleteIcon } from '@chakra-ui/icons';
import ConfirmAction from './ConfirmAction';
import type { ConfirmConfig } from './ConfirmAction';
import type { ImportFile } from '../context/ImportSessionContext';
import { useImportSession } from '../context/ImportSessionContextCore';

const MAX_FILES = 10;

export default function BulkSchedulePdfImporter() {
  const { state, actions } = useImportSession();
  const { files: items, problems, skipped, facultyList, reviewId } = state;
  const muted = useColorModeValue('#64748b', '#8fa6c4');
  const [confirmCfg, setConfirmCfg] = useState<ConfirmConfig | null>(null);
  const nameOf = (facultyId: string) => facultyList.find(f => f._id === facultyId)?.name || '';
  const batchReadyCount = items.filter(i => i.importState === 'pending' && i.batchCheck?.status === 'ready'
    && (!i.alreadyImported || i.importAgain)).length;
  const batchBusy = state.bulkChecking || state.bulkSubmitting;

  const flags = useMemo(() => {
    const firstByHash: Record<string, string> = {};
    const perFaculty: Record<string, number> = {};
    items.forEach(i => {
      if (i.fileHash && !firstByHash[i.fileHash]) firstByHash[i.fileHash] = i.file.name;
      if (i.facultyId && i.importState === 'pending') perFaculty[i.facultyId] = (perFaculty[i.facultyId] || 0) + 1;
    });
    return { firstByHash, perFaculty };
  }, [items]);

  const counts = useMemo(() => {
    const imported = items.filter(i => i.importState === 'imported').length;
    const scheduled = items.filter(i => i.importState === 'scheduled').length;
    const pending = items.filter(i => i.importState === 'pending');
    const attention = pending.filter(i => !i.facultyId || i.ocr === 'failed' || i.identity === 'mismatch'
      || i.batchCheck?.status === 'blocked' || i.batchCheck?.status === 'failed' || i.batchCheck?.status === 'submitFailed').length;
    const busyNow = pending.filter(i => i.facultyId && i.ocr !== 'failed' && i.identity !== 'mismatch'
      && (i.ocr === 'queued' || i.ocr === 'reading' || i.identity === 'checking')).length;
    return { imported, scheduled, attention, busyNow, ready: pending.length - attention - busyNow };
  }, [items]);

  const canReview = (i: ImportFile) => i.importState === 'pending' && i.ocr === 'done' && !!i.data
    && !!i.facultyId && i.identity !== 'mismatch' && i.identity !== 'checking';

  const statusCell = (i: ImportFile) => {
    if (i.importState === 'imported') return <Badge colorScheme="green">Imported</Badge>;
    if (i.importState === 'scheduled') return <Badge colorScheme="blue">Scheduled</Badge>;
    if (i.batchCheck?.status === 'checking') return <Badge colorScheme="blue">Checking</Badge>;
    if (i.batchCheck?.status === 'submitting') return <Badge colorScheme="blue">Submitting</Badge>;
    if (i.alreadyImported && !i.importAgain) return <Badge colorScheme="orange">Already imported</Badge>;
    if (i.batchCheck?.status === 'ready') return <Badge colorScheme="green">Ready to submit</Badge>;
    if (i.batchCheck?.status === 'blocked' || i.batchCheck?.status === 'failed' || i.batchCheck?.status === 'submitFailed') return <Badge colorScheme="red">Needs review</Badge>;
    if (!i.facultyId) return <Badge colorScheme="red">Needs faculty</Badge>;
    if (i.ocr === 'failed') return <Badge colorScheme="red">Unreadable</Badge>;
    if (i.ocr !== 'done' || i.identity === 'checking') return <Badge>{i.ocr === 'queued' ? 'Waiting' : 'Reading'}</Badge>;
    if (i.identity === 'mismatch') return <Badge colorScheme="red">Mismatch</Badge>;
    if (!i.ownershipConfirmed) return <Badge colorScheme="orange">Confirm owner</Badge>;
    if (i.alreadyImported || (i.fileHash && flags.firstByHash[i.fileHash] !== i.file.name)) return <Badge colorScheme="orange">Double-check</Badge>;
    return <Badge colorScheme="green">Ready to review</Badge>;
  };

  const notice = (i: ImportFile): { status: 'error' | 'warning'; message: string } | null => {
    if (!i.facultyId) {
      return i.match.status === 'unmatched'
        ? { status: 'error', message: 'No faculty member matches this PDF name. Choose the right faculty member.' }
        : { status: 'error', message: 'Choose a faculty member for this PDF.' };
    }
    if (!i.ownershipConfirmed) {
      return { status: 'error', message: `Tick the box to confirm this document belongs to ${nameOf(i.facultyId)}.` };
    }
    if (i.ocr === 'failed') return { status: 'error', message: 'We could not read this PDF. Retry it or remove it.' };
    if (i.identity === 'mismatch') {
      return { status: 'error', message: 'This PDF does not seem to belong to the selected faculty member. Choose another faculty member or a different PDF.' };
    }
    if (i.batchCheck?.report?.errors.length) {
      return { status: 'error', message: 'Fix the schedule issues in Review before submitting this PDF.' };
    }
    if (i.batchCheck?.status === 'blocked' || i.batchCheck?.status === 'failed' || i.batchCheck?.status === 'submitFailed') {
      if (i.batchCheck.message?.toLowerCase().includes('more than one pdf')) {
        return { status: 'error', message: `Only one PDF for ${nameOf(i.facultyId)} can be batch-submitted at a time.` };
      }
      if (i.batchCheck.message?.toLowerCase().includes('effectivity date')) {
        return { status: 'error', message: 'Add an effectivity date in Review before submitting this PDF.' };
      }
      return { status: 'error', message: 'We could not check or submit this PDF. Open Review and try again.' };
    }
    if (i.alreadyImported) {
      return { status: 'warning', message: `This exact PDF was already imported on ${i.alreadyImported}. It will be skipped unless you choose Import again.` };
    }
    if (i.fileHash && flags.firstByHash[i.fileHash] !== i.file.name) {
      return { status: 'warning', message: 'This PDF may be a duplicate. Double-check it before submitting.' };
    }
    if (i.facultyId && i.importState === 'pending' && flags.perFaculty[i.facultyId] > 1) {
      return { status: 'warning', message: `Several PDFs are assigned to ${nameOf(i.facultyId)}. Review them before submitting.` };
    }
    const hasReviewFlags = !!i.data && [
      ...i.data.classes,
      ...i.data.consultationHours,
    ].some(row => row.needsReview);
    if (i.data?.warnings.length || hasReviewFlags || i.batchCheck?.report?.warnings.length) {
      return { status: 'warning', message: 'Some schedule details need a double-check before submitting.' };
    }
    return null;
  };

  const discard = () => setConfirmCfg({
    title: 'Discard this bulk import?',
    body: <>The PDFs, edits, and check results in this import session will be cleared.</>,
    confirmLabel: 'Discard import',
    run: actions.clear,
  });
  const close = actions.minimize;
  const askBatchSubmit = () => {
    if (!batchReadyCount) return;
    setConfirmCfg({
      title: `Submit ${batchReadyCount} schedules?`,
      body: <>Each schedule is checked and saved separately. Green and yellow files are eligible; red files will not be saved.</>,
      confirmLabel: `Submit ${batchReadyCount} schedules`,
      run: () => { void actions.submitBulk(); },
    });
  };

  return (
    <>
      <Modal isOpen={!state.minimized} onClose={close} size="6xl" scrollBehavior="inside">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Import faculty schedule (PDFs)</ModalHeader>
          <ModalCloseButton />
          <ModalBody pb={6}>
            <VStack align="stretch" spacing={4}>
              <Alert status="info" borderRadius="md"><AlertIcon />
                <Text fontSize="sm">Choose up to {MAX_FILES} Faculty Individual Load PDFs (10 MB each) named after the faculty member, for example <b>Carl Spence.pdf</b> or <b>CARL_SPENCE.pdf</b>. Each file is matched to an account by its name and read one after another. Review files individually or pre-check and submit eligible files together; nothing is saved until you confirm submission.</Text>
              </Alert>
              <Input type="file" multiple accept="application/pdf,.pdf" pt={1} aria-label="Schedule PDFs" isDisabled={batchBusy}
                onChange={e => { void actions.addFiles(Array.from(e.target.files || [])); e.target.value = ''; }} />
              {problems.length > 0 && (
                <Alert status="warning" borderRadius="md" py={2}>
                  <AlertIcon />
                  <Text fontSize="sm">Some selected files could not be added: {problems.join(' ')}</Text>
                </Alert>
              )}

              {items.length > 0 && (
                <HStack spacing={2} wrap="wrap" fontSize="sm">
                  <Badge colorScheme="green">{counts.imported} imported</Badge>
                  <Badge colorScheme="blue">{counts.scheduled} scheduled</Badge>
                  <Badge colorScheme="teal">{counts.ready} ready to review</Badge>
                  <Badge colorScheme="orange">{counts.attention} need attention</Badge>
                  {counts.busyNow > 0 && <HStack spacing={1}><Spinner size="xs" /><Text color={muted}>{counts.busyNow} still being read</Text></HStack>}
                  {skipped > 0 && <Badge>{skipped} skipped</Badge>}
                </HStack>
              )}

              {items.length > 0 && (
                <TableContainer>
                  <Table size="sm">
                    <Thead><Tr><Th>PDF</Th><Th>Faculty</Th><Th>Status</Th><Th>Read</Th><Th /></Tr></Thead>
                    <Tbody>
                      {items.map(i => {
                        const options = i.match.status === 'ambiguous' ? i.match.candidates : facultyList;
                        const itemNotice = notice(i);
                        const readyToSubmit = i.batchCheck?.status === 'ready' && (!i.alreadyImported || i.importAgain);
                        return (
                          <Fragment key={i.id}>
                            <Tr>
                              <Td maxW="220px" whiteSpace="normal" wordBreak="break-all" fontSize="xs">{i.file.name}</Td>
                              <Td>
                                <VStack align="stretch" spacing={2}>
                                  <Select size="sm" minW="200px" value={i.facultyId} aria-label={`Faculty for ${i.file.name}`} placeholder="Choose faculty..."
                                    isDisabled={batchBusy || i.importState !== 'pending' || i.ocr === 'reading'} onChange={e => actions.assignFaculty(i.id, e.target.value)}>
                                    {options.map(f => <option key={f._id} value={f._id}>{f.name}</option>)}
                                  </Select>
                                  {i.facultyId && (
                                    <Checkbox size="sm" isChecked={i.ownershipConfirmed} isDisabled={batchBusy || i.importState !== 'pending'}
                                      onChange={e => actions.setFileOwnership(i.id, e.target.checked)}>
                                      This document belongs to <b>{nameOf(i.facultyId)}</b>
                                    </Checkbox>
                                  )}
                                  {i.alreadyImported && (
                                    <Checkbox size="sm" isChecked={i.importAgain} isDisabled={batchBusy || i.importState !== 'pending'}
                                      onChange={e => actions.setFileImportAgain(i.id, e.target.checked)}>
                                      Import again
                                    </Checkbox>
                                  )}
                                </VStack>
                              </Td>
                              <Td>{statusCell(i)}</Td>
                              <Td fontSize="xs" color={muted} whiteSpace="normal">
                                {i.ocr === 'reading' ? <HStack><Spinner size="xs" /><Text>Reading...</Text></HStack>
                                  : i.data ? `${i.data.classes.length} classes, ${i.data.consultationHours.length} consult blocks` : i.ocr === 'queued' ? 'Waiting for its turn' : ''}
                              </Td>
                              <Td>
                                <HStack spacing={1} justify="flex-end">
                                  {i.ocr === 'failed' && <Button size="xs" variant="outline" isDisabled={batchBusy} onClick={() => actions.retryFile(i.id)}>Retry</Button>}
                                  {i.importState === 'pending' && <Button size="xs" colorScheme="blue" isDisabled={batchBusy || !canReview(i)}
                                    onClick={() => { if (!reviewId) actions.openReview(i.id); }}>
                                    {i.alreadyImported && !readyToSubmit ? 'Review anyway' : 'Review'}
                                  </Button>}
                                  {i.importState === 'pending' && <IconButton size="xs" variant="ghost" aria-label={`Remove ${i.file.name}`}
                                    icon={<DeleteIcon />} isDisabled={batchBusy || i.ocr === 'reading' || reviewId === i.id} onClick={() => actions.removeFile(i.id)} />}
                                </HStack>
                              </Td>
                            </Tr>
                            {itemNotice && (
                              <Tr><Td colSpan={5} py={2} borderTop="none">
                                <Alert status={itemNotice.status} borderRadius="md" py={2}>
                                  <AlertIcon />
                                  <Text fontSize="sm">{itemNotice.message}</Text>
                                </Alert>
                              </Td></Tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </Tbody>
                  </Table>
                </TableContainer>
              )}

              {items.length > 0 && counts.ready + counts.attention + counts.busyNow === 0 && (
                <Alert status="success" borderRadius="md"><AlertIcon />
                  <Text fontSize="sm"><b>All files handled.</b> {counts.imported} imported, {counts.scheduled} scheduled{skipped ? `, ${skipped} skipped` : ''}.</Text>
                </Alert>
              )}
              {items.some(i => i.importState === 'pending') && (
                <VStack align="stretch" spacing={2} borderWidth="1px" borderRadius="md" p={3}>
                  <Text fontSize="sm" color={muted}>Pre-check pending PDFs, then submit the files that pass server validation. Yellow warnings are allowed; files with blocking issues stay here for review.</Text>
                  <HStack justify="flex-end">
                    <Button variant="outline" onClick={() => { void actions.prepareBulkSubmit(); }}
                      isLoading={state.bulkChecking} isDisabled={batchBusy || !!reviewId}>
                      Check files for batch submit
                    </Button>
                    <Button colorScheme="green" onClick={askBatchSubmit}
                      isDisabled={!batchReadyCount || batchBusy || !!reviewId}>
                      Submit {batchReadyCount} eligible
                    </Button>
                  </HStack>
                </VStack>
              )}
              <HStack justify="space-between">
                <Button variant="ghost" onClick={actions.resetBulk} isDisabled={items.length === 0 || batchBusy}>Clear list</Button>
                <HStack>
                  {items.length > 0 && <Button variant="ghost" onClick={discard} isDisabled={state.bulkSubmitting}>Cancel / Discard</Button>}
                  {items.length > 0
                    ? <Button onClick={close}>Minimize</Button>
                    : <Button onClick={actions.clear}>Close</Button>}
                </HStack>
              </HStack>
            </VStack>
          </ModalBody>
        </ModalContent>
      </Modal>
      <ConfirmAction config={confirmCfg} onClose={() => setConfirmCfg(null)} />
    </>
  );
}
