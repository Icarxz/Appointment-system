import { useEffect, useState } from 'react';
import { Grid, SimpleGrid, Spinner, Text, VStack, useDisclosure } from '@chakra-ui/react';
import { authFetch } from './authFetch';
import { CheckCircleIcon, CheckIcon, CloseIcon, TimeIcon, WarningIcon } from '@chakra-ui/icons';
import { ChartCard, HBarChart, KpiTile, PieChart } from './AnalyticsCharts';
import type { HeatmapData, LV } from './AnalyticsCharts';
import { AppealsByReason, CohortTable, DrilldownDrawer } from './AnalyticsTables';
import type { AppealRow, CohortRow, Drilldown } from './AnalyticsTables';
import { useColorModeValue } from '@chakra-ui/react';

interface Window { total: number; last4: number; prev4: number }
interface Data {
  generatedAt: string;
  kpis: { requests: Window; completed: Window; approved: Window & { declined: number; expired: number }; missed: Window & { student: number; faculty: number }; cancelled: { student: number; faculty: number }; completionRate: number | null; missedRate: number | null };
  drilldown: { requests: Drilldown; completed: Drilldown; approved: Drilldown; missed: Drilldown; cancelled: Drilldown };
  outcomes: {
    requests: number; completed: number; upcoming: number; declined: number; expired: number; studentNoShows: number; missedByFaculty: number;
    cancelledByStudent: number; cancelledByFaculty: number; completionRate: number | null; missedRate: number | null; approvalRate: number | null;
  };
  weekly: LV[];
  monthly: LV[];
  heatmap: HeatmapData;
  appeals: { summary: { appealRate: number | null; total: number; faculty: { made: number } }; rows: AppealRow[]; reasons: string[] };
  students: { uniqueStudents: number; cohorts: CohortRow[]; purposes: { total: number; items: { label: string; count: number; percent: number }[] } };
}

const trend = (w: Window) => `${w.last4} in last 4 wks · ${w.prev4} before`;
const pctText = (n: number | null) => (n === null ? '—' : `${n}%`);

const OUTCOME_COLORS = {
  completed: '#16A34A',       // green
  missedStudent: '#F97316',   // orange
  cancelledStudent: '#0D9488',// teal
  missedFaculty: '#E11D48',   // rose
  cancelledFaculty: '#64748B',// slate
  expired: '#7C3AED',         // violet
} as const;

// A faculty member's own analytics. The server only ever returns the logged-in faculty's data.
export default function FacultyAnalytics() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [panel, setPanel] = useState<{ title: string; data: Drilldown; split?: [string, string] } | null>(null);
  const drawer = useDisclosure();
  const muted = useColorModeValue('#6b7fa0', '#7a93b0');

  useEffect(() => {
    authFetch(`${import.meta.env.VITE_API_URL}/api/analytics/me`)
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; })
      .then(setData)
      .catch((e: any) => setError(e.message || 'Could not load your analytics.'));
  }, []);

  if (error) return <Text color="red.500">{error}</Text>;
  if (!data) return <Spinner />;
  const { outcomes: o, students: s, appeals, kpis: k } = data;
  const open = (title: string, d: Drilldown, split?: [string, string]) => { setPanel({ title, data: d, split }); drawer.onOpen(); };

  return (
    <VStack align="stretch" spacing={6} id="printable-report">
      {/* No page title and no export buttons here: the buttons live in the Welcome bar (FacultyDashboard). */}
      <Text className="print-only" fontSize="sm" color="black">Generated {new Date(data.generatedAt).toLocaleString()}</Text>

      {/* Wide screens: the tiles are a column on the left and the charts fill the rest, so tiles and charts share one
          screen. Narrower: the tiles are a grid above the charts. Completion rate is always the last tile. */}
      <Grid templateColumns={{ base: '1fr', xl: '230px minmax(0, 1fr)' }} gap={4} alignItems="start">
      <SimpleGrid columns={{ base: 2, md: 3, xl: 1 }} spacing={3}>
        <KpiTile dense label="Requests" icon={<CheckCircleIcon />} value={k.requests.total} sub={trend(k.requests)} accent="#2563eb" hint="Requests you reviewed or that happened. Requests still waiting for your answer are not counted."
          onClick={() => open('Requests', data.drilldown.requests)} />
        <KpiTile dense label="Completed" icon={<CheckCircleIcon />} value={k.completed.total} sub={trend(k.completed)} accent="#16a34a" onClick={() => open('Completed consultations', data.drilldown.completed)} />
        <KpiTile dense label="Missed" icon={<WarningIcon />} value={k.missed.total} sub={`${k.missed.student} students · ${k.missed.faculty} faculty · ${pctText(k.missedRate)} missed rate`} accent={OUTCOME_COLORS.missedStudent}
          hint="Missed rate = missed ÷ (completed + missed). Reasons given do not reduce this number." onClick={() => open('Missed consultations', data.drilldown.missed, ['Missed by students', 'Missed by me'])} />
        <KpiTile dense label="Cancelled" icon={<CloseIcon boxSize={3} />} value={k.cancelled.student + k.cancelled.faculty} sub={`${k.cancelled.student} students · ${k.cancelled.faculty} faculty`} accent="#64748b"
          onClick={() => open('Cancelled consultations', data.drilldown.cancelled, ['Cancelled by students', 'Cancelled by me'])} />
        <KpiTile dense label="Approved" icon={<CheckIcon />} value={k.approved.total} sub={`${k.approved.last4} in last 4 wks · ${o.declined} declined`} accent="#0891b2" hint="Requests you approved. Approval rate = approved ÷ (approved + declined). Requests that expired unanswered are shown separately and do not lower it."
          onClick={() => open('Approved requests', data.drilldown.approved)} />
        <KpiTile dense label="Completion rate" icon={<TimeIcon />} value={pctText(k.completionRate)} sub="completed ÷ finished" accent="#8b5cf6" hint="Of the consultations that were supposed to happen, how many were completed." />
      </SimpleGrid>

      <VStack align="stretch" spacing={4} minW={0}>
      <SimpleGrid columns={{ base: 1, lg: 2 }} spacing={4} alignItems="stretch">
        <ChartCard title="What happened to requests" hint="Finished and cancelled requests.">
          <PieChart segments={[
            { label: 'Completed', value: o.completed, color: OUTCOME_COLORS.completed },
            { label: 'Missed by students', value: o.studentNoShows, color: OUTCOME_COLORS.missedStudent },
            { label: 'Cancelled by students', value: o.cancelledByStudent, color: OUTCOME_COLORS.cancelledStudent },
            { label: 'Missed by me', value: o.missedByFaculty, color: OUTCOME_COLORS.missedFaculty },
            { label: 'Cancelled by me', value: o.cancelledByFaculty, color: OUTCOME_COLORS.cancelledFaculty },
            { label: 'Expired (no response)', value: o.expired, color: OUTCOME_COLORS.expired },
          ]} />
        </ChartCard>
        <ChartCard title="Students by year level and program" hint="Different students who asked you for a consultation.">
          <CohortTable rows={s.cohorts} emptyText="No students yet." note="Counts each student once, even if they requested several times. Pending requests are not counted." />
        </ChartCard>
      </SimpleGrid>

      <ChartCard title="Why students come" hint={`${s.purposes.total} requests, top reasons.`}>
        <HBarChart color="#0891b2" items={s.purposes.items.map(p => ({ label: p.label, value: p.count, note: `${p.percent}%` }))} emptyText="No requests yet." />
      </ChartCard>

      <ChartCard title="Reasons from my students" hint="Reasons your students gave for missed or cancelled consultations. They do not remove a no-show from your totals.">
        <AppealsByReason rows={appeals.rows} reasons={appeals.reasons} />
        <Text fontSize="xs" color={muted} mt={2}>
          Reason rate {pctText(appeals.summary.appealRate)} · student reasons: {appeals.summary.total} · my own reasons to the Dean: {appeals.summary.faculty.made}
        </Text>
      </ChartCard>

      </VStack>
      </Grid>
      <DrilldownDrawer isOpen={drawer.isOpen} onClose={drawer.onClose} title={panel?.title || ''} data={panel?.data || null} studentLabel={panel?.split?.[0] || "Students"} facultyLabel={panel?.split?.[1]} studentsOnly={!panel?.split} />
    </VStack>
  );
}
