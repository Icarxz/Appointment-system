import { useCallback, useEffect, useState } from 'react';
import {
  Accordion, AccordionButton, AccordionItem, AccordionPanel, Box, Button, Flex, HStack, Select, SimpleGrid, Spinner, Tab, TabList,
  TabPanel, TabPanels, Table, Tabs, Tbody, Td, Text, Th, Thead, Tr, VStack, useColorModeValue, useDisclosure,
} from '@chakra-ui/react';
import { authFetch } from './authFetch';
import ExportBar from './ExportBar';
import SimpleBarChart from './SimpleBarChart';
import { ChartCard, HBarChart, Heatmap, KpiTile, LineChart, StackedBar } from './AnalyticsCharts';
import type { HeatmapData, LV } from './AnalyticsCharts';
import { AppealsByReason, CohortTable, DrilldownDrawer } from './AnalyticsTables';
import type { AppealRow, CohortRow, Drilldown } from './AnalyticsTables';

interface Window { total: number; last4: number; prev4: number }
interface ReportData {
  generatedAt: string;
  kpis: { requests: Window; completed: Window; missed: Window & { student: number; faculty: number }; completionRate: number | null; missedRate: number | null; activeFaculty: number };
  outcomes: {
    requests: number; completed: number; upcoming: number; declined: number; expired: number; missedStudent: number; missedFaculty: number;
    cancelledStudent: number; cancelledFaculty: number;
  };
  weekly: LV[];
  weeklyMissed: LV[];
  facultyLoad: { id: string; name: string; requests: number; completed: number }[];
  purposes: { total: number; items: { label: string; count: number; percent: number }[] };
  heatmap: HeatmapData;
  cohortStudents: CohortRow[];
  gender: { students: LV[]; faculty: LV[] };
  facultyOutcomes: { facultyId: string; name: string; programPosition: string; requests: number; completed: number; declined: number; expired: number; cancelledByFaculty: number; missedByFaculty: number; studentNoShows: number }[];
  studentOutcomes: { studentKey: string; name: string; section: string; completed: number; declined: number; cancelledByStudent: number; noShows: number }[];
  appeals: {
    summary: { appealRate: number | null; total: number; faculty: { made: number } };
    rows: AppealRow[]; reasons: string[];
  };
  drilldown: { requests: Drilldown; completed: Drilldown; missed: Drilldown; cancelled: Drilldown };
  accountHealth?: {
    byRole: LV[];
    profile: { role: string; complete: number; incomplete: number; incompleteList: { name: string; email: string }[] }[];
  };
}

const pctText = (n: number | null) => (n === null ? '—' : `${n}%`);
const trend = (w: Window) => `last 4 weeks: ${w.last4} (before that: ${w.prev4})`;
const ROLE_NAMES: Record<string, string> = { STUDENT: 'Students', FACULTY: 'Faculty', DEAN: 'Deans', ADMIN: 'Admins' };
const OUTCOME_COLORS = { completed: '#16a34a', upcoming: '#2563eb', declined: '#dc2626', expired: '#ca8a04', missedStudent: '#f08a3c', missedFaculty: '#e11d48', cancelledStudent: '#94a3b8', cancelledFaculty: '#64748b' };

// The Reports & Analytics page shared by Admin and Dean. Admin also gets an "Account health" tab.
export default function AnalyticsReport() {
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [outcomeView, setOutcomeView] = useState<'faculty' | 'student'>('faculty');
  const [panel, setPanel] = useState<{ title: string; data: Drilldown; studentLabel?: string; facultyLabel?: string } | null>(null);
  const drawer = useDisclosure();

  const border = useColorModeValue('#dde3ec', '#1e3048');
  const surface = useColorModeValue('#ffffff', '#111d30');
  const text = useColorModeValue('#0f2240', '#e8f0fe');
  const muted = useColorModeValue('#6b7fa0', '#7a93b0');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await authFetch(`${import.meta.env.VITE_API_URL}/api/analytics/report`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not load analytics.');
      setData(body);
    } catch (e: any) {
      setError(e.message || 'Could not load analytics.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading && !data) return <Flex justify="center" py={12}><Spinner color="blue.400" /></Flex>;
  if (error && !data) {
    return (
      <VStack py={8} spacing={3}>
        <Text color="red.400">{error}</Text>
        <Button size="sm" onClick={load}>Try again</Button>
      </VStack>
    );
  }
  if (!data) return null;

  const { kpis: k, outcomes: o } = data;
  const open = (title: string, d: Drilldown, studentLabel?: string, facultyLabel?: string) => { setPanel({ title, data: d, studentLabel, facultyLabel }); drawer.onOpen(); };
  const countCell = (n: number, color: string) => <Td isNumeric color={n > 0 ? color : muted} fontWeight={n > 0 ? 700 : 400}>{n}</Td>;
  const tableBox = { maxH: '340px', overflowY: 'auto' as const, borderWidth: '1px', borderColor: border, borderRadius: 'md' };

  const overview = (
    <VStack align="stretch" spacing={6}>
      <SimpleGrid columns={{ base: 2, md: 3, lg: 5 }} spacing={4}>
        <KpiTile label="Requests" value={k.requests.total} sub={trend(k.requests)} accent="#2563eb" hint="All requests that were reviewed or happened. Requests still waiting for an answer are not counted."
          onClick={() => open('Requests', data.drilldown.requests)} />
        <KpiTile label="Completed" value={k.completed.total} sub={trend(k.completed)} accent="#16a34a" onClick={() => open('Completed consultations', data.drilldown.completed)} />
        <KpiTile label="Missed" value={k.missed.total} sub={`${k.missed.student} by students · ${k.missed.faculty} by faculty · ${pctText(k.missedRate)} of finished`} accent="#f08a3c"
          hint="Missed rate = missed ÷ (completed + missed). Appeals do not reduce this number."
          onClick={() => open('Missed consultations', data.drilldown.missed, 'Missed by students', 'Missed by faculty')} />
        <KpiTile label="Cancelled" value={o.cancelledStudent + o.cancelledFaculty} sub={`${o.cancelledStudent} by students · ${o.cancelledFaculty} by faculty`} accent="#64748b"
          onClick={() => open('Cancelled consultations', data.drilldown.cancelled, 'Cancelled by students', 'Cancelled by faculty')} />
        <KpiTile label="Completion rate" value={pctText(k.completionRate)} sub="completed ÷ (completed + missed)" accent="#8b5cf6" hint="Of the consultations that were supposed to happen, how many were completed." />
      </SimpleGrid>

      <ChartCard title="Requests per week" hint="Last 8 weeks, weeks start on Monday.">
        <LineChart data={data.weekly} color="#2563eb" />
      </ChartCard>

      <SimpleGrid columns={{ base: 1, lg: 2 }} spacing={4}>
        <ChartCard title="What happened to requests" hint="Share of each outcome.">
          <StackedBar segments={[
            { label: 'Completed', value: o.completed, color: OUTCOME_COLORS.completed },
            { label: 'Upcoming', value: o.upcoming, color: OUTCOME_COLORS.upcoming },
            { label: 'Declined', value: o.declined, color: OUTCOME_COLORS.declined },
            { label: 'Expired (no response)', value: o.expired, color: OUTCOME_COLORS.expired },
            { label: 'Missed (student)', value: o.missedStudent, color: OUTCOME_COLORS.missedStudent },
            { label: 'Missed (faculty)', value: o.missedFaculty, color: OUTCOME_COLORS.missedFaculty },
            { label: 'Cancelled (student)', value: o.cancelledStudent, color: OUTCOME_COLORS.cancelledStudent },
            { label: 'Cancelled (faculty)', value: o.cancelledFaculty, color: OUTCOME_COLORS.cancelledFaculty },
          ]} />
        </ChartCard>
        <ChartCard title="Faculty load" hint="Requests received per faculty member (completed in brackets).">
          <HBarChart color="#2563eb" items={data.facultyLoad.slice(0, 8).map(f => ({ label: f.name, value: f.requests, note: `(${f.completed})` }))} emptyText="No faculty requests yet." />
        </ChartCard>
      </SimpleGrid>
    </VStack>
  );

  const facultyTable = data.facultyOutcomes.length === 0 ? <Text fontSize="sm" color={muted}>No faculty accounts yet.</Text> : (
    <Box {...tableBox}>
      <Table size="sm">
        <Thead position="sticky" top={0} bg={surface} zIndex={1}><Tr>
          <Th color={muted}>Faculty</Th><Th color={muted} isNumeric>Completed</Th><Th color={muted} isNumeric>Declined</Th><Th color={muted} isNumeric>Expired</Th>
          <Th color={muted} isNumeric>Cancelled by faculty</Th><Th color={muted} isNumeric>Missed by faculty</Th><Th color={muted} isNumeric>Student no-shows</Th>
        </Tr></Thead>
        <Tbody>
          {data.facultyOutcomes.map(f => (
            <Tr key={f.facultyId}>
              <Td><Text fontWeight="600" color={text}>{f.name}</Text>{f.programPosition && <Text fontSize="xs" color={muted}>{f.programPosition}</Text>}</Td>
              <Td isNumeric fontWeight="700" color={text}>{f.completed}</Td>
              <Td isNumeric color={text}>{f.declined}</Td>
              {countCell(f.expired, '#ca8a04')}
              {countCell(f.cancelledByFaculty, '#64748b')}{countCell(f.missedByFaculty, '#e11d48')}{countCell(f.studentNoShows, '#f08a3c')}
            </Tr>
          ))}
        </Tbody>
      </Table>
    </Box>
  );
  const studentTable = data.studentOutcomes.length === 0 ? <Text fontSize="sm" color={muted}>No student outcomes yet.</Text> : (
    <Box {...tableBox}>
      <Table size="sm">
        <Thead position="sticky" top={0} bg={surface} zIndex={1}><Tr>
          <Th color={muted}>Student</Th><Th color={muted} isNumeric>Completed</Th><Th color={muted} isNumeric>Declined</Th>
          <Th color={muted} isNumeric>Cancelled by student</Th><Th color={muted} isNumeric>No-shows</Th>
        </Tr></Thead>
        <Tbody>
          {data.studentOutcomes.map(s => (
            <Tr key={s.studentKey}>
              <Td><Text fontWeight="600" color={text}>{s.name}</Text>{s.section && <Text fontSize="xs" color={muted}>{s.section}</Text>}</Td>
              <Td isNumeric fontWeight="700" color={text}>{s.completed}</Td>
              <Td isNumeric color={text}>{s.declined}</Td>
              {countCell(s.cancelledByStudent, '#64748b')}{countCell(s.noShows, '#f08a3c')}
            </Tr>
          ))}
        </Tbody>
      </Table>
    </Box>
  );

  const a = data.appeals.summary;
  const outcomes = (
    <VStack align="stretch" spacing={6}>
      <SimpleGrid columns={{ base: 2, md: 3, lg: 5 }} spacing={4}>
        <KpiTile label="Appeal rate" value={pctText(a.appealRate)} sub="missed consultations that got an appeal" accent="#f08a3c" hint="Appeals on 'Missed (student)' ÷ all 'Missed (student)'." />
        <KpiTile label="Student appeals" value={a.total} sub="reasons given for a missed or cancelled consultation" accent="#16a34a" />
        <KpiTile label="Faculty appeals" value={a.faculty.made} sub="reasons faculty gave to the Dean" accent="#8b5cf6" />
        <KpiTile label="Missed by students" value={k.missed.student} sub="appeals never reduce this" accent="#64748b" />
      </SimpleGrid>

      <ChartCard title="Missed consultations per week" hint="Last 8 weeks.">
        <LineChart data={data.weeklyMissed} color="#f08a3c" />
      </ChartCard>

      <ChartCard title="Consultation appeals by reason" hint="Student appeals that a faculty member has reviewed. Use the dropdowns to zoom to a program, year level or section.">
        <AppealsByReason rows={data.appeals.rows} reasons={data.appeals.reasons} />
      </ChartCard>

      <ChartCard title={outcomeView === 'faculty' ? 'Faculty outcomes' : 'Student outcomes'}>
        <HStack mb={3}>
          <Select size="sm" w="160px" value={outcomeView} onChange={e => setOutcomeView(e.target.value as 'faculty' | 'student')} color={text} borderColor={border} aria-label="Outcome view">
            <option value="faculty">Faculty</option>
            <option value="student">Student</option>
          </Select>
        </HStack>
        {outcomeView === 'faculty' ? facultyTable : studentTable}
      </ChartCard>
    </VStack>
  );

  const demand = (
    <VStack align="stretch" spacing={6}>
      <SimpleGrid columns={{ base: 1, lg: 2 }} spacing={4}>
        <ChartCard title="Why students request consultations" hint={`${data.purposes.total} requests, top reasons.`}>
          <HBarChart color="#0891b2" items={data.purposes.items.map(p => ({ label: p.label, value: p.count, note: `${p.percent}%` }))} emptyText="No requests yet." />
        </ChartCard>
        <ChartCard title="Busiest days and hours" hint="Requests by weekday and hour, over the actual consultation-hour window.">
          <Heatmap data={data.heatmap} />
        </ChartCard>
      </SimpleGrid>

      <ChartCard title="Registered students by program and year level" hint="Use the dropdowns to zoom in; choose a year level to see its sections.">
        <CohortTable rows={data.cohortStudents} />
      </ChartCard>

      <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
        <ChartCard title="Student gender"><SimpleBarChart data={data.gender.students} color="#8b5cf6" height={140} /></ChartCard>
        <ChartCard title="Faculty gender" hint={`${k.activeFaculty} active faculty.`}><SimpleBarChart data={data.gender.faculty} color="#e11d48" height={140} /></ChartCard>
      </SimpleGrid>
      {[...data.gender.students, ...data.gender.faculty].some(g => g.label === 'Not provided') && (
        <Text fontSize="xs" color={muted}>Accounts showing Not provided were created before gender was collected.</Text>
      )}
    </VStack>
  );

  const health = data.accountHealth && (
    <VStack align="stretch" spacing={6}>
      <ChartCard title="Users by role" hint="Active accounts.">
        <HBarChart color="#2563eb" items={data.accountHealth.byRole.map(r => ({ label: ROLE_NAMES[r.label] || r.label, value: r.value }))} />
      </ChartCard>
      <ChartCard title="Profile completion" hint="Students without a finished profile can browse but not book. Open a row to see who.">
        <Accordion allowMultiple>
          {data.accountHealth.profile.map(p => (
            <AccordionItem key={p.role} borderColor={border} isDisabled={p.incomplete === 0}>
              <AccordionButton px={1}>
                <Flex flex="1" justify="space-between" align="center" gap={3}>
                  <Text fontWeight="600" color={text} textAlign="left">{ROLE_NAMES[p.role] || p.role}</Text>
                  <Text fontSize="sm" color={muted}>{p.complete} complete · <b style={{ color: p.incomplete ? '#f08a3c' : undefined }}>{p.incomplete} incomplete</b></Text>
                </Flex>
              </AccordionButton>
              <AccordionPanel>
                {p.incompleteList.map(u => (
                  <Flex key={u.email} justify="space-between" py={1} gap={3}>
                    <Text fontSize="sm" color={text}>{u.name}</Text><Text fontSize="xs" color={muted} noOfLines={1}>{u.email}</Text>
                  </Flex>
                ))}
              </AccordionPanel>
            </AccordionItem>
          ))}
        </Accordion>
      </ChartCard>
    </VStack>
  );

  return (
    <VStack align="stretch" spacing={4} id="printable-report">
      <Text className="print-only" fontWeight="700" fontSize="lg" color="black">CCIS Sync: Reports &amp; Analytics (generated {new Date(data.generatedAt).toLocaleString()})</Text>
      <HStack justify="space-between" className="no-print" flexWrap="wrap">
        <Text fontSize="xs" color={muted}>Updated {new Date(data.generatedAt).toLocaleTimeString()}</Text>
        <HStack spacing={2}>
          <ExportBar csvPath="/api/analytics/report.csv" fileBase="ccis-sync-report" />
          <Button size="xs" variant="outline" onClick={load} isLoading={loading}>Refresh</Button>
        </HStack>
      </HStack>
      {/* Printing shows every tab's content one after another, without the tab buttons. */}
      <Tabs variant="soft-rounded" size="sm" colorScheme="blue"
        sx={{ '@media print': { '[role=tabpanel]': { display: 'block !important' }, '[role=tablist]': { display: 'none' } } }}>
        <TabList mb={4} flexWrap="wrap" gap={1}>
          <Tab>Overview</Tab><Tab>Outcomes</Tab><Tab>Demand</Tab>{health && <Tab>Account health</Tab>}
        </TabList>
        <TabPanels>
          <TabPanel px={0}>{overview}</TabPanel>
          <TabPanel px={0}>{outcomes}</TabPanel>
          <TabPanel px={0}>{demand}</TabPanel>
          {health && <TabPanel px={0}>{health}</TabPanel>}
        </TabPanels>
      </Tabs>
      <DrilldownDrawer isOpen={drawer.isOpen} onClose={drawer.onClose} title={panel?.title || ''} data={panel?.data || null} studentLabel={panel?.studentLabel} facultyLabel={panel?.facultyLabel} />
    </VStack>
  );
}
