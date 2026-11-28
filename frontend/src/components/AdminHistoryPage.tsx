import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Badge, Box, Button, Flex, FormControl, FormLabel, Heading, HStack, Input, SimpleGrid,
  Spinner, Table, TableContainer, Tbody, Td, Text, Th, Thead, Tr, VStack, useColorModeValue,
} from '@chakra-ui/react';
import ConfirmAction from './ConfirmAction';
import type { ConfirmConfig } from './ConfirmAction';
import { authFetch } from './authFetch';
import { friendlyError } from '../utils/friendlyError';

interface Term {
  _id: string;
  academicYear: string;
  name: string;
  startDate: string;
  endDate: string;
  createdAt: string;
}

interface ActivityRow {
  time: string;
  actorName: string;
  actorRole: string;
  subjectName: string;
  eventType: string;
  description: string;
}

interface ActivityResponse {
  rows: ActivityRow[];
  page: number;
  limit: number;
  total: number;
  pages: number;
}

interface TermDraft {
  academicYear: string;
  name: string;
  startDate: string;
  endDate: string;
}

const API = import.meta.env.VITE_API_URL;
const GROUPS = [
  { value: '', label: 'All activity' },
  { value: 'ACCOUNT', label: 'Account' },
  { value: 'SCHEDULE', label: 'Schedule' },
  { value: 'APPOINTMENT', label: 'Appointment' },
] as const;
const emptyDraft: TermDraft = { academicYear: '', name: '', startDate: '', endDate: '' };
const roleLabel = (role: string) => role ? role.charAt(0) + role.slice(1).toLowerCase() : 'Unknown';
const manilaTimestamp = (value: string) => new Date(value).toLocaleString(undefined, {
  timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short',
});

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validateDraft(draft: TermDraft, terms: Term[], editingId: string | null) {
  const name = draft.name.trim();
  if (!name || name.length > 60) return 'Enter a term name between 1 and 60 characters.';
  if (!/^\d{4}-\d{4}$/.test(draft.academicYear)
    || Number(draft.academicYear.slice(5)) !== Number(draft.academicYear.slice(0, 4)) + 1) {
    return 'Enter an academic year like 2025-2026.';
  }
  if (!isValidDate(draft.startDate) || !isValidDate(draft.endDate)) {
    return 'Enter valid start and end dates.';
  }
  if (draft.startDate >= draft.endDate) return 'The end date must be after the start date.';
  const overlap = terms.find((term) => term._id !== editingId
    && draft.startDate <= term.endDate && term.startDate <= draft.endDate);
  if (overlap) return `These dates overlap "${overlap.name} ${overlap.academicYear}". Choose dates outside that term.`;
  return '';
}

function HistoryPanel({ children }: { children: ReactNode }) {
  const background = useColorModeValue('white', 'gray.800');
  const border = useColorModeValue('gray.200', 'whiteAlpha.300');
  return <Box bg={background} borderWidth="1px" borderColor={border} borderRadius="lg" p={{ base: 3, md: 5 }}>{children}</Box>;
}

export default function AdminHistoryPage() {
  const [activeTab, setActiveTab] = useState<'activity' | 'terms'>('activity');
  const [activity, setActivity] = useState<ActivityResponse | null>(null);
  const [terms, setTerms] = useState<Term[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [termsLoading, setTermsLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [savingTerm, setSavingTerm] = useState(false);
  const [error, setError] = useState('');
  const [termMessage, setTermMessage] = useState('');
  const [termMessageIsError, setTermMessageIsError] = useState(false);
  const [editingTermId, setEditingTermId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TermDraft>(emptyDraft);
  const [confirmConfig, setConfirmConfig] = useState<ConfirmConfig | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [group, setGroup] = useState('');
  const [actor, setActor] = useState('');
  const [subject, setSubject] = useState('');
  const [textSearch, setTextSearch] = useState('');
  const [page, setPage] = useState(1);
  const cardMuted = useColorModeValue('gray.600', 'gray.300');
  const tableBorder = useColorModeValue('gray.100', 'whiteAlpha.200');

  const loadTerms = useCallback(async () => {
    try {
      const response = await authFetch(`${API}/api/terms`);
      if (!response.ok) throw new Error();
      const data = await response.json() as Term[];
      setTerms(data);
      setError('');
    } catch (requestError) {
      setError(friendlyError(requestError, 'Could not load the term calendar. Please try again.'));
    } finally {
      setTermsLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    authFetch(`${API}/api/terms`)
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return response.json() as Promise<Term[]>;
      })
      .then((data) => {
        if (active) {
          setTerms(data);
          setError('');
        }
      })
      .catch((requestError) => {
        if (active) setError(friendlyError(requestError, 'Could not load the term calendar. Please try again.'));
      })
      .finally(() => { if (active) setTermsLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ page: String(page), limit: '50' });
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (group) params.set('group', group);
    if (actor.trim()) params.set('actor', actor.trim());
    if (subject.trim()) params.set('subjectUser', subject.trim());
    if (textSearch.trim()) params.set('text', textSearch.trim());
    authFetch(`${API}/api/history/activity?${params}`)
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return response.json() as Promise<ActivityResponse>;
      })
      .then((data) => {
        if (active) {
          setActivity(data);
          setError('');
        }
      })
      .catch((requestError) => {
        if (active) setError(friendlyError(requestError, 'Could not load system activity. Please try again.'));
      })
      .finally(() => { if (active) setActivityLoading(false); });
    return () => { active = false; };
  }, [from, to, group, actor, subject, textSearch, page]);

  const termGroups = useMemo(() => {
    const year = Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Manila', year: 'numeric' }).format(new Date()));
    const startYears = new Set([year - 1, year]);
    terms.forEach((term) => startYears.add(Number(term.academicYear.slice(0, 4))));
    const academicYears = [...new Set([...startYears].map((start) => `${start}-${start + 1}`))].sort().reverse();
    return academicYears.map((academicYear) => {
      const start = Number(academicYear.slice(0, 4));
      return {
        academicYear,
        defaults: [
          { name: 'First Semester', startDate: `${start}-08-01`, endDate: `${start}-12-31` },
          { name: 'Second Semester', startDate: `${start + 1}-01-01`, endDate: `${start + 1}-04-30` },
        ],
        defined: terms.filter((term) => term.academicYear === academicYear)
          .sort((a, b) => a.startDate.localeCompare(b.startDate)),
      };
    });
  }, [terms]);

  const buildFilters = () => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (group) params.set('group', group);
    if (actor.trim()) params.set('actor', actor.trim());
    if (subject.trim()) params.set('subjectUser', subject.trim());
    if (textSearch.trim()) params.set('text', textSearch.trim());
    return params;
  };

  const changeActivityFilter = (change: () => void) => {
    setActivityLoading(true);
    setError('');
    setPage(1);
    change();
  };

  const exportCsv = async () => {
    setExporting(true);
    setError('');
    try {
      const response = await authFetch(`${API}/api/history/activity/export.csv?${buildFilters()}`);
      if (!response.ok) throw new Error();
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = 'activity-history.csv';
      link.click();
      URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(friendlyError(requestError, 'Could not export system activity. Please try again.'));
    } finally {
      setExporting(false);
    }
  };

  const resetTermForm = () => {
    setEditingTermId(null);
    setDraft(emptyDraft);
    setTermMessage('');
  };

  const saveTerm = async () => {
    const validationMessage = validateDraft(draft, terms, editingTermId);
    if (validationMessage) {
      setTermMessage(validationMessage);
      setTermMessageIsError(true);
      return;
    }
    setSavingTerm(true);
    setError('');
    setTermMessage('');
    try {
      const response = await authFetch(`${API}/api/terms${editingTermId ? `/${editingTermId}` : ''}`, {
        method: editingTermId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      if (!response.ok) {
        if (response.status === 400) {
          setTermMessage('The term details are invalid or overlap another term. Check the dates and academic year.');
          setTermMessageIsError(true);
          return;
        }
        throw new Error();
      }
      await loadTerms();
      setTermMessage(editingTermId ? 'Term updated.' : 'Term added.');
      setTermMessageIsError(false);
      setEditingTermId(null);
      setDraft(emptyDraft);
    } catch (requestError) {
      setError(friendlyError(requestError, 'Could not save the term. Please try again.'));
    } finally {
      setSavingTerm(false);
    }
  };

  const deleteTerm = async (term: Term) => {
    setError('');
    try {
      const response = await authFetch(`${API}/api/terms/${term._id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error();
      await loadTerms();
      if (editingTermId === term._id) resetTermForm();
    } catch (requestError) {
      setError(friendlyError(requestError, 'Could not delete the term. Please try again.'));
    }
  };

  const startEdit = (term: Term) => {
    setEditingTermId(term._id);
    setDraft({ academicYear: term.academicYear, name: term.name, startDate: term.startDate, endDate: term.endDate });
    setTermMessage('');
  };

  return (
    <Box flex="1" minH={0} overflowY="auto" p={{ base: 3, md: 6 }}>
      <HStack mb={4} spacing={2} flexWrap="wrap">
        <Button size="sm" colorScheme="blue" variant={activeTab === 'activity' ? 'solid' : 'outline'} onClick={() => setActiveTab('activity')}>System Activity</Button>
        <Button size="sm" colorScheme="blue" variant={activeTab === 'terms' ? 'solid' : 'outline'} onClick={() => setActiveTab('terms')}>Term calendar</Button>
      </HStack>
      {error && <Text role="alert" color="red.500" mb={3}>{error}</Text>}

      {activeTab === 'activity' && (
        <VStack align="stretch" spacing={4}>
          <HistoryPanel>
            <SimpleGrid columns={{ base: 1, sm: 2, lg: 3 }} spacing={3}>
              <FormControl><FormLabel fontSize="sm">From</FormLabel><Input aria-label="Activity from date" type="date" value={from} onChange={(event) => changeActivityFilter(() => setFrom(event.target.value))} /></FormControl>
              <FormControl><FormLabel fontSize="sm">To</FormLabel><Input aria-label="Activity to date" type="date" value={to} onChange={(event) => changeActivityFilter(() => setTo(event.target.value))} /></FormControl>
              <FormControl><FormLabel fontSize="sm">Actor</FormLabel><Input placeholder="Name, email or System" value={actor} onChange={(event) => changeActivityFilter(() => setActor(event.target.value))} /></FormControl>
              <FormControl><FormLabel fontSize="sm">Subject user</FormLabel><Input placeholder="Name, email or ID" value={subject} onChange={(event) => changeActivityFilter(() => setSubject(event.target.value))} /></FormControl>
              <FormControl><FormLabel fontSize="sm">Text search</FormLabel><Input placeholder="Search activity" value={textSearch} onChange={(event) => changeActivityFilter(() => setTextSearch(event.target.value))} /></FormControl>
            </SimpleGrid>
            <Flex mt={4} align="center" justify="space-between" gap={3} flexWrap="wrap">
              <HStack spacing={2} flexWrap="wrap" aria-label="Filter by activity group">
                {GROUPS.map((item) => (
                  <Button key={item.value || 'all'} size="sm" borderRadius="full" variant={group === item.value ? 'solid' : 'outline'} colorScheme="blue"
                    aria-pressed={group === item.value} onClick={() => changeActivityFilter(() => setGroup(item.value))}>{item.label}</Button>
                ))}
              </HStack>
              <Button size="sm" colorScheme="blue" variant="outline" onClick={exportCsv} isLoading={exporting}>Export CSV</Button>
            </Flex>
            <Text fontSize="sm" color={cardMuted} mt={3}>{activity?.total || 0} activity records</Text>
          </HistoryPanel>

          <HistoryPanel>
            {activityLoading ? <Flex justify="center" py={8}><Spinner /></Flex> : activity?.rows.length ? (
              <TableContainer>
                <Table size="sm" variant="simple">
                  <Thead><Tr>
                    <Th>Time</Th><Th>Actor</Th><Th>Action</Th><Th>Subject</Th>
                  </Tr></Thead>
                  <Tbody>
                    {activity.rows.map((row, index) => (
                      <Tr key={`${row.time}-${row.eventType}-${index}`} borderColor={tableBorder}>
                        <Td whiteSpace="nowrap">{manilaTimestamp(row.time)}</Td>
                        <Td minW="160px">
                          <Text>{row.actorName}</Text>
                          <Badge mt={1} colorScheme={row.actorRole === 'SYSTEM' ? 'gray' : 'blue'}>{roleLabel(row.actorRole)}</Badge>
                        </Td>
                        <Td whiteSpace="normal" minW="220px">{row.description}</Td>
                        <Td>{row.subjectName}</Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </TableContainer>
            ) : !activityLoading ? <Text color={cardMuted} py={6} textAlign="center">No activity matches these filters.</Text> : null}
          </HistoryPanel>

          {activity && activity.pages > 1 && (
            <Flex align="center" justify="space-between">
              <Button size="sm" onClick={() => { setActivityLoading(true); setPage((value) => Math.max(1, value - 1)); }} isDisabled={page <= 1}>Previous</Button>
              <Text fontSize="sm" color={cardMuted}>Page {page} of {activity.pages}</Text>
              <Button size="sm" onClick={() => { setActivityLoading(true); setPage((value) => Math.min(activity.pages, value + 1)); }} isDisabled={page >= activity.pages}>Next</Button>
            </Flex>
          )}
        </VStack>
      )}

      {activeTab === 'terms' && (
        <VStack align="stretch" spacing={4}>
          <HistoryPanel>
            <Heading size="sm" mb={1}>{editingTermId ? 'Edit term' : 'Add an Admin-defined term'}</Heading>
            <Text fontSize="sm" color={cardMuted} mb={4}>Default semesters are always available. Admin-defined terms can cover dates outside or within the default calendar.</Text>
            <SimpleGrid columns={{ base: 1, sm: 2, lg: 4 }} spacing={3}>
              <FormControl><FormLabel fontSize="sm">Academic year</FormLabel><Input placeholder="2025-2026" value={draft.academicYear} onChange={(event) => setDraft((value) => ({ ...value, academicYear: event.target.value }))} /></FormControl>
              <FormControl><FormLabel fontSize="sm">Term name</FormLabel><Input placeholder="Summer" value={draft.name} onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} /></FormControl>
              <FormControl><FormLabel fontSize="sm">Start date</FormLabel><Input type="date" value={draft.startDate} onChange={(event) => setDraft((value) => ({ ...value, startDate: event.target.value }))} /></FormControl>
              <FormControl><FormLabel fontSize="sm">End date</FormLabel><Input type="date" value={draft.endDate} onChange={(event) => setDraft((value) => ({ ...value, endDate: event.target.value }))} /></FormControl>
            </SimpleGrid>
            <HStack mt={4} spacing={2}>
              <Button size="sm" colorScheme="blue" onClick={saveTerm} isLoading={savingTerm}>{editingTermId ? 'Save changes' : 'Add term'}</Button>
              {editingTermId && <Button size="sm" variant="ghost" onClick={resetTermForm} isDisabled={savingTerm}>Cancel edit</Button>}
            </HStack>
            {termMessage && <Text role="status" color={termMessageIsError ? 'red.500' : 'green.500'} fontSize="sm" mt={3}>{termMessage}</Text>}
          </HistoryPanel>

          {termsLoading ? <Flex justify="center" py={8}><Spinner /></Flex> : termGroups.map((grouped) => (
            <HistoryPanel key={grouped.academicYear}>
              <Heading size="sm" mb={3}>{grouped.academicYear}</Heading>
              <VStack align="stretch" spacing={2}>
                {grouped.defaults.map((term) => (
                  <Flex key={term.name} justify="space-between" gap={3} flexWrap="wrap" borderBottomWidth="1px" borderColor={tableBorder} py={2}>
                    <Box><Text fontWeight="semibold">{term.name} <Badge colorScheme="gray">Default</Badge></Text>
                      <Text fontSize="sm" color={cardMuted}>{term.startDate} to {term.endDate}</Text></Box>
                  </Flex>
                ))}
                {grouped.defined.map((term) => (
                  <Flex key={term._id} justify="space-between" align="center" gap={3} flexWrap="wrap" borderBottomWidth="1px" borderColor={tableBorder} py={2}>
                    <Box><Text fontWeight="semibold">{term.name} <Badge colorScheme="purple">Admin-defined</Badge></Text>
                      <Text fontSize="sm" color={cardMuted}>{term.startDate} to {term.endDate}</Text></Box>
                    <HStack spacing={2}>
                      <Button size="xs" variant="outline" onClick={() => startEdit(term)}>Edit</Button>
                      <Button size="xs" colorScheme="red" variant="outline" onClick={() => setConfirmConfig({
                        title: 'Delete this term?',
                        body: `${term.name} (${term.academicYear}) will be removed from the calendar. History records will not be deleted.`,
                        confirmLabel: 'Delete term',
                        run: () => { void deleteTerm(term); },
                      })}>Delete</Button>
                    </HStack>
                  </Flex>
                ))}
              </VStack>
            </HistoryPanel>
          ))}
          {!termsLoading && terms.length === 0 && <Text color={cardMuted}>No Admin-defined terms yet. Default semesters are shown above.</Text>}
        </VStack>
      )}
      <ConfirmAction config={confirmConfig} onClose={() => setConfirmConfig(null)} />
    </Box>
  );
}
