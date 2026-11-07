import { useEffect, useState, useMemo } from 'react';
import { formatDate, formatDateTime } from './dateUtils';
import {
  Box, Heading, Table, Thead, Tbody, Tr, Th, Td,
  Badge, Text, Button as ChakraButton, HStack, Input
} from '@chakra-ui/react';
import { authFetch } from './authFetch';
import ProfileGate from './ProfileGate';
import AppointmentDetailsDrawer from './AppointmentDetailsDrawer';
import { useDeepLink } from '../utils/useDeepLink';
import AnalyticsReport from './AnalyticsReport';
import DeanBroadcastPanel from './DeanBroadcastPanel';
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

const PAGE_TITLES = {
  reports: 'Reports & Analytics', roster: 'Faculty Roster', records: 'Consultation Records',
  appeals: 'Faculty Appeals', broadcast: 'Executive Broadcast', profile: 'My Profile',
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
  const [activePage, setActivePage] = useState<'broadcast' | 'roster' | 'reports' | 'records' | 'appeals' | 'profile'>('reports');
  // Notification links: ?page= switches page, ?apt= opens that appointment's details
  const { aptId, closeApt } = useDeepLink(['broadcast', 'roster', 'reports', 'records', 'appeals'] as const, setActivePage);
  
  // Shared navy palette (same colours in every portal)
  const C = useNavPalette();

  const [facultyRoster, setFacultyRoster] = useState<any[]>([]);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [recordsSearch, setRecordsSearch] = useState('');
  const [recordsFaculty, setRecordsFaculty] = useState('');
  const [recordsCase, setRecordsCase] = useState('');
  const [rosterPosition, setRosterPosition] = useState('');
  const [rosterStatus, setRosterStatus] = useState('');

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

  const handleExportCSV = () => {
    // Generate simple CSV payload
    let csvContent = "data:text/csv;charset=utf-8,Name,Program/Position,Live Status,Location\n";
    facultyRoster.forEach(f => {
      const location = f.currentLocation || f.room || 'N/A';
      csvContent += `${f.name},${f.programPosition},${f.currentStatus},${location}\n`;
    });
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "ccis_faculty_status_report.csv");
    document.body.appendChild(link);
    link.click();
  };

  // Reports & Analytics charts now come from the backend (GET /api/analytics/report),
  // rendered by <AnalyticsReport />. Consultation Records below still uses `appointments`.

  const consultationRecords = useMemo(() => {
    return appointments
      .filter(a => a.status === 'COMPLETED')
      .sort((a, b) => new Date(b.completedAt || 0).getTime() - new Date(a.completedAt || 0).getTime());
  }, [appointments]);

  const filteredRecords = useMemo(() => {
    const q = recordsSearch.trim().toLowerCase();
    return consultationRecords.filter((r: any) =>
      (!q || r.studentName?.toLowerCase().includes(q) || r.facultyId?.name?.toLowerCase().includes(q) || r.reason?.toLowerCase().includes(q)) &&
      (!recordsFaculty || r.facultyId?._id === recordsFaculty) &&
      (!recordsCase || r.casePresented === recordsCase)
    );
  }, [consultationRecords, recordsSearch, recordsFaculty, recordsCase]);

  const filteredRoster = useMemo(() => facultyRoster.filter(f =>
    (!rosterPosition || f.programPosition === rosterPosition) &&
    (!rosterStatus || f.currentStatus === rosterStatus)
  ), [facultyRoster, rosterPosition, rosterStatus]);

  return (
    <>
    <DashboardShell
      portalLabel="Dean's Office"
      userName={userName || ''}
      showMailbox
      extras={<ProfileGate role="DEAN" />}
      nav={[
        { key: 'reports', section: 'Overview', icon: 'chart', label: 'Reports & Analytics', active: activePage === 'reports', onClick: () => setActivePage('reports') },
        { key: 'appeals', section: 'Oversight', icon: 'flag', label: 'Faculty Appeals', active: activePage === 'appeals', onClick: () => setActivePage('appeals') },
        { key: 'roster', section: 'Oversight', icon: 'users', label: 'Faculty Roster', active: activePage === 'roster', onClick: () => setActivePage('roster') },
        { key: 'records', section: 'Oversight', icon: 'file', label: 'Consultation Records', active: activePage === 'records', onClick: () => setActivePage('records') },
        { key: 'broadcast', section: 'Communicate', icon: 'megaphone', label: 'Executive Broadcast', active: activePage === 'broadcast', onClick: () => setActivePage('broadcast') },
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
            <HStack justifyContent="space-between" spacing={0} gap={3} flexWrap="wrap" mb={4} className="no-print">
              <HStack spacing={2} flexWrap="wrap">
                <SearchableSelect placeholder="All faculty" value={recordsFaculty} onChange={setRecordsFaculty} maxW="190px" options={[...new Map(consultationRecords.filter(r => r.facultyId?._id).map(r => [r.facultyId._id, { value: r.facultyId._id, label: r.facultyId.name || 'Unknown' }])).values()]} />
                <SearchableSelect placeholder="All cases" value={recordsCase} onChange={setRecordsCase} maxW="190px" options={[...new Set(consultationRecords.map(r => r.casePresented).filter(Boolean))].sort().map(value => ({ value, label: value }))} />
              </HStack>
              <Input
                placeholder="Search by student, faculty, or reason..."
                aria-label="Search consultation records"
                value={recordsSearch}
                onChange={(e) => setRecordsSearch(e.target.value)}
                w="100%" maxW="320px"
              />
              <ChakraButton colorScheme="blue" onClick={() => window.print()}>Print / Save as PDF</ChakraButton>
            </HStack>
            <Box sx={{ display: 'none', '@media print': { display: 'block' } }} mb={4}>
              <Heading size="md" color={C.text}>Consultation Records</Heading>
              <Text fontSize="sm" color={C.textMid}>Generated {formatDateTime(new Date())}</Text>
            </Box>

            <ScrollTable>
              <Table variant="simple" size="sm">
                <Thead>
                  <Tr>
                    <Th color={C.textMid}>Date Signed Off</Th>
                    <Th color={C.textMid}>Student</Th>
                    <Th color={C.textMid}>Faculty</Th>
                    <Th color={C.textMid}>Case Presented</Th>
                    <Th color={C.textMid}>Intervention Taken</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {filteredRecords.length === 0 && (
                    <Tr><Td colSpan={5}><Text color={C.textMid} py={4} textAlign="center">No completed consultations found.</Text></Td></Tr>
                  )}
                  {filteredRecords.map((r: any) => (
                    <Tr key={r._id}>
                      <Td color={C.text}>{r.completedAt ? formatDate(r.completedAt) : ''}</Td>
                      <Td fontWeight="bold" color={C.text}>{r.studentName} ({r.studentSection})</Td>
                      <Td color={C.text}>{r.facultyId?.name || 'Unknown'}</Td>
                      <Td maxW="200px" color={C.text}>{r.casePresented}</Td>
                      <Td maxW="200px" color={C.text}>{r.interventionTaken}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </ScrollTable>
          </Box>
        )}

        {activePage === 'roster' && (
          <Box bg={C.surface} p={6} borderRadius="lg" borderWidth="1px" borderColor={C.border} shadow="sm">
            <HStack justifyContent="space-between" spacing={0} gap={3} flexWrap="wrap" mb={6}>
              <Text color={C.textMid} fontSize="sm">Live status of every faculty member.</Text>
              <SearchableSelect placeholder="All positions" value={rosterPosition} onChange={setRosterPosition} maxW="220px" options={[...new Set(facultyRoster.map(f => f.programPosition).filter(Boolean))].sort().map(position => ({ value: position, label: position }))} />
              <SearchableSelect placeholder="All live statuses" value={rosterStatus} onChange={setRosterStatus} maxW="190px" options={[...new Set(facultyRoster.map(f => f.currentStatus).filter(Boolean))].sort().map(status => ({ value: status, label: facultyStatusLabel(status) }))} />
              <ChakraButton colorScheme="blue" onClick={handleExportCSV}>Export CSV Report</ChakraButton>
            </HStack>
            <ScrollTable>
              <Table variant="simple" size="sm">
                <Thead><Tr><Th color={C.textMid}>Name</Th><Th color={C.textMid}>Position</Th><Th color={C.textMid}>Live Status</Th><Th color={C.textMid}>Location</Th></Tr></Thead>
                <Tbody>
                  {filteredRoster.map((prof) => (
                    <Tr key={prof._id}>
                      <Td fontWeight="bold" color={C.text}>{prof.name}</Td>
                      <Td color={C.text}>{prof.programPosition}</Td>
                      <Td>
                        <Badge colorScheme={facultyStatusColor(prof.currentStatus)}>
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

        {activePage === 'broadcast' && (
          <DeanBroadcastPanel C={C} />
        )}
      </Box>
    </DashboardShell>
    <AppointmentDetailsDrawer aptId={aptId} onClose={closeApt} />
    </>
  );
}
