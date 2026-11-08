import { useEffect, useState, useMemo } from 'react';
import { formatDate, formatDateTime } from './dateUtils';
import {
  Box, Heading, Table, Thead, Tbody, Tr, Th, Td,
  Badge, Text, Button as ChakraButton, Flex, Input, useColorModeValue
} from '@chakra-ui/react';
import { authFetch } from './authFetch';
import ProfileGate from './ProfileGate';
import AppointmentDetailsDrawer from './AppointmentDetailsDrawer';
import { useDeepLink } from '../utils/useDeepLink';
import AnalyticsReport from './AnalyticsReport';
import DeanAppeals from './DeanAppeals';
import ProfilePage from './ProfilePage';
import DashboardShell from './DashboardShell';
import PageTitle from './PageTitle';
import ScrollTable from './ScrollTable';
import SearchableSelect from './SearchableSelect';
import WelcomeHeader from './WelcomeHeader';
import ExportBar from './ExportBar';
import { PAGE_PAD, useNavPalette } from '../utils/uiTokens';
import { facultyStatusColor, facultyStatusLabel } from './appointmentStatus';
import { GENDER_OPTIONS, matchesGender, GenderBadge, PersonCell, FilterField, FilterPanel } from './PeopleUi';

const PAGE_TITLES = {
  reports: 'Reports & Analytics', roster: 'Faculty Roster', records: 'Consultation Records',
  appeals: 'Faculty Reasons', profile: 'My Profile',
} as const;

// === Helper function for time formatting ===
export const formatTime = (timeStr: string) => {
  if (!timeStr) return '';
  const [hour, minute] = timeStr.split(':');
  const h = parseInt(hour, 10);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const standardHour = h % 12 || 12;
  return `${standardHour}:${minute} ${ampm}`;
};

export default function DeanDashboard() {
  const userName = localStorage.getItem('userName');

  // Unified Page State
  const [activePage, setActivePage] = useState<'roster' | 'reports' | 'records' | 'appeals' | 'profile'>('reports');
  // Executive Broadcast is hidden for now (Nov 9): its page and menu item are removed here; DeanBroadcastPanel.tsx is kept.
  // Notification links: ?page= switches page, ?apt= opens that appointment's details
  const { aptId, closeApt } = useDeepLink(['roster', 'reports', 'records', 'appeals'] as const, setActivePage);
  
  // Shared navy palette (same colours in every portal)
  const C = useNavPalette();
  const hoverBg = useColorModeValue('blue.50', 'whiteAlpha.100');

  const [facultyRoster, setFacultyRoster] = useState<any[]>([]);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [recordsSearch, setRecordsSearch] = useState('');
  const [recordsFaculty, setRecordsFaculty] = useState('');
  const [recordsCase, setRecordsCase] = useState('');
  const [recordsSort, setRecordsSort] = useState<'desc' | 'asc'>('desc'); // by date signed off
  const [rosterPosition, setRosterPosition] = useState('');
  const [rosterStatus, setRosterStatus] = useState('');
  const [rosterGender, setRosterGender] = useState('');
  const [rosterSearch, setRosterSearch] = useState('');

  const fetchData = () => {
    // Phase 1 Analytics: Pull live board data
    authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/status`)
      .then((res) => res.json())
      .then((data) => setFacultyRoster(data));
    // Reports & Analytics / Consultation Records: dean is allowed on this
    // route (STAFF = FACULTY/ADMIN/DEAN on the backend), same data Admin uses.
    authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/appointments/all`)
      .then((res) => res.json())
      .then((data) => setAppointments(Array.isArray(data) ? data : []));
  };

  useEffect(() => {
    fetchData();
    // Poll every 10 seconds so schedule-driven status changes show up promptly
    const intervalId = setInterval(fetchData, 10000);
    return () => clearInterval(intervalId);
  }, []);

  // Reports & Analytics charts now come from the backend (GET /api/analytics/report),
  // rendered by <AnalyticsReport />. Consultation Records below still uses `appointments`.

  const consultationRecords = useMemo(() => {
    return appointments
      .filter(a => a.status === 'COMPLETED')
      .sort((a, b) => new Date(b.completedAt || 0).getTime() - new Date(a.completedAt || 0).getTime());
  }, [appointments]);

  const filteredRecords = useMemo(() => {
    const q = recordsSearch.trim().toLowerCase();
    const list = consultationRecords.filter((r: any) =>
      (!q || r.studentName?.toLowerCase().includes(q) || r.facultyId?.name?.toLowerCase().includes(q) || r.reason?.toLowerCase().includes(q)) &&
      (!recordsFaculty || r.facultyId?._id === recordsFaculty) &&
      (!recordsCase || r.casePresented === recordsCase)
    );
    const time = (r: any) => new Date(r.completedAt || 0).getTime();
    return [...list].sort((a: any, b: any) => recordsSort === 'asc' ? time(a) - time(b) : time(b) - time(a));
  }, [consultationRecords, recordsSearch, recordsFaculty, recordsCase, recordsSort]);

  const filteredRoster = useMemo(() => {
    const q = rosterSearch.trim().toLowerCase();
    return facultyRoster.filter(f =>
      (!rosterPosition || f.programPosition === rosterPosition) &&
      (!rosterStatus || f.currentStatus === rosterStatus) &&
      matchesGender(f.gender, rosterGender) &&
      (!q || f.name.toLowerCase().includes(q) || (f.programPosition || '').toLowerCase().includes(q) || (f.currentLocation || f.room || '').toLowerCase().includes(q))
    );
  }, [facultyRoster, rosterPosition, rosterStatus, rosterGender, rosterSearch]);

  // Exports what the roster currently shows (so a filtered view exports as filtered).
  const handleExportCSV = () => {
    const cell = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    let csvContent = "data:text/csv;charset=utf-8,Name,Program/Position,Gender,Live Status,Location\n";
    filteredRoster.forEach(f => {
      const location = f.currentLocation || f.room || 'N/A';
      csvContent += [f.name, f.programPosition, f.gender || 'Not provided', f.currentStatus, location].map(cell).join(',') + '\n';
    });
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "ccis_faculty_status_report.csv");
    document.body.appendChild(link);
    link.click();
  };

  return (
    <>
    <DashboardShell
      portalLabel="Dean's Office"
      userName={userName || ''}
      showMailbox
      extras={<ProfileGate role="DEAN" />}
      nav={[
        { key: 'reports', section: 'Overview', icon: 'chart', label: 'Reports & Analytics', active: activePage === 'reports', onClick: () => setActivePage('reports') },
        { key: 'appeals', section: 'Oversight', icon: 'flag', label: 'Faculty Reasons', active: activePage === 'appeals', onClick: () => setActivePage('appeals') },
        { key: 'roster', section: 'Oversight', icon: 'users', label: 'Faculty Roster', active: activePage === 'roster', onClick: () => setActivePage('roster') },
        { key: 'records', section: 'Oversight', icon: 'file', label: 'Consultation Records', active: activePage === 'records', onClick: () => setActivePage('records') },
        { key: 'profile', section: 'Account', icon: 'user', label: 'My Profile', active: activePage === 'profile', onClick: () => setActivePage('profile') },
      ]}
    >
      <WelcomeHeader name={userName || ''} actions={activePage === 'reports' ? <ExportBar solid csvPath="/api/analytics/report.csv" fileBase="ccis-sync-report" /> : undefined} />
      <Box flex="1" minH={0} overflowY="auto" p={PAGE_PAD}>
        {activePage !== 'reports' && <PageTitle>{PAGE_TITLES[activePage]}</PageTitle>}

        {(activePage === 'reports' || activePage === 'records') && (
          // See AdminDashboard.tsx for the same pattern, explained: hides
          // everything except #print-area when printing/saving as PDF.
          <style>{`
            @media print {
              body * { visibility: hidden; }
              #print-area, #print-area * { visibility: visible; }
              #print-area { position: absolute; left: 0; top: 0; width: 100%; padding: 0; }
              .no-print { display: none !important; }
            }
          `}</style>
        )}

        {activePage === 'reports' && (
          <Box id="print-area">
            <Box sx={{ display: 'none', '@media print': { display: 'block' } }} mb={4}>
              <Heading size="md" color={C.text}>Reports & Analytics</Heading>
              <Text fontSize="sm" color={C.textMid}>Generated {formatDateTime(new Date())}</Text>
            </Box>

            <AnalyticsReport />
          </Box>
        )}

        {activePage === 'records' && (
          <Box id="print-area" bg={C.surface} p={6} borderRadius="lg" borderWidth="1px" borderColor={C.border} shadow="sm">
            <Flex mb={4} align="center" justify="space-between" gap={3} flexWrap="wrap" className="no-print">
              <Text color={C.textMid} fontSize="sm">Completed consultations signed off by faculty.</Text>
              <ChakraButton colorScheme="blue" size="sm" onClick={() => window.print()}>Print / Save as PDF</ChakraButton>
            </Flex>

            <FilterPanel
              shown={filteredRecords.length} total={consultationRecords.length} noun="records"
              canClear={!!(recordsFaculty || recordsCase || recordsSearch || recordsSort !== 'desc')}
              onClear={() => { setRecordsFaculty(''); setRecordsCase(''); setRecordsSearch(''); setRecordsSort('desc'); }}
            >
              <FilterField label="Faculty">
                <SearchableSelect placeholder="All faculty" value={recordsFaculty} onChange={setRecordsFaculty} maxW="100%" options={[...new Map(consultationRecords.filter(r => r.facultyId?._id).map(r => [r.facultyId._id, { value: r.facultyId._id, label: r.facultyId.name || 'Unknown' }])).values()]} />
              </FilterField>
              <FilterField label="Case presented">
                <SearchableSelect placeholder="All cases" value={recordsCase} onChange={setRecordsCase} maxW="100%" options={[...new Set(consultationRecords.map(r => r.casePresented).filter(Boolean))].sort().map(value => ({ value, label: value }))} />
              </FilterField>
              <FilterField label="Sort by date">
                <SearchableSelect placeholder="Newest first" value={recordsSort} onChange={(v) => setRecordsSort(v === 'asc' ? 'asc' : 'desc')} maxW="100%"
                  options={[{ value: 'desc', label: 'Newest first' }, { value: 'asc', label: 'Oldest first' }]} />
              </FilterField>
              <FilterField label="Search">
                <Input
                  placeholder="Student, faculty or reason..."
                  aria-label="Search consultation records"
                  value={recordsSearch}
                  onChange={(e) => setRecordsSearch(e.target.value)}
                  bg={C.surface} borderColor={C.border} color={C.text}
                />
              </FilterField>
            </FilterPanel>

            <Box sx={{ display: 'none', '@media print': { display: 'block' } }} mb={4}>
              <Heading size="md" color={C.text}>Consultation Records</Heading>
              <Text fontSize="sm" color={C.textMid}>Generated {formatDateTime(new Date())}</Text>
            </Box>

            <ScrollTable>
              <Table variant="simple" size="md">
                <Thead>
                  <Tr>
                    <Th
                      color={C.textMid} cursor="pointer" userSelect="none" whiteSpace="nowrap"
                      onClick={() => setRecordsSort(s => s === 'desc' ? 'asc' : 'desc')}
                      title="Click to change the sort order"
                    >
                      Date Signed Off {recordsSort === 'desc' ? '↓' : '↑'}
                    </Th>
                    <Th color={C.textMid}>Student</Th>
                    <Th color={C.textMid}>Faculty</Th>
                    <Th color={C.textMid}>Case Presented</Th>
                    <Th color={C.textMid}>Intervention Taken</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {filteredRecords.length === 0 && (
                    <Tr><Td colSpan={5}><Text color={C.textMid} py={6} textAlign="center">No completed consultations found.</Text></Td></Tr>
                  )}
                  {filteredRecords.map((r: any) => (
                    <Tr key={r._id} _hover={{ bg: hoverBg }}>
                      <Td color={C.text} whiteSpace="nowrap">{r.completedAt ? formatDate(r.completedAt) : ''}</Td>
                      <Td color={C.text}><PersonCell name={r.studentName || 'Unknown'} sub={r.studentSection} /></Td>
                      <Td color={C.text}>{r.facultyId?.name || 'Unknown'}</Td>
                      <Td maxW="220px" color={C.text} whiteSpace="normal">{r.casePresented ? <Badge colorScheme="orange" variant="subtle" whiteSpace="normal" borderRadius="md" px={2}>{r.casePresented}</Badge> : '—'}</Td>
                      <Td maxW="260px" color={C.text} whiteSpace="normal">{r.interventionTaken}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </ScrollTable>
          </Box>
        )}

        {activePage === 'roster' && (
          <Box bg={C.surface} p={6} borderRadius="lg" borderWidth="1px" borderColor={C.border} shadow="sm">
            <Flex mb={4} align="center" justify="space-between" gap={3} flexWrap="wrap">
              <Text color={C.textMid} fontSize="sm">Live status of every faculty member.</Text>
              <ChakraButton colorScheme="blue" size="sm" onClick={handleExportCSV}>Export CSV Report</ChakraButton>
            </Flex>

            <FilterPanel
              shown={filteredRoster.length} total={facultyRoster.length} noun="faculty"
              canClear={!!(rosterGender || rosterPosition || rosterStatus || rosterSearch)}
              onClear={() => { setRosterGender(''); setRosterPosition(''); setRosterStatus(''); setRosterSearch(''); }}
            >
              <FilterField label="Gender">
                <SearchableSelect placeholder="All genders" value={rosterGender} onChange={setRosterGender} maxW="100%" options={GENDER_OPTIONS} />
              </FilterField>
              <FilterField label="Position">
                <SearchableSelect placeholder="All positions" value={rosterPosition} onChange={setRosterPosition} maxW="100%" options={[...new Set(facultyRoster.map(f => f.programPosition).filter(Boolean))].sort().map(position => ({ value: position, label: position }))} />
              </FilterField>
              <FilterField label="Live status">
                <SearchableSelect placeholder="All live statuses" value={rosterStatus} onChange={setRosterStatus} maxW="100%" options={[...new Set(facultyRoster.map(f => f.currentStatus).filter(Boolean))].sort().map(status => ({ value: status, label: facultyStatusLabel(status) }))} />
              </FilterField>
              <FilterField label="Search">
                <Input
                  placeholder="Name, position or location..."
                  aria-label="Search faculty roster"
                  value={rosterSearch}
                  onChange={(e) => setRosterSearch(e.target.value)}
                  bg={C.surface} borderColor={C.border} color={C.text}
                />
              </FilterField>
            </FilterPanel>

            <ScrollTable>
              <Table variant="simple" size="md">
                <Thead><Tr><Th color={C.textMid}>Name</Th><Th color={C.textMid}>Position</Th><Th color={C.textMid}>Gender</Th><Th color={C.textMid}>Live Status</Th><Th color={C.textMid}>Location</Th></Tr></Thead>
                <Tbody>
                  {filteredRoster.length === 0 && (
                    <Tr><Td colSpan={5}><Text color={C.textMid} py={6} textAlign="center">No faculty match these filters.</Text></Td></Tr>
                  )}
                  {filteredRoster.map((prof) => (
                    <Tr key={prof._id} _hover={{ bg: hoverBg }}>
                      <Td color={C.text}><PersonCell name={prof.name} /></Td>
                      <Td color={C.text}>{prof.programPosition}</Td>
                      <Td><GenderBadge gender={prof.gender} /></Td>
                      <Td>
                        <Badge colorScheme={facultyStatusColor(prof.currentStatus)} borderRadius="full" px={2}>
                          {facultyStatusLabel(prof.currentStatus)}
                        </Badge>
                      </Td>
                      <Td color={C.text}>{prof.currentLocation || prof.room || 'N/A'}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </ScrollTable>
          </Box>
        )}

        {activePage === 'profile' && <ProfilePage />}

        {activePage === 'appeals' && <DeanAppeals />}

      </Box>
    </DashboardShell>
    <AppointmentDetailsDrawer aptId={aptId} onClose={closeApt} />
    </>
  );
}
