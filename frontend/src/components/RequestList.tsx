import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Badge, Box, Button, Flex, Grid, Heading, HStack, IconButton, Menu, MenuButton, MenuItem, MenuList, Text,
} from '@chakra-ui/react';
import { RepeatIcon } from '@chakra-ui/icons';
import { formatTime } from './dateUtils';
import AppealControls from './AppealControls';
import { statusColor, statusLabel, isBeforeCutoff, hasStarted, CANCEL_CUTOFF_HOURS } from './appointmentStatus';
import { useNavPalette } from '../utils/uiTokens';
import SearchableSelect from './SearchableSelect';
import {
  NEXT_ACTION_LABELS, NO_FILTERS, applyFilters, distinct, facultyNextActions, groupByRequestedDay, nextActions, paginate,
  professorKey, sortNewestFirst, studentKey,
} from '../utils/requestList';
import type { Filters, ListItem, NextAction } from '../utils/requestList';

// The request list of the student ("My Requests") and of the faculty member ("Appointment Requests"): filters (person,
// reason, status, what I can do next), newest first, grouped under the date, 10 per page. Every row has the same
// columns: Time, person, Reason, Status, then View Details and a "..." menu (an invisible placeholder when the menu is
// empty, so the columns of all rows line up). A faculty member's pending request also gets an answer bar under the row
// (start, length, Approve, Reject), which the dashboard supplies.

const PAGE_SIZE = 10;
const dayHeading = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const canCancelNow = (a: ListItem) => isBeforeCutoff(a.date, a.time);

const ACTION_OPTIONS: Record<'STUDENT' | 'FACULTY', NextAction[]> = {
  STUDENT: ['CAN_CANCEL', 'CAN_APPEAL', 'HAS_ACCOMPLISHMENT'],
  FACULTY: ['NEEDS_ANSWER', 'CAN_CANCEL', 'CAN_MARK_NO_SHOW', 'CAN_APPEAL'],
};

interface Props {
  role: 'STUDENT' | 'FACULTY';
  requests: any[];
  onViewDetails: (id: string) => void;
  onCancel: (apt: any) => void;
  /** Student only. */
  onViewAccomplishment?: (apt: any) => void;
  /** Faculty only: the student did not turn up. */
  onNoShow?: (apt: any) => void;
  /** Faculty only: the Approve / Reject bar shown under a request that waits for an answer (null for other rows). */
  answerBar?: (apt: any) => ReactNode;
  /** Called after something changed on the server (an appeal) so the list reloads. */
  onChanged: () => void;
}

export default function RequestList({ role, requests, onViewDetails, onCancel, onViewAccomplishment, onNoShow, answerBar, onChanged }: Props) {
  const C = useNavPalette();
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [filters]);

  const isStudent = role === 'STUDENT';
  const personKey = isStudent ? professorKey : studentKey;
  const actionsOf = (a: ListItem): NextAction[] => (isStudent ? nextActions(a, canCancelNow) : facultyNextActions(a, { canCancel: canCancelNow(a), started: hasStarted(a.date, a.time) }));

  const people = new Map<string, string>();
  requests.forEach(a => people.set(personKey(a), isStudent ? (a.facultyId ? a.facultyId.name : 'Unknown') : `${a.studentName || 'Unknown'} (${a.studentSection || ''})`));
  const reasons = distinct(requests.map(a => a.reason));
  const statuses = distinct(requests.map(a => a.status));

  const shown = sortNewestFirst(applyFilters(requests as ListItem[], filters, actionsOf, personKey)) as any[];
  const paged = paginate(shown, page, PAGE_SIZE);
  const groups = groupByRequestedDay(paged.rows as ListItem[]) as { day: string; items: any[] }[];
  const filtering = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);
  const set = (patch: Partial<Filters>) => setFilters(f => ({ ...f, ...patch }));

  const filterBox = (label: string, control: ReactNode) => (
    <Box minW={0}>
      <Text fontSize="sm" fontWeight="700" color={C.text} mb={1}>{label}</Text>
      {control}
    </Box>
  );

  const field = (label: string, value: ReactNode, span = false) => (
    <Box minW={0} gridColumn={span ? { base: '1 / -1', md: 'auto' } : undefined}>
      <Text fontSize="sm" fontWeight="700" color={C.text}>{label}</Text>
      {value}
    </Box>
  );

  const row = (apt: any) => {
    const actions = actionsOf(apt);
    const cancelClosed = (apt.status === 'PENDING' || apt.status === 'APPROVED') && !actions.includes('CAN_CANCEL') && !hasStarted(apt.date, apt.time) && !(apt.status === 'PENDING' && !isStudent);
    const menuItems: { key: string; label: string; danger?: boolean; run: () => void }[] = [];
    if (actions.includes('CAN_CANCEL')) menuItems.push({ key: 'cancel', label: apt.status === 'PENDING' ? 'Cancel Request' : 'Cancel Appointment', danger: true, run: () => onCancel(apt) });
    if (actions.includes('HAS_ACCOMPLISHMENT') && onViewAccomplishment) menuItems.push({ key: 'acc', label: 'View Accomplishment', run: () => onViewAccomplishment(apt) });
    if (actions.includes('CAN_MARK_NO_SHOW') && onNoShow) menuItems.push({ key: 'noshow', label: "Student didn't show", run: () => onNoShow(apt) });
    const bar = answerBar ? answerBar(apt) : null;
    return (
      <Box key={apt._id} bg={C.surface} borderWidth="1px" borderColor={C.border} borderRadius="lg" px={4} py={3}>
        <Grid
          gap={3} alignItems="center"
          templateColumns={{ base: 'repeat(2, minmax(0, 1fr))', md: '100px minmax(0, 1.2fr) minmax(0, 1.6fr) minmax(150px, 1.3fr) max-content' }}
        >
          {field('Time', (
            <>
              <Text fontSize="sm" color={C.text}>{formatTime(apt.time)}</Text>
              <Text fontSize="xs" color={C.textMid}>{dayHeading(apt.date)}</Text>
            </>
          ))}
          {isStudent
            ? field('Professor Name', <Text fontSize="sm" color={C.text} overflowWrap="anywhere">{apt.facultyId ? apt.facultyId.name : 'Unknown'}</Text>)
            : field('Student', (
              <>
                <Text fontSize="sm" color={C.text} overflowWrap="anywhere">{apt.studentName}</Text>
                {apt.studentSection && <Text fontSize="xs" color={C.textMid}>{apt.studentSection}</Text>}
              </>
            ))}
          {field('Reason', <Text fontSize="sm" color={C.text} noOfLines={2} title={apt.reason}>{apt.reason}</Text>, true)}
          {field('Status', (
            <Box>
              <Badge colorScheme={statusColor(apt.status)} px={2} py={1} borderRadius="md">{statusLabel(apt.status)}</Badge>
              {cancelClosed && <Text fontSize="xs" color={C.textMid} mt={1}>Cancellation closed (less than {CANCEL_CUTOFF_HOURS} hour before).</Text>}
              {!isStudent && apt.status === 'MISSED (FACULTY)' && <Text fontSize="xs" color={C.textMid} mt={1}>Not signed off. Open Consultation Log if it took place.</Text>}
              <AppealControls apt={apt} role={role} onChanged={onChanged} />
            </Box>
          ), true)}
          <HStack spacing={2} justify={{ base: 'flex-start', md: 'flex-end' }} gridColumn={{ base: '1 / -1', md: 'auto' }}>
            <Button size="sm" variant="outline" onClick={() => onViewDetails(apt._id)}>View Details</Button>
            {menuItems.length > 0 ? (
              <Menu placement="bottom-end">
                <MenuButton as={IconButton} size="sm" variant="outline" aria-label="More actions" icon={<span aria-hidden>⋯</span>} />
                <MenuList>
                  {menuItems.map(m => <MenuItem key={m.key} color={m.danger ? 'red.500' : undefined} onClick={m.run}>{m.label}</MenuItem>)}
                </MenuList>
              </Menu>
            ) : (
              // Same size as the menu button but invisible, so every row has the same width and the columns line up.
              <IconButton size="sm" variant="outline" aria-hidden tabIndex={-1} visibility="hidden" aria-label="No more actions" icon={<span aria-hidden>⋯</span>} />
            )}
          </HStack>
        </Grid>
        {bar && <Box mt={3} pt={3} borderTopWidth="1px" borderColor={C.border}>{bar}</Box>}
      </Box>
    );
  };

  return (
    <Box>
      <Flex gap={3} wrap="wrap" align="flex-end" mb={5}>
        <Grid flex="1" minW="240px" gap={3} templateColumns={{ base: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' }}>
          {filterBox(isStudent ? 'Professor' : 'Student', (
            <SearchableSelect value={filters.professor} onChange={value => set({ professor: value })}
              placeholder={isStudent ? 'All Professors' : 'All Students'}
              options={Array.from(people.entries()).sort((a, b) => a[1].localeCompare(b[1])).map(([key, name]) => ({ value: key, label: name }))} />
          ))}
          {filterBox('Reason', (
            <SearchableSelect value={filters.reason} onChange={value => set({ reason: value })} placeholder="All Reasons"
              options={reasons.map(reason => ({ value: reason, label: reason.length > 50 ? `${reason.slice(0, 50)}…` : reason }))} />
          ))}
          {filterBox('Status', (
            <SearchableSelect value={filters.status} onChange={value => set({ status: value })} placeholder="All Statuses"
              options={statuses.map(status => ({ value: status, label: statusLabel(status) }))} />
          ))}
          {filterBox('Action', (
            <SearchableSelect value={filters.action} onChange={value => set({ action: value as Filters['action'] })} placeholder="All Actions"
              options={ACTION_OPTIONS[role].map(action => ({ value: action, label: NEXT_ACTION_LABELS[action] }))} />
          ))}
        </Grid>
        <IconButton aria-label="Clear filters" title="Clear filters" icon={<RepeatIcon />} variant="outline" bg={C.surface} borderColor={C.border}
          isDisabled={!filtering} onClick={() => setFilters(NO_FILTERS)} />
      </Flex>

      {requests.length === 0 && <Text textAlign="center" py={10} color={C.textMid}>{isStudent ? 'You have no appointment requests.' : 'No appointments requested.'}</Text>}
      {requests.length > 0 && shown.length === 0 && (
        <Text textAlign="center" py={10} color={C.textMid}>No requests match these filters.</Text>
      )}

      {groups.map(g => (
        <Box key={g.day || 'older'} mb={5}>
          <Heading as="h3" size="sm" color={C.text} mb={2}>{g.day ? `Requested ${dayHeading(g.day)}` : 'Earlier requests'}</Heading>
          <Flex direction="column" gap={2}>{g.items.map(row)}</Flex>
        </Box>
      ))}

      {paged.pages > 1 && (
        <HStack spacing={2} justify="flex-end" mt={2} wrap="wrap">
          <Button size="sm" variant="outline" aria-label="Previous page" isDisabled={paged.page <= 1} onClick={() => setPage(paged.page - 1)}>‹</Button>
          {Array.from({ length: paged.pages }, (_, i) => i + 1).map(n => (
            <Button key={n} size="sm" variant={n === paged.page ? 'solid' : 'outline'} colorScheme={n === paged.page ? 'blue' : 'gray'}
              aria-current={n === paged.page ? 'page' : undefined} onClick={() => setPage(n)}>{n}</Button>
          ))}
          <Button size="sm" variant="outline" aria-label="Next page" isDisabled={paged.page >= paged.pages} onClick={() => setPage(paged.page + 1)}>›</Button>
        </HStack>
      )}
    </Box>
  );
}
