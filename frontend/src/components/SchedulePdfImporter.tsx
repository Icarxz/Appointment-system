import { useState } from 'react';
import {
  Alert, AlertIcon, Badge, Box, Button, Checkbox, HStack, Input, Modal, ModalBody, ModalCloseButton, ModalContent,
  ModalHeader, ModalOverlay, Spinner, Table, TableContainer, Tbody, Td, Text, Th, Thead, Tr, VStack, useColorModeValue, useToast,
} from '@chakra-ui/react';
import ConfirmAction from './ConfirmAction';
import type { ConfirmConfig } from './ConfirmAction';
import ScheduleDraftCalendar from './ScheduleDraftCalendar';
import { authFetch } from './authFetch';
import { useImportSession } from '../context/ImportSessionContextCore';
import {
  acceptedIssueMessage, blockingIssueMessage, IMPORT_BLOCKING_ACTION, IMPORT_WARNING_ACTION, parsedWarningDisplay,
} from '../utils/scheduleImportMessages';

const API = import.meta.env.VITE_API_URL;

// Faculty Schedule PDF Importer (phases 4-6): upload the scanned PDF, REVIEW and CHECK the draft, then CONFIRM it. Only the final confirm
// (after an "Are you sure?") changes anything: it replaces the class schedule and official consultation hours, or stages them for a future
// effectivity date. The server checks everything again; the previous schedule is kept in the import history and can be undone. Used from three places: Admin > Class Schedules, Admin > Provision Account
// and Faculty > Master Schedule. Admins can also load a draft JSON written by ocr/schedule_ocr.py (fallback while OCR hosting is undecided).

interface HistoryItem { id: string; status: string; effectivityDate: string; term: string; academicYear: string; confirmedAt: string; failureReason: string; classBlocks: number; consultationBlocks: number }

interface Props { facultyId: string; facultyName: string; mode: 'admin' | 'faculty'; isOpen: boolean }

export default function SchedulePdfImporter({ facultyId, facultyName, mode, isOpen }: Props) {
  const { state, actions } = useImportSession();
  const toast = useToast();
  const muted = useColorModeValue('#64748b', '#8fa6c4');
  const { parsed, classes, hours, identity, report, busy, reading, uploadError, fileHash, effDate, outcome, confirming } = state;
  const [confirmCfg, setConfirmCfg] = useState<ConfirmConfig | null>(null);
  const [history, setHistory] = useState<HistoryItem[] | null>(null);

  const reset = actions.resetDraft;
  const close = actions.minimize;

  // Step 1a: upload the scanned PDF; the server reads it with OCR and sends back editable rows
  const uploadPdf = actions.uploadPdf;
  const loadFile = actions.loadFile;
  const check = actions.check;
  const confirm = actions.confirm;
  const askConfirm = () => {
    const future = /^\d{4}-\d{2}-\d{2}$/.test(effDate) && effDate > new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
    setConfirmCfg({
      title: future ? 'Schedule this class schedule?' : 'Replace the current schedule?',
      body: future
        ? <>The new schedule for <b>{facultyName}</b> will start on <b>{effDate}</b>. Until then the current schedule stays. It is checked again on that day.</>
        : <>This replaces all of <b>{facultyName}</b>'s classes and official consultation hours with the {classes.length} class(es) and {hours.length} consultation block(s) shown here. The old schedule is kept in the import history and can be undone. Appointments are not changed.</>,
      confirmLabel: future ? 'Schedule it' : 'Replace schedule', run: confirm,
    });
  };
  const loadHistory = async () => {
    try {
      const res = await authFetch(`${API}/api/schedule-import/history/${encodeURIComponent(facultyId)}`);
      const data = await res.json();
      setHistory(res.ok ? data : []);
      if (!res.ok) toast({ title: 'Could not load the history', description: data.error, status: 'error', duration: 4000 });
    } catch { toast({ title: 'Could not reach the server', status: 'error', duration: 4000 }); }
  };
  const act = async (id: string, what: 'rollback' | 'cancel') => {
    try {
      const res = await authFetch(`${API}/api/schedule-import/${id}/${what}`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast({ title: what === 'rollback' ? 'Could not undo' : 'Could not cancel', description: data.error, status: 'error', duration: 7000, isClosable: true }); return; }
      toast({ title: what === 'rollback' ? 'Previous schedule restored' : 'Scheduled import cancelled', status: 'success', duration: 3000 });
      if (what === 'rollback') actions.notifyApplied();
      loadHistory();
    } catch { toast({ title: 'Could not reach the server', status: 'error', duration: 4000 }); }
  };
  const askAct = (it: HistoryItem, what: 'rollback' | 'cancel') => setConfirmCfg({
    title: what === 'rollback' ? 'Undo this import?' : 'Cancel this scheduled import?',
    body: what === 'rollback' ? <>The schedule that this import replaced goes back. This only works if nothing changed the schedule since.</> : <>It will not be applied on {it.effectivityDate}.</>,
    confirmLabel: what === 'rollback' ? 'Undo import' : 'Cancel import', run: () => act(it.id, what),
  });

  const discard = () => setConfirmCfg({
    title: state.kind === 'bulk' ? 'Cancel this schedule review?' : 'Discard this schedule import?',
    body: state.kind === 'bulk'
      ? <>The edits and check results for this PDF will be discarded. The rest of the bulk import will remain.</>
      : <>The PDF, edits, and check results in this import session will be cleared.</>,
    confirmLabel: state.kind === 'bulk' ? 'Cancel review' : 'Discard import',
    run: state.kind === 'bulk' ? actions.closeReview : actions.clear,
  });
  return (
    <Modal isOpen={isOpen} onClose={close} size="6xl" scrollBehavior="inside">
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>{mode === 'faculty' ? 'Import your schedule PDF' : `Import schedule PDF: ${facultyName}`}</ModalHeader>
        <ModalCloseButton />
        <ModalBody pb={6}>
          {outcome ? (
            <VStack align="stretch" spacing={3}>
              <Alert status="success" borderRadius="md"><AlertIcon />
                <Text fontSize="sm">{outcome.status === 'ACTIVE'
                  ? <><b>Schedule applied.</b> {facultyName}'s class schedule and official consultation hours were replaced{outcome.counts ? ` (${outcome.counts.classes} class(es), ${outcome.counts.hours} consultation block(s))` : ''}. The previous schedule is in the import history.</>
                  : <><b>Schedule scheduled.</b> It will be applied on {outcome.effectivityDate} after one more check. The current schedule stays until then.</>}</Text>
              </Alert>
              <HStack justify="flex-end"><Button colorScheme="blue" onClick={state.kind === 'bulk' ? actions.closeReview : actions.clear}>Done</Button></HStack>
            </VStack>
          ) : !parsed ? (
            <VStack align="stretch" spacing={3}>
              <Alert status="info" borderRadius="md"><AlertIcon />
                <Text fontSize="sm">Upload the scanned Faculty Individual Load form (PDF, up to 10 MB). It is read automatically, then you correct and check it here. Nothing is saved or changed yet.</Text>
              </Alert>
              <Input type="file" accept="application/pdf,.pdf" pt={1} isDisabled={reading} onChange={e => { uploadPdf(e.target.files?.[0]); e.target.value = ''; }} aria-label="Schedule PDF" />
              {reading && <HStack><Spinner size="sm" /><Text fontSize="sm" color={muted}>Reading the PDF. This can take up to a minute.</Text></HStack>}
              {uploadError && (
                <Alert status="error" borderRadius="md" role="alert">
                  <AlertIcon />
                  <VStack align="start" spacing={0}>
                    <Text fontSize="sm" fontWeight="700">{IMPORT_BLOCKING_ACTION}</Text>
                    <Text fontSize="sm">{uploadError}</Text>
                  </VStack>
                </Alert>
              )}
              {mode === 'admin' && (
                <Box borderTopWidth="1px" pt={3}>
                  <Text fontSize="xs" color={muted} mb={1}>Admin only: load a draft file (JSON) written by the OCR program instead.</Text>
                  <Input type="file" accept="application/json,.json" size="sm" pt={1} onChange={e => loadFile(e.target.files?.[0])} aria-label="Schedule draft file" />
                </Box>
              )}
              <Box borderTopWidth="1px" pt={3}>
                <Button size="xs" variant="ghost" onClick={loadHistory}>{history ? 'Refresh import history' : 'Show import history'}</Button>
                {history && (history.length === 0 ? <Text fontSize="xs" color={muted} mt={1}>No imports yet for {facultyName}.</Text> : (
                  <TableContainer mt={1}><Table size="sm"><Thead><Tr><Th>Status</Th><Th>Effective</Th><Th>Term</Th><Th>Blocks</Th><Th /></Tr></Thead>
                    <Tbody>{history.map(h => (
                      <Tr key={h.id}>
                        <Td><Badge colorScheme={h.status === 'ACTIVE' ? 'green' : h.status === 'SCHEDULED' ? 'blue' : h.status === 'FAILED' ? 'red' : 'gray'}>{h.status.replace('_', ' ')}</Badge>{h.failureReason && <Text fontSize="xs" color={muted} whiteSpace="normal">{h.failureReason}</Text>}</Td>
                        <Td>{h.effectivityDate}</Td><Td>{[h.term, h.academicYear].filter(Boolean).join(' ')}</Td><Td>{h.classBlocks} classes, {h.consultationBlocks} consult</Td>
                        <Td>{h.status === 'ACTIVE' && <Button size="xs" variant="outline" onClick={() => askAct(h, 'rollback')}>Undo</Button>}{h.status === 'SCHEDULED' && <Button size="xs" variant="outline" onClick={() => askAct(h, 'cancel')}>Cancel</Button>}</Td>
                      </Tr>))}</Tbody></Table></TableContainer>
                ))}
              </Box>
            </VStack>
          ) : (
            <VStack align="stretch" spacing={5}>
              {state.kind === 'bulk' && (
                <Button variant="link" alignSelf="flex-start" px={0} onClick={actions.backToList}>
                  {'< Back to list'}
                </Button>
              )}
              <Box fontSize="sm" color={muted}>
                {[parsed.metadata.term, parsed.metadata.academicYear && `AY ${parsed.metadata.academicYear}`, parsed.metadata.effectivityDate && `effective ${parsed.metadata.effectivityDate}`].filter(Boolean).join(' · ') || 'Term, year and effectivity date were not read: enter them when confirming.'}
              </Box>
              {parsed.warnings.map((warning, index) => {
                const display = parsedWarningDisplay(warning);
                return (
                  <Alert key={index} status="warning" borderRadius="md" py={2}>
                    <AlertIcon />
                    <VStack align="start" spacing={1}>
                      <Text fontSize="sm" fontWeight="700">{IMPORT_WARNING_ACTION}</Text>
                      <Text fontSize="sm">{display.message}</Text>
                      {display.skippedDetails && (
                        <details>
                          <summary>Show what was skipped</summary>
                          <Text fontSize="sm" mt={1}>{display.skippedDetails}</Text>
                        </details>
                      )}
                    </VStack>
                  </Alert>
                );
              })}

              <ScheduleDraftCalendar />

              <Box borderWidth="1px" borderRadius="md" p={3}>
                {report?.identity?.status === 'mismatch' ? (
                  <VStack align="start" spacing={0}>
                    <Text fontSize="sm" color="red.500" fontWeight={700}>{IMPORT_BLOCKING_ACTION}</Text>
                    <Text fontSize="sm">This document does not match the selected faculty account. Choose the correct account or a different PDF.</Text>
                  </VStack>
                ) : report?.identity?.status === 'match' ? (
                  <Text fontSize="sm" color="green.500" fontWeight={600}>The document matches the selected faculty account.</Text>
                ) : (
                  <Checkbox isChecked={identity} onChange={e => actions.setIdentity(e.target.checked)}>
                    {mode === 'faculty' ? 'This document really belongs to me' : <>This document belongs to <b>{facultyName}</b></>}
                  </Checkbox>
                )}
              </Box>

              {report && (
                <VStack align="stretch" spacing={2}>
                  {report.ok
                    ? <Alert status="success" borderRadius="md"><AlertIcon /><Text fontSize="sm"><b>Ready to confirm.</b> No blocking problems{report.warnings.length ? `, ${report.warnings.length} warning(s) to look at` : ''}. Nothing has been changed yet: set the effectivity date and press Confirm.</Text></Alert>
                    : <Alert status="error" borderRadius="md"><AlertIcon /><VStack align="start" spacing={0}><Text fontSize="sm" fontWeight="700">{IMPORT_BLOCKING_ACTION}</Text><Text fontSize="sm">{report.errors.length} issue(s) need to be fixed before confirming.</Text></VStack></Alert>}
                  {report.errors.filter(issue => !issue.ref).map((issue, index) => (
                    <Alert key={index} status="error" variant="left-accent" py={2}>
                      <AlertIcon />
                      <VStack align="start" spacing={0}>
                        <Text fontSize="sm" fontWeight="700">{IMPORT_BLOCKING_ACTION}</Text>
                        <Text fontSize="sm">{blockingIssueMessage(issue)}</Text>
                      </VStack>
                    </Alert>
                  ))}
                  {report.warnings.filter(warning => !warning.ref).map((warning, index) => (
                    <Alert key={index} status="warning" variant="left-accent" py={2}>
                      <AlertIcon />
                      <VStack align="start" spacing={0}>
                        <Text fontSize="sm" fontWeight="700">{IMPORT_WARNING_ACTION}</Text>
                        <Text fontSize="sm">{acceptedIssueMessage(warning)}</Text>
                      </VStack>
                    </Alert>
                  ))}
                </VStack>
              )}

              {report?.ok && (
                <HStack borderWidth="1px" borderRadius="md" p={3} spacing={3} align="end" wrap="wrap">
                  <Box>
                    <Text fontSize="sm" fontWeight={600} mb={1}>Effectivity date</Text>
                    <Input type="date" size="sm" value={effDate} onChange={e => actions.setEffDate(e.target.value)} aria-label="Effectivity date" maxW="190px" />
                  </Box>
                  <Text fontSize="xs" color={muted} flex="1" minW="220px">Today or earlier: applied right away. A later date: kept until that day, then checked again and applied.{!parsed?.metadata.effectivityDate && ' The date was not read from the document: enter it.'}</Text>
                  <Button colorScheme="green" onClick={askConfirm} isDisabled={!effDate} isLoading={confirming}>Confirm schedule</Button>
                </HStack>
              )}

              <HStack justify="space-between">
                <HStack>
                  {state.kind === 'bulk' && <Button variant="ghost" onClick={actions.backToList}>Back to list</Button>}
                  <Button variant="ghost" onClick={discard}>Cancel / Discard</Button>
                  <Button variant="ghost" onClick={close}>Minimize</Button>
                  {state.kind === 'single' && <Button variant="ghost" onClick={reset} title={fileHash ? `File fingerprint ${fileHash.slice(0, 12)}` : undefined}>Choose another file</Button>}
                </HStack>
                <Button colorScheme="blue" onClick={check} isLoading={busy}>Check schedule</Button>
              </HStack>
            </VStack>
          )}
        </ModalBody>
      </ModalContent>
      <ConfirmAction config={confirmCfg} onClose={() => setConfirmCfg(null)} />
    </Modal>
  );
}
