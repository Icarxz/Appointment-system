import { Fragment, useMemo, useState } from 'react';
import {
  Alert, AlertIcon, Badge, Button, HStack, IconButton, Input, Modal, ModalBody, ModalCloseButton, ModalContent, ModalHeader,
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
    const attention = pending.filter(i => !i.facultyId || i.ocr === 'failed' || i.identity === 'mismatch').length;
    const busyNow = pending.filter(i => i.facultyId && i.ocr !== 'failed' && i.identity !== 'mismatch'
      && (i.ocr === 'queued' || i.ocr === 'reading' || i.identity === 'checking')).length;
    return { imported, scheduled, attention, busyNow, ready: pending.length - attention - busyNow };
  }, [items]);

  const canReview = (i: ImportFile) => i.importState === 'pending' && i.ocr === 'done' && !!i.data
    && !!i.facultyId && i.identity !== 'mismatch' && i.identity !== 'checking';

  const statusCell = (i: ImportFile) => {
    if (i.importState === 'imported') return <Badge colorScheme="green">Imported</Badge>;
    if (i.importState === 'scheduled') return <Badge colorScheme="blue">Scheduled</Badge>;
    if (!i.facultyId) return <Badge colorScheme="orange">Choose faculty</Badge>;
    if (i.ocr === 'failed') return <Badge colorScheme="red">Failed</Badge>;
    if (i.ocr !== 'done' || i.identity === 'checking') return <Badge>{i.ocr === 'queued' ? 'Waiting' : 'Reading'}</Badge>;
    if (i.identity === 'mismatch') return <Badge colorScheme="red">Name differs</Badge>;
    if (i.alreadyImported || (i.fileHash && flags.firstByHash[i.fileHash] !== i.file.name)) return <Badge colorScheme="orange">Duplicate</Badge>;
    return <Badge colorScheme="green">Ready to review</Badge>;
  };

  const notes = (i: ImportFile): { text: string; bad?: boolean }[] => {
    const out: { text: string; bad?: boolean }[] = [];
    if (i.match.status === 'ambiguous' && !i.facultyId) out.push({ text: `More than one faculty account fits "${i.file.name}". Choose the right one.`, bad: true });
    if (i.match.status === 'unmatched' && !i.facultyId) out.push({ text: 'No faculty account has this name. Choose the faculty to continue.', bad: true });
    if (i.ocr === 'failed') out.push({ text: i.error, bad: true });
    if (i.identity === 'mismatch') out.push({ text: `The name printed on the sheet ("${i.identityRead}") does not match ${nameOf(i.facultyId)}. Choose the right account or remove this file.`, bad: true });
    if (i.identity === 'unreadable' && i.ocr === 'done') out.push({ text: 'The printed name could not be read reliably. You will confirm the owner yourself in the review step.' });
    if (i.alreadyImported) out.push({ text: i.alreadyImported });
    if (i.fileHash && flags.firstByHash[i.fileHash] !== i.file.name) out.push({ text: `Same file as ${flags.firstByHash[i.fileHash]} in this batch.` });
    if (i.facultyId && i.importState === 'pending' && flags.perFaculty[i.facultyId] > 1) out.push({ text: `Another file in this batch is also for ${nameOf(i.facultyId)}. Importing both would replace the first with the second.` });
    return out;
  };

  const discard = () => setConfirmCfg({
    title: 'Discard this bulk import?',
    body: <>The PDFs, edits, and check results in this import session will be cleared.</>,
    confirmLabel: 'Discard import',
    run: actions.clear,
  });
  const close = actions.minimize;

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
                <Text fontSize="sm">Choose up to {MAX_FILES} Faculty Individual Load PDFs (10 MB each) named after the faculty member, for example <b>Carl Spence.pdf</b> or <b>CARL_SPENCE.pdf</b>. Each file is matched to an account by its name and read one after another. Nothing is saved until you press Review and confirm that file.</Text>
              </Alert>
              <Input type="file" multiple accept="application/pdf,.pdf" pt={1} aria-label="Schedule PDFs"
                onChange={e => { void actions.addFiles(Array.from(e.target.files || [])); e.target.value = ''; }} />
              {problems.map((p, i) => <Alert key={i} status="warning" borderRadius="md" py={1}><AlertIcon /><Text fontSize="sm">{p}</Text></Alert>)}

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
                        const itemNotes = notes(i);
                        return (
                          <Fragment key={i.id}>
                            <Tr>
                              <Td maxW="220px" whiteSpace="normal" wordBreak="break-all" fontSize="xs">{i.file.name}</Td>
                              <Td>
                                <Select size="sm" minW="200px" value={i.facultyId} aria-label={`Faculty for ${i.file.name}`} placeholder="Choose faculty..."
                                  isDisabled={i.importState !== 'pending' || i.ocr === 'reading'} onChange={e => actions.assignFaculty(i.id, e.target.value)}>
                                  {options.map(f => <option key={f._id} value={f._id}>{f.name}</option>)}
                                </Select>
                              </Td>
                              <Td>{statusCell(i)}</Td>
                              <Td fontSize="xs" color={muted} whiteSpace="normal">
                                {i.ocr === 'reading' ? <HStack><Spinner size="xs" /><Text>Reading...</Text></HStack>
                                  : i.data ? `${i.data.classes.length} classes, ${i.data.consultationHours.length} consult blocks` : i.ocr === 'queued' ? 'Waiting for its turn' : ''}
                              </Td>
                              <Td>
                                <HStack spacing={1} justify="flex-end">
                                  {i.ocr === 'failed' && <Button size="xs" variant="outline" onClick={() => actions.retryFile(i.id)}>Retry</Button>}
                                  {i.importState === 'pending' && <Button size="xs" colorScheme="blue" isDisabled={!canReview(i)}
                                    onClick={() => { if (!reviewId) actions.openReview(i.id); }}>{i.alreadyImported ? 'Review anyway' : 'Review'}</Button>}
                                  {i.importState === 'pending' && <IconButton size="xs" variant="ghost" aria-label={`Remove ${i.file.name}`}
                                    icon={<DeleteIcon />} isDisabled={i.ocr === 'reading' || reviewId === i.id} onClick={() => actions.removeFile(i.id)} />}
                                </HStack>
                              </Td>
                            </Tr>
                            {itemNotes.length > 0 && (
                              <Tr><Td colSpan={5} py={1} borderTop="none">
                                {itemNotes.map((x, k) => <Text key={k} fontSize="xs" fontWeight={x.bad ? 600 : 400} color={x.bad ? 'red.500' : muted} whiteSpace="normal">{x.text}</Text>)}
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
              <HStack justify="space-between">
                <Button variant="ghost" onClick={actions.resetBulk} isDisabled={items.length === 0}>Clear list</Button>
                <HStack>
                  <Button variant="ghost" onClick={discard}>Cancel / Discard</Button>
                  <Button onClick={close}>Minimize</Button>
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
