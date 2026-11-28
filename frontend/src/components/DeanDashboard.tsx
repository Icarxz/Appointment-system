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
import ProfilePage from './ProfilePage';
import DashboardShell from './DashboardShell';
import DeanConsultationSettings from './DeanConsultationSettings';
import FacultyDashboard from './FacultyDashboard';
import PageTitle from './PageTitle';
import ScrollTable from './ScrollTable';
import { PROGRAM_OPTIONS, facultyProgram } from '../utils/programs';
import SearchableSelect from './SearchableSelect';
import WelcomeHeader from './WelcomeHeader';
import ExportBar from './ExportBar';
import { PAGE_PAD, useNavPalette } from '../utils/uiTokens';
import { facultyStatusColor, facultyStatusLabel, facultyStatusOf, facultyStatusUntil } from './appointmentStatus';
import HistoryPage from './HistoryPage';
import { usePersistentPage } from '../utils/usePersistentPage';
import { GENDER_OPTIONS, matchesGender, GenderBadge, PersonCell, FilterField, FilterPanel } from './PeopleUi';

const PAGE_TITLES = {
  reports: 'Reports & Analytics', roster: 'Faculty Roster', records: 'Consultation Records',
  requests: 'Requests', settings: 'Consultation Settings', analytics: 'My Analytics', profile: 'My Profile',
  schedule: 'Master Schedule', log: 'My Consultation Log', hours: 'Consultation Hours', status: 'Status & Notices',
  history: 'History',
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

type DeanPage = 'roster' | 'reports' | 'records' | 'requests' | 'settings' | 'analytics' | 'profile' | 'schedule' | 'log' | 'hours' | 'status' | 'history';
// These pages are the faculty pages, shown inside the Dean's portal (FacultyDashboard in embedded mode).
const CONSULTATION_PAGES: DeanPage[] = ['schedule', 'requests', 'log', 'hours', 'status', 'analytics'];

export default function DeanDashboard() {
  const userName = localStorage.getItem('userName');
  const credentialReviewRequired = localStorage.getItem('credentialConfirmationRequired') === 'true';

  // Unified Page State
  const deanPages = ['roster', 'reports', 'records', 'requests', 'settings', 'analytics', 'profile', 'schedule', 'log', 'hours', 'status', 'history'] as const;
  const [activePage, setActivePage] = usePersistentPage<DeanPage>(
    'dean-dashboard-page', deanPages, credentialReviewRequired ? 'profile' : 'reports',
    credentialReviewRequired ? 'profile' : undefined,
  );
  // Executive Broadcast is hidden for now (Nov 9): its page and menu item are removed here; DeanBroadcastPanel.tsx is kept.
  // Notification links: ?page= switches page, ?apt= opens that appointment's details
  const { aptId, closeApt } = useDeepLink(credentialReviewRequired ? ['profile'] as const : deanPages, setActivePage);
  useEffect(() => { if (credentialReviewRequired) closeApt(); }, [credentialReviewRequired, closeApt]);
  
  // Shared navy palette (same colours in every portal)
  const C = useNavPalette();
  const hoverBg = useColorModeValue('blue.50', 'whiteAlpha.100');

  // The Dean's own consultations (off until he switches them on in Consultation Settings).
  const userId = localStorage.getItem('userId') || '';
  const [accepts, setAccepts] = useState(false);
  useEffect(() => {
    authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/dean/consultation-settings`)
      .then((r) => r.json())
      .then((d) => setAccepts(!!d.acceptsConsultations))
      .catch(() => {});
  }, []);

  const [facultyRoster, setFacultyRoster] = useState<any[]>([]);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [recordsSearch, setRecordsSearch] = useState('');
  const [recordsFaculty, setRecordsFaculty] = useState('');
  const [recordsCase, setRecordsCase] = useState('');
  const [recordsSort, setRecordsSort] = useState<'desc' | 'asc'>('desc'); // by date signed off
  const [rosterPosition, setRosterPosition] = useState('');
  const [rosterProgram, setRosterProgram] = useState('');
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

  // Requests waiting for the Dean's own answer (for the menu badge). `appointments` already holds every appointment.
  const pendingCount = useMemo(
    () => appointments.filter((a: any) => a.status === 'PENDING' && String(a.facultyId?._id || a.facultyId) === userId).length,
    [appointments, userId]
  );

  const filteredRoster = useMemo(() => {
    const q = rosterSearch.trim().toLowerCase();
    return facultyRoster.filter(f =>
      f.role !== 'DEAN' && // the Dean appears in the faculty list for students once he takes consultations, but this is the faculty roster
      (!rosterPosition || f.programPosition === rosterPosition) &&
      (!rosterProgram || facultyProgram(f) === rosterProgram) &&
      (!rosterStatus || facultyStatusOf(f) === rosterStatus) &&
      matchesGender(f.gender, rosterGender) &&
      (!q || f.name.toLowerCase().includes(q) || (f.programPosition || '').toLowerCase().includes(q) || (f.currentLocation || f.room || '').toLowerCase().includes(q))
    );
  }, [facultyRoster, rosterPosition, rosterProgram, rosterStatus, rosterGender, rosterSearch]);

  // Exports what the roster currently shows (so a filtered view exports as filtered).
  const handleExportCSV = () => {
    const cell = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    let csvContent = "data:text/csv;charset=utf-8,Name,Program/Position,Gender,Status,Location\n";
    filteredRoster.forEach(f => {
      const location = f.currentLocation || f.room || 'N/A';
      csvContent += [f.name, f.programPosition, f.gender || 'Not provided', facultyStatusOf(f), location].map(cell).join(',') + '\n';
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
      showMailbox={!credentialReviewRequired}
      profileRequired={credentialReviewRequired}
      extras={<ProfileGate role="DEAN" />}
      nav={[
        { key: 'reports', section: 'Overview', icon: 'chart', label: 'Reports & Analytics', active: activePage === 'reports', onClick: () => setActivePage('reports') },
        { key: 'roster', section: 'Oversight', icon: 'users', label: 'Faculty Roster', active: activePage === 'roster', onClick: () => setActivePage('roster') },
        { key: 'records', section: 'Oversight', icon: 'file', label: 'Consultation Records', active: activePage === 'records', onClick: () => setActivePage('records') },
        // My Consultations: Settings is always there (it is where he switches this on); the rest appears once it is on.
        { key: 'settings', section: 'My Consultations', icon: 'grid', label: 'Consultation Settings', active: activePage === 'settings', onClick: () => setActivePage('settings') },
        ...(accepts ? [
          { key: 'schedule', section: 'My Consultations', icon: 'calendar' as const, label: 'Master Schedule', active: activePage === 'schedule', onClick: () => setActivePage('schedule') },
          { key: 'requests', section: 'My Consultations', icon: 'inbox' as const, label: 'Requests', badge: pendingCount, active: activePage === 'requests', onClick: () => setActivePage('requests') },
          { key: 'log', section: 'My Consultations', icon: 'clipboard' as const, label: 'My Consultation Log', active: activePage === 'log', onClick: () => setActivePage('log') },
          { key: 'hours', section: 'My Consultations', icon: 'clock' as const, label: 'Consultation Hours', active: activePage === 'hours', onClick: () => setActivePage('hours') },
          { key: 'status', section: 'My Consultations', icon: 'activity' as const, label: 'Status & Notices', active: activePage === 'status', onClick: () => setActivePage('status') },
          { key: 'analytics', section: 'Insights', icon: 'chart' as const, label: 'My Analytics', active: activePage === 'analytics', onClick: () => setActivePage('analytics') },
        ] : []),
        { key: 'history', section: 'Account', icon: 'file', label: 'History', active: activePage === 'history', onClick: () => setActivePage('history') },
        { key: 'profile', section: 'Account', icon: 'user', label: 'My Profile', active: activePage === 'profile', onClick: () => setActivePage('profile') },
      ]}
    >
      <WelcomeHeader name={userName || ''} actions={activePage === 'reports' ? <ExportBar solid csvPath="/api/analytics/report.csv" fileBase="ccis-sync-report" /> : activePage === 'analytics' && accepts ? <ExportBar solid csvPath="/api/analytics/me.csv" fileBase="my-analytics" /> : undefined} />
      {CONSULTATION_PAGES.includes(activePage) && accepts ? (
        <FacultyDashboard key={activePage} embeddedPage={activePage as any} role="DEAN" />
      ) : (
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
              <Text color={C.textMid} fontSize="sm">Saved consultations of faculty.</Text>
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
              <FilterField label="Sort by day">
                <SearchableSelect placeholder="Newest day first" searchable={false} clearable={false} value={recordsSort} onChange={(v) => setRecordsSort(v === 'asc' ? 'asc' : 'desc')} maxW="100%"
                  options={[{ value: 'desc', label: 'Newest day first' }, { value: 'asc', label: 'Oldest day first' }]} />
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
              <Text color={C.textMid} fontSize="sm">Current status of every faculty member.</Text>
              <ChakraButton colorScheme="blue" size="sm" onClick={handleExportCSV}>Export CSV Report</ChakraButton>
            </Flex>

            <FilterPanel
              shown={filteredRoster.length} total={facultyRoster.length} noun="faculty"
              canClear={!!(rosterGender || rosterPosition || rosterProgram || rosterStatus || rosterSearch)}
              onClear={() => { setRosterGender(''); setRosterPosition(''); setRosterProgram(''); setRosterStatus(''); setRosterSearch(''); }}
            >
              <FilterField label="Gender">
                <SearchableSelect placeholder="All genders" value={rosterGender} onChange={setRosterGender} maxW="100%" options={GENDER_OPTIONS} />
              </FilterField>
              <FilterField label="Position">
                <SearchableSelect placeholder="All positions" value={rosterPosition} onChange={setRosterPosition} maxW="100%" options={[...new Set(facultyRoster.map(f => f.programPosition).filter(Boolean))].sort().map(position => ({ value: position, label: position }))} />
              </FilterField>
              <FilterField label="Program">
                <SearchableSelect placeholder="All programs" value={rosterProgram} onChange={setRosterProgram} maxW="100%" searchable={false} options={PROGRAM_OPTIONS} />
              </FilterField>
              <FilterField label="Status">
                <SearchableSelect placeholder="All statuses" value={rosterStatus} onChange={setRosterStatus} maxW="100%" options={[...new Set(facultyRoster.map(f => facultyStatusOf(f)).filter(Boolean))].sort().map(status => ({ value: status, label: facultyStatusLabel(status) }))} />
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
                <Thead><Tr><Th color={C.textMid}>Name</Th><Th color={C.textMid}>Position</Th><Th color={C.textMid}>Gender</Th><Th color={C.textMid}>Status</Th><Th color={C.textMid}>Location</Th></Tr></Thead>
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
                        <Badge colorScheme={facultyStatusColor(facultyStatusOf(prof))} borderRadius="full" px={2}>
                          {facultyStatusLabel(facultyStatusOf(prof))}
                        </Badge>
                        {facultyStatusUntil(prof) && <Text fontSize="xs" color={C.textMid}>{facultyStatusUntil(prof)}</Text>}
                      </Td>
                      <Td color={C.text}>{prof.currentLocation || prof.room || 'N/A'}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </ScrollTable>
          </Box>
        )}

        {activePage === 'settings' && <DeanConsultationSettings onChanged={(st) => setAccepts(st.acceptsConsultations)} />}

        {CONSULTATION_PAGES.includes(activePage) && !accepts && (
          <Text color={C.textMid}>Turn on student consultation requests in Consultation Settings to use this page.</Text>
        )}

        {activePage === 'profile' && <ProfilePage />}
        {activePage === 'history' && <HistoryPage showScheduleAccount />}

      </Box>
      )}
    </DashboardShell>
    <AppointmentDetailsDrawer aptId={credentialReviewRequired ? null : aptId} onClose={closeApt} />
    </>
  );
}
