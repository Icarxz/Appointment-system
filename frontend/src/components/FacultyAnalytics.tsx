import { useEffect, useState } from 'react';
import { Box, Heading, HStack, SimpleGrid, Spinner, Text, VStack, useDisclosure } from '@chakra-ui/react';
import { authFetch } from './authFetch';
import ExportBar from './ExportBar';
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

const trend = (w: Window) => `last 4 weeks: ${w.last4} (before that: ${w.prev4})`;
const pctText = (n: number | null) => (n === null ? '—' : `${n}%`);

// A faculty member's own analytics. The server only ever returns the logged-in faculty's data.
export default function FacultyAnalytics() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [panel, setPanel] = useState<{ title: string; data: Drilldown; split?: [string, string] } | null>(null);
  const drawer = useDisclosure();
  const text = useColorModeValue('#0f2240', '#e8f0fe');
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
      <HStack justify="space-between" flexWrap="wrap">
        <Heading size="md" color={text}>My Analytics</Heading>
        <ExportBar csvPath="/api/analytics/me.csv" fileBase="my-analytics" />
      </HStack>
      <Text className="print-only" fontSize="sm" color="black">Generated {new Date(data.generatedAt).toLocaleString()}</Text>

      <SimpleGrid columns={{ base: 2, md: 3 }} spacing={4}>
        <KpiTile label="Requests" value={k.requests.total} sub={trend(k.requests)} accent="#2563eb" hint="Requests you reviewed or that happened. Requests still waiting for your answer are not counted."
          onClick={() => open('Requests', data.drilldown.requests)} />
        <KpiTile label="Completed" value={k.completed.total} sub={trend(k.completed)} accent="#16a34a" onClick={() => open('Completed consultations', data.drilldown.completed)} />
        <KpiTile label="Missed" value={k.missed.total} sub={`${k.missed.student} by students · ${k.missed.faculty} by faculty · ${pctText(k.missedRate)} of finished`} accent="#f08a3c"
          hint="Missed rate = missed ÷ (completed + missed). Appeals do not reduce this number." onClick={() => open('Missed consultations', data.drilldown.missed, ['Missed by students', 'Missed by me'])} />
        <KpiTile label="Cancelled" value={k.cancelled.student + k.cancelled.faculty} sub={`${k.cancelled.student} by students · ${k.cancelled.faculty} by faculty`} accent="#64748b"
          onClick={() => open('Cancelled consultations', data.drilldown.cancelled, ['Cancelled by students', 'Cancelled by me'])} />
        <KpiTile label="Completion rate" value={pctText(k.completionRate)} sub="completed ÷ (completed + missed)" accent="#8b5cf6" hint="Of the consultations that were supposed to happen, how many were completed." />
        <KpiTile label="Approved" value={k.approved.total} sub={`${trend(k.approved)} · ${o.declined} declined · ${o.expired} expired`} accent="#0891b2" hint="Requests you approved. Approval rate = approved ÷ (approved + declined). Requests that expired unanswered are shown separately and do not lower it."
          onClick={() => open('Approved requests', data.drilldown.approved)} />
      </SimpleGrid>

      <SimpleGrid columns={{ base: 1, lg: 3 }} spacing={4}>
        <ChartCard title="What happened to requests" hint="Finished and cancelled requests.">
          <PieChart segments={[
            { label: 'Completed', value: o.completed, color: '#16a34a' },
            { label: 'Missed by students', value: o.studentNoShows, color: '#f08a3c' },
            { label: 'Cancelled by students', value: o.cancelledByStudent, color: '#94a3b8' },
            { label: 'Missed by me', value: o.missedByFaculty, color: '#e11d48' },
            { label: 'Cancelled by me', value: o.cancelledByFaculty, color: '#64748b' },
            { label: 'Expired (no response)', value: o.expired, color: '#ca8a04' },
          ]} />
        </ChartCard>
        <Box gridColumn={{ lg: 'span 2' }}>
          <ChartCard title="Why students come" hint={`${s.purposes.total} requests, top reasons.`}>
            <HBarChart color="#0891b2" items={s.purposes.items.map(p => ({ label: p.label, value: p.count, note: `${p.percent}%` }))} emptyText="No requests yet." />
          </ChartCard>
        </Box>
      </SimpleGrid>

      <ChartCard title="Appeals from my students, by reason" hint="Reasons your students gave. Appeals do not remove a no-show from your totals.">
        <AppealsByReason rows={appeals.rows} reasons={appeals.reasons} />
        <Text fontSize="xs" color={muted} mt={2}>
          Appeal rate {pctText(appeals.summary.appealRate)} · student appeals: {appeals.summary.total} · my own appeals to the Dean: {appeals.summary.faculty.made}
        </Text>
      </ChartCard>

      <ChartCard title="Students by year level and program" hint="Different students who asked you for a consultation.">
        <CohortTable rows={s.cohorts} emptyText="No students yet." note="Counts each student once, even if they requested several times. Pending requests are not counted." />
      </ChartCard>
      <DrilldownDrawer isOpen={drawer.isOpen} onClose={drawer.onClose} title={panel?.title || ''} data={panel?.data || null} studentLabel={panel?.split?.[0] || "Students"} facultyLabel={panel?.split?.[1]} studentsOnly={!panel?.split} />
    </VStack>
  );
}
