import { useState } from 'react';
import {
  Box, Drawer, DrawerBody, DrawerCloseButton, DrawerContent, DrawerHeader, DrawerOverlay, Flex, HStack, Select, Tab, TabList,
  TabPanel, TabPanels, Table, Tbody, Td, Text, Th, Thead, Tr, Tabs, VStack, useColorModeValue,
} from '@chakra-ui/react';

// Filterable tables for the analytics pages. Dropdowns start on "All" and zoom in:
// All years -> one row per year level; one year chosen -> one row per section.

export interface CohortRow { program: string; year: string; section: string; count: number }
export interface AppealRow { program: string; year: string; section: string; reason: string; count: number }
export interface ActorCount { name: string; count: number }
export interface Drilldown { students: ActorCount[]; faculty: ActorCount[] }

const useTheme = () => ({
  surface: useColorModeValue('#ffffff', '#111d30'),
  tint: useColorModeValue('#f1f5f9', '#0c1421'),
  border: useColorModeValue('#dde3ec', '#1e3048'),
  text: useColorModeValue('#0f2240', '#e8f0fe'),
  muted: useColorModeValue('#6b7fa0', '#7a93b0'),
});

const ordinal = (y: string) => (y === '' ? 'Unspecified' : `${y}${y === '1' ? 'st' : y === '2' ? 'nd' : y === '3' ? 'rd' : 'th'} Year`);
const byProgram = (a: string, b: string) => (a === 'Unspecified' ? 1 : b === 'Unspecified' ? -1 : a.localeCompare(b));
const byYear = (a: string, b: string) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b));

function FilterBar({ programs, years, program, year, onProgram, onYear }: {
  programs: string[]; years: string[]; program: string; year: string; onProgram: (v: string) => void; onYear: (v: string) => void;
}) {
  const t = useTheme();
  return (
    <HStack spacing={3} mb={3} wrap="wrap">
      <Select size="sm" w="170px" value={program} onChange={e => onProgram(e.target.value)} color={t.text} borderColor={t.border} aria-label="Program">
        <option value="All">All programs</option>
        {programs.map(p => <option key={p} value={p}>{p}</option>)}
      </Select>
      <Select size="sm" w="150px" value={year} onChange={e => onYear(e.target.value)} color={t.text} borderColor={t.border} aria-label="Year level">
        <option value="All">All year levels</option>
        {years.map(y => <option key={y} value={y}>{ordinal(y)}</option>)}
      </Select>
    </HStack>
  );
}

// Rows keep only the chosen program/year; the table then groups by year (all years) or section.
function useFiltered<T extends { program: string; year: string; section: string }>(rows: T[]) {
  const [program, setProgram] = useState('All');
  const [year, setYear] = useState('All');
  const kept = rows.filter(r => (program === 'All' || r.program === program) && (year === 'All' || r.year === year));
  const programs = [...new Set(rows.map(r => r.program))].sort(byProgram);
  const years = [...new Set(rows.map(r => r.year))].sort(byYear);
  const groupBySection = year !== 'All';
  const rowKeys = [...new Set(kept.map(r => (groupBySection ? r.section : r.year)))].sort(groupBySection ? (a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)) : byYear);
  const rowLabel = (k: string) => (groupBySection ? (k === '' ? 'Unspecified' : `Section ${k}`) : ordinal(k));
  const rowOf = (r: T) => (groupBySection ? r.section : r.year);
  return { program, year, setProgram, setYear, kept, programs, years, rowKeys, rowLabel, rowOf };
}

// Registered students by program (columns) and year level or section (rows).
export function CohortTable({ rows, emptyText = 'No registered students for this selection.', note = 'Counts students registered in this system (from their profiles), not official school enrollment.' }: { rows: CohortRow[]; emptyText?: string; note?: string }) {
  const t = useTheme();
  const f = useFiltered(rows);
  const cols = f.program === 'All' ? f.programs : [f.program];
  const cell = (rk: string, col: string) => f.kept.filter(r => f.rowOf(r) === rk && r.program === col).reduce((s, r) => s + r.count, 0);
  const grand = f.kept.reduce((s, r) => s + r.count, 0);
  const max = Math.max(1, ...f.rowKeys.flatMap(rk => cols.map(c => cell(rk, c))));
  return (
    <Box>
      <FilterBar programs={f.programs} years={f.years} program={f.program} year={f.year} onProgram={f.setProgram} onYear={f.setYear} />
      {f.kept.length === 0 ? <Text fontSize="sm" color={t.muted}>{emptyText}</Text> : (
        <Box overflowX="auto" borderWidth="1px" borderColor={t.border} borderRadius="md">
          <Table size="sm">
            <Thead><Tr>
              <Th color={t.muted}>{f.year === 'All' ? 'Year level' : 'Section'}</Th>
              {cols.map(c => <Th key={c} color={t.muted} isNumeric>{c}</Th>)}
              <Th color={t.muted} isNumeric>Total students</Th>
            </Tr></Thead>
            <Tbody>
              {f.rowKeys.map(rk => (
                <Tr key={rk || 'none'}>
                  <Td fontWeight="600" color={t.text}>{f.rowLabel(rk)}</Td>
                  {cols.map(c => {
                    const v = cell(rk, c);
                    return <Td key={c} isNumeric color={v ? t.text : t.muted} bg={v ? `rgba(37,99,235,${0.06 + 0.2 * (v / max)})` : undefined} fontWeight={v ? 700 : 400}>{v || '–'}</Td>;
                  })}
                  <Td isNumeric fontWeight="700" color={t.text}>{cols.reduce((s, c) => s + cell(rk, c), 0)}</Td>
                </Tr>
              ))}
              <Tr bg={t.tint}>
                <Td fontWeight="700" color={t.text}>Total</Td>
                {cols.map(c => <Td key={c} isNumeric fontWeight="700" color={t.text}>{f.rowKeys.reduce((s, rk) => s + cell(rk, c), 0)}</Td>)}
                <Td isNumeric fontWeight="800" color={t.text}>{grand}</Td>
              </Tr>
            </Tbody>
          </Table>
        </Box>
      )}
      <Text fontSize="xs" color={t.muted} mt={2}>{note}</Text>
    </Box>
  );
}

// Students' reasons for missed or cancelled consultations, by reason (columns) and year level or section (rows), plus an
// accepted/rejected split per reason so the validity of each reason is visible.
export function AppealsByReason({ rows, reasons }: { rows: AppealRow[]; reasons: string[] }) {
  const t = useTheme();
  const f = useFiltered(rows);
  const tot = (r: AppealRow) => r.count;
  const cell = (rk: string, reason: string) => f.kept.filter(r => f.rowOf(r) === rk && r.reason === reason).reduce((s, r) => s + tot(r), 0);
  const max = Math.max(1, ...f.rowKeys.flatMap(rk => reasons.map(r => cell(rk, r))));
  const perReason = reasons.map(reason => {
    const list = f.kept.filter(r => r.reason === reason);
    return { reason, count: list.reduce((s, r) => s + r.count, 0) };
  });
  const biggest = Math.max(1, ...perReason.map(p => p.count));
  return (
    <Box>
      <FilterBar programs={f.programs} years={f.years} program={f.program} year={f.year} onProgram={f.setProgram} onYear={f.setYear} />
      {f.kept.length === 0 ? <Text fontSize="sm" color={t.muted}>No reasons for this selection yet.</Text> : (
        <VStack align="stretch" spacing={5}>
          <Box>
            <Text fontSize="xs" fontWeight="700" color={t.muted} mb={2}>Reasons students gave</Text>
            {perReason.map(p => (
              <Flex key={p.reason} align="center" gap={3} mb={2}>
                <Text fontSize="sm" color={t.text} w={{ base: '120px', md: '210px' }} flexShrink={0} noOfLines={1} title={p.reason}>{p.reason}</Text>
                <Flex flex="1" bg={t.tint} borderRadius="4px" h="14px" overflow="hidden">
                  <Box bg="#2563eb" w={`${(p.count / biggest) * 100}%`} title={`${p.count} reasons`} />
                </Flex>
                <Text fontSize="xs" color={t.muted} w="60px" textAlign="right" flexShrink={0}>{p.count}</Text>
              </Flex>
            ))}
          </Box>
          <Box overflowX="auto" borderWidth="1px" borderColor={t.border} borderRadius="md">
            <Table size="sm">
              <Thead><Tr>
                <Th color={t.muted}>{f.year === 'All' ? 'Year level' : 'Section'}</Th>
                {reasons.map(r => <Th key={r} color={t.muted} isNumeric whiteSpace="normal" minW="96px">{r}</Th>)}
                <Th color={t.muted} isNumeric>Total reasons</Th>
              </Tr></Thead>
              <Tbody>
                {f.rowKeys.map(rk => (
                  <Tr key={rk || 'none'}>
                    <Td fontWeight="600" color={t.text}>{f.rowLabel(rk)}</Td>
                    {reasons.map(r => {
                      const v = cell(rk, r);
                      return <Td key={r} isNumeric color={v ? t.text : t.muted} bg={v ? `rgba(37,99,235,${0.06 + 0.2 * (v / max)})` : undefined} fontWeight={v ? 700 : 400}>{v || '–'}</Td>;
                    })}
                    <Td isNumeric fontWeight="700" color={t.text}>{reasons.reduce((s, r) => s + cell(rk, r), 0)}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </Box>
        </VStack>
      )}
      <Text fontSize="xs" color={t.muted} mt={2}>Every student reason is counted. A reason is a record only; it does not remove the miss from the totals.</Text>
    </Box>
  );
}

// Side panel opened from a tile: who is behind the number, split into students and faculty.
export function DrilldownDrawer({ isOpen, onClose, title, data, studentLabel = 'Students', facultyLabel = 'Faculty', studentsOnly = false }: {
  isOpen: boolean; onClose: () => void; title: string; data: Drilldown | null; studentLabel?: string; facultyLabel?: string; studentsOnly?: boolean;
}) {
  const t = useTheme();
  const list = (items: ActorCount[]) => items.length === 0 ? <Text fontSize="sm" color={t.muted}>Nobody yet.</Text> : (
    <VStack align="stretch" spacing={0}>
      {items.map((i, idx) => (
        <Flex key={`${i.name}-${idx}`} justify="space-between" py={2} borderBottomWidth="1px" borderColor={t.border}>
          <Text fontSize="sm" color={t.text}>{i.name}</Text>
          <Text fontSize="sm" fontWeight="700" color={t.text}>{i.count}</Text>
        </Flex>
      ))}
    </VStack>
  );
  const sum = (items: ActorCount[]) => items.reduce((s, i) => s + i.count, 0);
  return (
    <Drawer isOpen={isOpen} onClose={onClose} placement="right" size="sm">
      <DrawerOverlay />
      <DrawerContent bg={t.surface}>
        <DrawerCloseButton />
        <DrawerHeader color={t.text}>{title}</DrawerHeader>
        <DrawerBody>
          {data && studentsOnly && (
            <>
              <Text fontSize="xs" color={t.muted} mb={2}>{studentLabel}: {sum(data.students)}</Text>
              {list(data.students)}
            </>
          )}
          {data && !studentsOnly && (
            <Tabs isFitted size="sm" colorScheme="blue">
              <TabList>
                <Tab>{studentLabel} ({sum(data.students)})</Tab>
                <Tab>{facultyLabel} ({sum(data.faculty)})</Tab>
              </TabList>
              <TabPanels>
                <TabPanel px={0}>{list(data.students)}</TabPanel>
                <TabPanel px={0}>{list(data.faculty)}</TabPanel>
              </TabPanels>
            </Tabs>
          )}
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
