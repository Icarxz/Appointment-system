import { useEffect, useState } from 'react';
import {
  Badge, Box, Button, Flex, Grid, Heading, HStack, IconButton, Menu, MenuButton, MenuItem, MenuList, Select, Text,
} from '@chakra-ui/react';
import { RepeatIcon } from '@chakra-ui/icons';
import { formatTime } from './dateUtils';
import AppealControls from './AppealControls';
import { statusColor, statusLabel, isBeforeCutoff, hasStarted, CANCEL_CUTOFF_HOURS } from './appointmentStatus';
import { useNavPalette } from '../utils/uiTokens';
import {
  NEXT_ACTION_LABELS, NO_FILTERS, applyFilters, distinct, groupByDate, nextActions, paginate, professorKey, sortNewestFirst,
} from '../utils/requestList';
import type { Filters, ListItem, NextAction } from '../utils/requestList';

// The student's "My Requests": filters (professor, reason, status, what I can do next), requests grouped under their
// date, 10 per page. Each row shows the time, professor, purpose and status, a View Details button (the reason a
// request was declined is there) and a "..." menu with the actions that are open right now.

const PAGE_SIZE = 10;
const dayHeading = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const canCancelNow = (a: ListItem) => isBeforeCutoff(a.date, a.time);

interface Props {
  requests: any[];
  onViewDetails: (id: string) => void;
  onCancel: (apt: any) => void;
  onViewAccomplishment: (apt: any) => void;
  /** Called after something changed on the server (an appeal) so the list reloads. */
  onChanged: () => void;
}

export default function StudentRequestList({ requests, onViewDetails, onCancel, onViewAccomplishment, onChanged }: Props) {
  const C = useNavPalette();
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [filters]);

  const professors = new Map<string, string>();
  requests.forEach(a => professors.set(professorKey(a), a.facultyId ? a.facultyId.name : 'Unknown'));
  const reasons = distinct(requests.map(a => a.reason));
  const statuses = distinct(requests.map(a => a.status));

  const shown = sortNewestFirst(applyFilters(requests as ListItem[], filters, canCancelNow)) as any[];
  const paged = paginate(shown, page, PAGE_SIZE);
  const groups = groupByDate(paged.rows as ListItem[]) as { date: string; items: any[] }[];
  const filtering = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);
  const set = (patch: Partial<Filters>) => setFilters(f => ({ ...f, ...patch }));

  const filterBox = (label: string, control: React.ReactNode) => (
    <Box minW={0}>
      <Text fontSize="sm" fontWeight="700" color={C.text} mb={1}>{label}</Text>
      {control}
    </Box>
  );

  const field = (label: string, value: React.ReactNode, span = false) => (
    <Box minW={0} gridColumn={span ? { base: '1 / -1', md: 'auto' } : undefined}>
      <Text fontSize="sm" fontWeight="700" color={C.text}>{label}</Text>
      {value}
    </Box>
  );

  const row = (apt: any) => {
    const actions = nextActions(apt, canCancelNow);
    const cancelClosed = (apt.status === 'PENDING' || apt.status === 'APPROVED') && !actions.includes('CAN_CANCEL') && !hasStarted(apt.date, apt.time);
    const menuItems: { key: string; label: string; danger?: boolean; run: () => void }[] = [];
    if (actions.includes('CAN_CANCEL')) menuItems.push({ key: 'cancel', label: apt.status === 'PENDING' ? 'Cancel Request' : 'Cancel Appointment', danger: true, run: () => onCancel(apt) });
    if (actions.includes('HAS_ACCOMPLISHMENT')) menuItems.push({ key: 'acc', label: 'View Accomplishment', run: () => onViewAccomplishment(apt) });
    return (
      <Grid
        key={apt._id} bg={C.surface} borderWidth="1px" borderColor={C.border} borderRadius="lg" px={4} py={3} gap={3} alignItems="center"
        templateColumns={{ base: 'repeat(2, minmax(0, 1fr))', md: '84px minmax(0, 1.2fr) minmax(0, 1.6fr) minmax(150px, 1.3fr) auto' }}
      >
        {field('Time', <Text fontSize="sm" color={C.text}>{formatTime(apt.time)}</Text>)}
        {field('Professor Name', <Text fontSize="sm" color={C.text} overflowWrap="anywhere">{apt.facultyId ? apt.facultyId.name : 'Unknown'}</Text>)}
        {field('Reason', <Text fontSize="sm" color={C.text} noOfLines={2} title={apt.reason}>{apt.reason}</Text>, true)}
        {field('Status', (
          <Box>
            <Badge colorScheme={statusColor(apt.status)} px={2} py={1} borderRadius="md">{statusLabel(apt.status)}</Badge>
            {cancelClosed && <Text fontSize="xs" color={C.textMid} mt={1}>Cancellation closed (less than {CANCEL_CUTOFF_HOURS} hour before).</Text>}
            <AppealControls apt={apt} role="STUDENT" onChanged={onChanged} />
          </Box>
        ), true)}
        <HStack spacing={2} justify={{ base: 'flex-start', md: 'flex-end' }} gridColumn={{ base: '1 / -1', md: 'auto' }}>
          <Button size="sm" variant="outline" onClick={() => onViewDetails(apt._id)}>View Details</Button>
          {menuItems.length > 0 && (
            <Menu placement="bottom-end">
              <MenuButton as={IconButton} size="sm" variant="outline" aria-label="More actions" icon={<span aria-hidden>⋯</span>} />
              <MenuList>
                {menuItems.map(m => <MenuItem key={m.key} color={m.danger ? 'red.500' : undefined} onClick={m.run}>{m.label}</MenuItem>)}
              </MenuList>
            </Menu>
          )}
        </HStack>
      </Grid>
    );
  };

  return (
    <Box>
      <Flex gap={3} wrap="wrap" align="flex-end" mb={5}>
        <Grid flex="1" minW="240px" gap={3} templateColumns={{ base: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' }}>
          {filterBox('Professor', (
            <Select value={filters.professor} onChange={e => set({ professor: e.target.value })} bg={C.surface} borderColor={C.border} color={C.text}>
              <option value="">All Professors</option>
              {Array.from(professors.entries()).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
            </Select>
          ))}
          {filterBox('Reason', (
            <Select value={filters.reason} onChange={e => set({ reason: e.target.value })} bg={C.surface} borderColor={C.border} color={C.text}>
              <option value="">All Reasons</option>
              {reasons.map(r => <option key={r} value={r}>{r.length > 50 ? `${r.slice(0, 50)}…` : r}</option>)}
            </Select>
          ))}
          {filterBox('Status', (
            <Select value={filters.status} onChange={e => set({ status: e.target.value })} bg={C.surface} borderColor={C.border} color={C.text}>
              <option value="">All Statuses</option>
              {statuses.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
            </Select>
          ))}
          {filterBox('Action', (
            <Select value={filters.action} onChange={e => set({ action: e.target.value as Filters['action'] })} bg={C.surface} borderColor={C.border} color={C.text}>
              <option value="">All Actions</option>
              {(Object.keys(NEXT_ACTION_LABELS) as NextAction[]).map(k => <option key={k} value={k}>{NEXT_ACTION_LABELS[k]}</option>)}
            </Select>
          ))}
        </Grid>
        <IconButton aria-label="Clear filters" title="Clear filters" icon={<RepeatIcon />} variant="outline" bg={C.surface} borderColor={C.border}
          isDisabled={!filtering} onClick={() => setFilters(NO_FILTERS)} />
      </Flex>

      {requests.length === 0 && <Text textAlign="center" py={10} color={C.textMid}>You have no appointment requests.</Text>}
      {requests.length > 0 && shown.length === 0 && (
        <Text textAlign="center" py={10} color={C.textMid}>No requests match these filters.</Text>
      )}

      {groups.map(g => (
        <Box key={g.date} mb={5}>
          <Heading as="h3" size="sm" color={C.text} mb={2}>{dayHeading(g.date)}</Heading>
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
