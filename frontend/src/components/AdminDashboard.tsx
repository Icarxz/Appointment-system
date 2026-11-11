import React, { useState, useEffect } from 'react';
import { cohortConfig } from '../data/cohortConfig';
import { formatDate, formatDateTime } from './dateUtils';
import { 
  Box, Heading, Text, Button as ChakraButton, VStack, Input, FormControl, FormLabel, 
  useToast, Select, HStack, Flex, SimpleGrid, Avatar, useColorModeValue, Table, Thead, Tbody, Tr, Th, Td, Badge,
  Modal, ModalOverlay, ModalContent, ModalHeader, ModalCloseButton, ModalBody
} from '@chakra-ui/react';
import { authFetch } from './authFetch';
import ConsultationPrintForm, { printConsultationForm } from './ConsultationPrintForm';
import { dayHeading, groupByDay, manilaDay } from '../utils/logDays';
import ClassGridEditor from './ClassGridEditor';
import ProfilePage from './ProfilePage';
import ProfileGate from './ProfileGate';
import DashboardShell from './DashboardShell';
import PageTitle from './PageTitle';
import ExportBar from './ExportBar';
import ScrollTable from './ScrollTable';
import SearchableSelect from './SearchableSelect';
import RequestList from './RequestList';
import AppointmentDetailsDrawer from './AppointmentDetailsDrawer';
import WelcomeHeader from './WelcomeHeader';
import FacultyScheduleModal from './FacultyScheduleModal';
import ScheduleImportReview from './ScheduleImportReview';
import { PAGE_PAD, useNavPalette } from '../utils/uiTokens';
import { facultyStatusColor, facultyStatusLabel } from './appointmentStatus';
import AnalyticsReport from './AnalyticsReport';
// import { QRCodeSVG } from 'qrcode.react';

// ---------- Shared helpers for the People / Records pages ----------
const GENDER_OPTIONS = [
  { value: 'Male', label: 'Male' },
  { value: 'Female', label: 'Female' },
  { value: 'Prefer not to say', label: 'Prefer not to say' },
  { value: 'Not provided', label: 'Not provided' }, // older accounts created before gender was collected
];
const matchesGender = (g: string | undefined, filter: string) =>
  !filter || (filter === 'Not provided' ? !g : g === filter);

// "BS INFO 1A" -> { program: 'BS INFO', year: '1', section: 'A' }
const parseCohort = (pp?: string) => {
  const m = (pp || '').trim().match(/^(.*\S)\s+(\d+)([A-Za-z]+)$/);
  return m ? { program: m[1], year: m[2], section: m[3].toUpperCase() } : { program: '', year: '', section: '' };
};

function GenderBadge({ gender }: { gender?: string }) {
  if (!gender) return <Text as="span" opacity={0.5}>—</Text>;
  const color = gender === 'Male' ? 'blue' : gender === 'Female' ? 'pink' : 'gray';
  return <Badge colorScheme={color} borderRadius="full" px={2}>{gender}</Badge>;
}

function PersonCell({ name, sub, onClick, title }: { name: string; sub?: string; onClick?: () => void; title?: string }) {
  return (
    <HStack spacing={3} align="center">
      <Avatar size="sm" name={name} />
      <Box minW={0}>
        <Text
          fontWeight="bold" lineHeight="short"
          cursor={onClick ? 'pointer' : undefined}
          color={onClick ? 'blue.500' : undefined}
          _hover={onClick ? { textDecoration: 'underline' } : undefined}
          onClick={onClick} title={title}
        >{name}</Text>
        {sub && <Text fontSize="xs" opacity={0.65} lineHeight="short">{sub}</Text>}
      </Box>
    </HStack>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box minW={0}>
      <Text fontSize="xs" fontWeight="semibold" textTransform="uppercase" letterSpacing="wide" opacity={0.65} mb={1}>{label}</Text>
      {children}
    </Box>
  );
}

function FilterPanel({ children, shown, total, noun, canClear, onClear }: {
  children: React.ReactNode; shown: number; total: number; noun: string; canClear: boolean; onClear: () => void;
}) {
  const bg = useColorModeValue('gray.50', 'whiteAlpha.50');
  const line = useColorModeValue('gray.200', 'whiteAlpha.200');
  return (
    <Box bg={bg} borderWidth="1px" borderColor={line} borderRadius="lg" p={4} mb={4} className="no-print">
      <SimpleGrid columns={{ base: 1, sm: 2, lg: 4 }} spacing={3} alignItems="end">{children}</SimpleGrid>
      <Flex mt={3} align="center" justify="space-between" gap={3} flexWrap="wrap">
        <Text fontSize="xs" opacity={0.7}>Showing {shown} of {total} {noun}</Text>
        {canClear && <ChakraButton size="xs" variant="ghost" colorScheme="blue" onClick={onClear}>Clear filters</ChakraButton>}
      </Flex>
    </Box>
  );
}

export const formatTime = (timeStr: string) => {
  if (!timeStr) return '';
  const [hour, minute] = timeStr.split(':');
  const h = parseInt(hour, 10);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const standardHour = h % 12 || 12;
  return `${standardHour}:${minute} ${ampm}`;
};

export default function AdminDashboard() {
  const toast = useToast();
  const userName = localStorage.getItem('userName');

  const [activePage, setActivePage] = useState('appointments');
  const [facultyList, setFacultyList] = useState<any[]>([]);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [userTab, setUserTab] = useState<'faculty' | 'students'>('faculty');
  const [facultySearch, setFacultySearch] = useState('');
  const [studentSearch, setStudentSearch] = useState('');
  const [filterProgram, setFilterProgram] = useState('');
  const [filterYear, setFilterYear] = useState('');
  const [filterSection, setFilterSection] = useState('');
  const [studentGender, setStudentGender] = useState('');
  const [facultyGender, setFacultyGender] = useState('');
  const [role, setRole] = useState('FACULTY'); 
  const [allUsers, setAllUsers] = useState<any[]>([]);
  // const [selectedQr, setSelectedQr] = useState({ hash: '', name: '' }); 

  // Form States
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [programPosition, setProgramPosition] = useState('');
  const provisionPositionOptions = [
    'Faculty',
    'Librarian',
    'Program Head (BS INFO)',
    'Program Head (BS COMSCI)',
    'Program Head (BLIS)',
    'Dean',
  ];
  const [room, setRoom] = useState('');
  const [loading, setLoading] = useState(false);
  // const [generatedQr, setGeneratedQr] = useState('');
  const [newFacultyName, setNewFacultyName] = useState('');
  const [newAccount, setNewAccount] = useState<{ id: string; role: string } | null>(null); // the account just created, so its class grid can open

  const [reviewOpen, setReviewOpen] = useState(false); // Class Schedules: review an OCR schedule draft (importer preview)
  const [scheduleOf, setScheduleOf] = useState<any | null>(null); // faculty whose schedule is open
  const [emailEdit, setEmailEdit] = useState<any | null>(null); // account being moved to a school email
  const [emailEditValue, setEmailEditValue] = useState('');
  const [nameEdit, setNameEdit] = useState<any | null>(null);
  const [nameEditValue, setNameEditValue] = useState('');
  const [nameSaving, setNameSaving] = useState(false);
  const [emailSaving, setEmailSaving] = useState(false);
  const [idEdit, setIdEdit] = useState<any | null>(null);    // account whose School/Faculty ID is being added or edited
  const [idEditValue, setIdEditValue] = useState('');
  const [idSaving, setIdSaving] = useState(false);

  const [selectedFacultyId, setSelectedFacultyId] = useState('');

  const palette = useNavPalette();
  const cardBg = palette.surface;
  const borderColor = palette.border;
  const textColor = palette.text;
  const mutedText = palette.textMid;
  const hoverBg = useColorModeValue('blue.50', 'whiteAlpha.100');

  const fetchAllData = () => {
    authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/status`).then(res => res.json()).then(data => setFacultyList(data));
    authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/appointments/all`).then(res => res.json()).then(data => setAppointments(data));
    authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/users/all`).then(res => res.json()).then(data => setAllUsers(data));
  };

  useEffect(() => { fetchAllData(); }, []);

  // Keep faculty statuses live (they change automatically with class / consultation blocks)
  useEffect(() => {
    const id = setInterval(() => {
      if (document.hidden) return;
      authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/status`).then(res => res.json()).then(data => setFacultyList(data));
    }, 10000);
    return () => clearInterval(id);
  }, []);

  // Reports & Analytics charts now come from the backend (GET /api/analytics/report),
  // rendered by <AnalyticsReport />. Consultation Records below still uses `appointments`.

  const consultationRecords = React.useMemo(() => {
    return appointments
      .filter(a => a.status === 'COMPLETED')
      .sort((a, b) => new Date(b.completedAt || 0).getTime() - new Date(a.completedAt || 0).getTime());
  }, [appointments]);

  const [recordsSearch, setRecordsSearch] = useState('');
  const [recordsFaculty, setRecordsFaculty] = useState('');
  const [recordsCase, setRecordsCase] = useState('');
  const [recordsSort, setRecordsSort] = useState<'desc' | 'asc'>('desc'); // by date signed off
  const [detailsId, setDetailsId] = useState<string | null>(null); // the appointment whose View Details panel is open
  const [facultyPositionFilter, setFacultyPositionFilter] = useState('');
  const [facultyStatusFilter, setFacultyStatusFilter] = useState('');
  const filteredRecords = React.useMemo(() => {
    const q = recordsSearch.trim().toLowerCase();
    const list = consultationRecords.filter(r =>
      (!q || r.studentName?.toLowerCase().includes(q) || r.facultyId?.name?.toLowerCase().includes(q) || r.reason?.toLowerCase().includes(q)) &&
      (!recordsFaculty || r.facultyId?._id === recordsFaculty) &&
      (!recordsCase || r.casePresented === recordsCase)
    );
    const time = (r: any) => new Date(r.completedAt || 0).getTime();
    return [...list].sort((a, b) => recordsSort === 'asc' ? time(a) - time(b) : time(b) - time(a));
  }, [consultationRecords, recordsSearch, recordsFaculty, recordsCase, recordsSort]);

  // The printable form of the chosen faculty: the same data the faculty's own form uses (GET /consultation-log/:id, oldest first).
  const [printLog, setPrintLog] = useState<{ facultyId: string; rows: any[] } | null>(null);
  useEffect(() => {
    if (!recordsFaculty) { setPrintLog(null); return; }
    let cancelled = false;
    authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/consultation-log/${recordsFaculty}`)
      .then(r => (r.ok ? r.json() : []))
      .then(rows => { if (!cancelled) setPrintLog({ facultyId: recordsFaculty, rows: Array.isArray(rows) ? rows : [] }); })
      .catch(() => { if (!cancelled) setPrintLog({ facultyId: recordsFaculty, rows: [] }); });
    return () => { cancelled = true; };
  }, [recordsFaculty, consultationRecords.length]);
  const printReady = !!recordsFaculty && printLog?.facultyId === recordsFaculty;
  const recordGroups = React.useMemo(
    () => groupByDay(filteredRecords as any[], (r: any) => manilaDay(r.completedAt), (r: any) => r.completedAt || "", recordsSort),
    [filteredRecords, recordsSort],
  );

  const filteredFacultyList = React.useMemo(() => facultyList.filter(f =>
    (!facultyPositionFilter || f.programPosition === facultyPositionFilter) &&
    (!facultyStatusFilter || f.currentStatus === facultyStatusFilter) &&
    matchesGender(f.gender, facultyGender)
  ), [facultyList, facultyPositionFilter, facultyStatusFilter, facultyGender]);

  const handleAddFaculty = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); 
    // setGeneratedQr('');
    try {
      const response = await authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/add`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, programPosition, room, role })
      });
      const data = await response.json();
      if (response.ok) {
        toast({ title: data.message, status: 'success' });
        setNewFacultyName(data.facultyName);
        setNewAccount({ id: data.userId, role: data.role });
        setName(''); setEmail(''); setProgramPosition(''); setRoom('');
        fetchAllData();
      } else { toast({ title: data.error, status: 'error' }); }
    } catch (error) { }
    setLoading(false);
  };

  // Quick lookup so the faculty table (which comes from the live-status list) can show IDs.
  const userById: Record<string, any> = {};
  allUsers.forEach(u => { userById[u._id] = u; });

  const facultyQ = facultySearch.trim().toLowerCase();
  const visibleFaculty = filteredFacultyList.filter(p =>
    !facultyQ ||
    p.name.toLowerCase().includes(facultyQ) ||
    (p.programPosition || '').toLowerCase().includes(facultyQ) ||
    (userById[p._id]?.email || '').toLowerCase().includes(facultyQ)
  );

  const studentQ = studentSearch.trim().toLowerCase();
  const allStudents = allUsers.filter(u => u.role === 'STUDENT');
  const visibleStudents = allStudents.filter(u => {
    const pp = u.programPosition || '';
    const c = parseCohort(pp);
    return (!filterProgram || c.program === filterProgram || pp.startsWith(filterProgram)) &&
      (!filterYear || c.year === filterYear) &&
      (!filterSection || c.section === filterSection) &&
      matchesGender(u.gender, studentGender) &&
      (!studentQ || u.name.toLowerCase().includes(studentQ) || (u.email || '').toLowerCase().includes(studentQ) || (u.schoolId || '').toLowerCase().includes(studentQ));
  });

  const openNameEdit = (u: any) => { setNameEdit(u); setNameEditValue(u?.name || ''); };
  const saveName = async () => {
    if (!nameEdit) return;
    setNameSaving(true);
    try {
      const response = await authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/users/${nameEdit._id}/name`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nameEditValue })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      toast({ title: 'Name updated', description: data.message, status: 'success' });
      setNameEdit(null);
      fetchAllData();
    } catch (error: any) {
      toast({ title: 'Could not change name', description: error.message, status: 'error' });
    }
    setNameSaving(false);
  };

  const openEmailEdit = (u: any) => { setEmailEdit(u); setEmailEditValue(''); };
  const saveEmail = async () => {
    if (!emailEdit) return;
    setEmailSaving(true);
    try {
      const response = await authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/users/${emailEdit._id}/email`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailEditValue })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      toast({ title: 'Email changed', description: data.message, status: 'success' });
      setEmailEdit(null);
      fetchAllData();
    } catch (error: any) {
      toast({ title: 'Could not change email', description: error.message, status: 'error' });
    }
    setEmailSaving(false);
  };

  const openIdEdit = (u: any) => { setIdEdit(u); setIdEditValue((u.role === 'STUDENT' ? u.schoolId : u.facultyId) || ''); };

  const saveId = async () => {
    if (!idEdit) return;
    setIdSaving(true);
    try {
      const response = await authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/users/${idEdit._id}/id`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idValue: idEditValue })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      toast({ title: 'ID saved', description: data.message, status: 'success' });
      setIdEdit(null);
      fetchAllData();
    } catch (error: any) {
      toast({ title: 'Could not save ID', description: error.message, status: 'error' });
    }
    setIdSaving(false);
  };

  return (
    <DashboardShell
      portalLabel="Admin Console"
      userName={userName || ''}
      showMailbox={false}
      extras={<><ProfileGate role="ADMIN" /><FacultyScheduleModal faculty={scheduleOf} isOpen={!!scheduleOf} onClose={() => setScheduleOf(null)} /></>}
      nav={[
        { key: 'appointments', section: 'Operations', icon: 'inbox', label: 'Appointments', badge: appointments.filter(a => a.status === 'PENDING').length, active: activePage === 'appointments', onClick: () => setActivePage('appointments') },
        { key: 'home', section: 'Operations', icon: 'grid', label: 'Class Schedules', active: activePage === 'home', onClick: () => setActivePage('home') },
        { key: 'provision', section: 'People', icon: 'userPlus', label: 'Provision Account', active: activePage === 'provision', onClick: () => setActivePage('provision') },
        { key: 'faculty', section: 'People', icon: 'users', label: `Faculty (${allUsers.filter(u => u.role === 'FACULTY').length || facultyList.length})`, active: activePage === 'users' && userTab === 'faculty', onClick: () => { setUserTab('faculty'); setActivePage('users'); } },
        { key: 'students', section: 'People', icon: 'graduation', label: `Students (${allUsers.filter(u => u.role === 'STUDENT').length})`, active: activePage === 'users' && userTab === 'students', onClick: () => { setUserTab('students'); setActivePage('users'); } },
        { key: 'analytics', section: 'Reports', icon: 'chart', label: 'Reports & Analytics', active: activePage === 'analytics', onClick: () => setActivePage('analytics') },
        { key: 'records', section: 'Reports', icon: 'file', label: 'Consultation Records', active: activePage === 'records', onClick: () => setActivePage('records') },
        { key: 'profile', section: 'Account', icon: 'user', label: 'My Profile', active: activePage === 'profile', onClick: () => setActivePage('profile') },
      ]}
    >
      <WelcomeHeader name={userName || ''} actions={activePage === 'analytics' ? <ExportBar solid csvPath="/api/analytics/report.csv" fileBase="ccis-sync-report" /> : undefined} />
      <Box flex="1" minH={0} overflowY="auto" p={PAGE_PAD}>
        {/* The analytics page has no title (the menu already says where you are), like the faculty analytics. */}
        {activePage !== 'analytics' && <PageTitle>
          {activePage === 'home' && "Class Schedules"}
          {activePage === 'provision' && "Provision Account"}
          {activePage === 'users' && (userTab === 'faculty' ? "Faculty Management" : "Student Management")}
          {activePage === 'appointments' && "Appointments"}
          {activePage === 'records' && "Consultation Records"}
          {activePage === 'profile' && "My Profile"}
        </PageTitle>}

        {activePage === 'profile' && <ProfilePage />}

        {activePage === 'home' && (
          <Box bg={cardBg} p={6} borderRadius="lg" borderWidth="1px" borderColor={borderColor} shadow="sm">
            <FormControl maxW="360px" mb={5}>
              <FormLabel color={textColor}>Instructor</FormLabel>
              <SearchableSelect placeholder="Choose instructor..." value={selectedFacultyId} onChange={setSelectedFacultyId} maxW="360px"
                options={facultyList.map(f => ({ value: f._id, label: f.name }))} />
            </FormControl>
            {selectedFacultyId && (
              <HStack mb={3} justify="flex-end">
                <ChakraButton size="sm" variant="outline" onClick={() => setReviewOpen(true)} title="Preview of the schedule importer: check an OCR draft. Nothing is saved.">Review schedule draft (preview)</ChakraButton>
                <ScheduleImportReview key={selectedFacultyId} facultyId={selectedFacultyId} facultyName={facultyList.find(f => f._id === selectedFacultyId)?.name || ''} isOpen={reviewOpen} onClose={() => setReviewOpen(false)} />
              </HStack>
            )}
            {selectedFacultyId
              ? <ClassGridEditor key={selectedFacultyId} facultyId={selectedFacultyId} facultyName={facultyList.find(f => f._id === selectedFacultyId)?.name || ''} />
              : <Text color={mutedText}>Choose an instructor to see and edit their classes.</Text>}
          </Box>
        )}

        {activePage === 'provision' && (
          <Box display="flex" gap={8} flexDir={{ base: 'column', xl: 'row' }}>
            <Box flex={{ base: 'none', xl: '0 0 520px' }}>
              <Box bg={cardBg} p={6} borderRadius="lg" borderWidth="1px" borderColor={borderColor} shadow="sm">
                <form onSubmit={handleAddFaculty}>
                  <VStack spacing={4} align="stretch">
                    <FormControl isRequired>
                      <FormLabel color={textColor}>Full Name</FormLabel>
                      <Input value={name} onChange={(e) => setName(e.target.value)} color={textColor} borderColor={borderColor}/>
                    </FormControl>

                    <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4} alignItems="start">
                      <FormControl isRequired>
                        <FormLabel color={textColor}>Email</FormLabel>
                        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} color={textColor} borderColor={borderColor}/>
                      </FormControl>

                      <FormControl isRequired>
                        <FormLabel color={textColor}>Access Level</FormLabel>
                        <Select value={role} onChange={(e) => setRole(e.target.value)} color={textColor} borderColor={borderColor}>
                          <option value="FACULTY">Faculty Member</option>
                          <option value="DEAN">College Dean</option>
                          <option value="ADMIN">System Admin</option>
                        </Select>
                      </FormControl>
                    </SimpleGrid>

                    <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4} alignItems="start">
                      <FormControl isRequired>
                        <FormLabel color={textColor}>Program & Position</FormLabel>
                        <SearchableSelect placeholder="Select position..." value={programPosition} onChange={setProgramPosition} maxW="100%"
                          options={provisionPositionOptions.map(position => ({ value: position, label: position }))} />
                      </FormControl>
                      <FormControl isRequired>
                        <FormLabel color={textColor}>Room / Office</FormLabel>
                        <Input value={room} onChange={(e) => setRoom(e.target.value)} color={textColor} placeholder="e.g. Dean's Office" borderColor={borderColor}/>
                      </FormControl>
                    </SimpleGrid>

                    <ChakraButton type="submit" colorScheme="blue" w="100%" isLoading={loading}>Generate Account</ChakraButton>
                  </VStack>
                </form>
              </Box>
            </Box>
            <Box bg={cardBg} p={6} borderRadius="lg" borderWidth="1px" borderColor={borderColor} shadow="sm" flex="1" minW={0} minH="400px" display="flex" flexDir="column" alignItems={newAccount?.role === 'FACULTY' ? 'stretch' : 'center'} justifyContent={newAccount?.role === 'FACULTY' ? 'flex-start' : 'center'}>
              {newFacultyName ? (
                newAccount?.role === 'FACULTY' && newAccount.id ? (
                  <>
                    <Heading size="sm" color="green.500" mb={1}>Account created for {newFacultyName}</Heading>
                    <Text fontSize="sm" color={mutedText} mb={4}>Add their classes below (optional). You can change them later under Class Schedules.</Text>
                    <ClassGridEditor key={newAccount.id} facultyId={newAccount.id} facultyName={newFacultyName} />
                  </>
                ) : (
                  <VStack spacing={4}>
                    <Heading size="md" color="green.500">Provisioning Complete</Heading>
                    <Text textAlign="center" color={textColor}>Account created for <b>{newFacultyName}</b></Text>
                  </VStack>
                )
              ) : (
                <Text color={mutedText} textAlign="center">Fill provisioning form to create a faculty account.</Text>
              )}
            </Box>
          </Box>
        )}

        {activePage === 'users' && userTab === 'faculty' && (
          <Box bg={cardBg} p={6} borderRadius="lg" borderWidth="1px" borderColor={borderColor} shadow="sm">
            <FilterPanel
              shown={visibleFaculty.length} total={facultyList.length} noun="faculty"
              canClear={!!(facultyGender || facultyPositionFilter || facultyStatusFilter || facultySearch)}
              onClear={() => { setFacultyGender(''); setFacultyPositionFilter(''); setFacultyStatusFilter(''); setFacultySearch(''); }}
            >
              <FilterField label="Gender">
                <SearchableSelect placeholder="All genders" value={facultyGender} onChange={setFacultyGender} maxW="100%" options={GENDER_OPTIONS} />
              </FilterField>
              <FilterField label="Position">
                <SearchableSelect placeholder="All positions" value={facultyPositionFilter} onChange={setFacultyPositionFilter} maxW="100%"
                  options={[...new Set(facultyList.map(f => f.programPosition).filter(Boolean))].sort().map(position => ({ value: position, label: position }))} />
              </FilterField>
              <FilterField label="Live status">
                <SearchableSelect placeholder="All live statuses" value={facultyStatusFilter} onChange={setFacultyStatusFilter} maxW="100%"
                  options={[...new Set(facultyList.map(f => f.currentStatus).filter(Boolean))].sort().map(status => ({ value: status, label: facultyStatusLabel(status) }))} />
              </FilterField>
              <FilterField label="Search">
                <Input
                  placeholder="Name, position or email..."
                  value={facultySearch}
                  onChange={(e) => setFacultySearch(e.target.value)}
                  color={textColor} borderColor={borderColor} bg={cardBg}
                />
              </FilterField>
            </FilterPanel>

            <ScrollTable><Table variant="simple" size="md">
              <Thead><Tr><Th color={mutedText}>Name</Th><Th color={mutedText}>Position</Th><Th color={mutedText}>Gender</Th><Th color={mutedText}>Faculty ID</Th><Th color={mutedText}>Live Status</Th><Th color={mutedText}>Action</Th></Tr></Thead>
              <Tbody>
                {visibleFaculty.length === 0 && (
                  <Tr><Td colSpan={6}><Text color={mutedText} py={6} textAlign="center">No faculty match these filters.</Text></Td></Tr>
                )}
                {visibleFaculty.map(prof => (
                  <Tr key={prof._id} _hover={{ bg: hoverBg }}>
                    <Td color={textColor}><PersonCell name={prof.name} sub={userById[prof._id]?.email} onClick={() => setScheduleOf(prof)} title="View schedule" /></Td>
                    <Td color={textColor}>{prof.programPosition}</Td>
                    <Td><GenderBadge gender={prof.gender} /></Td>
                    <Td color={textColor}>{userById[prof._id]?.facultyId || (userById[prof._id]?.noIdYet ? <Badge colorScheme="yellow">No ID yet</Badge> : '—')}</Td>
                    <Td>
                      <Badge colorScheme={facultyStatusColor(prof.currentStatus)} borderRadius="full" px={2}>
                        {facultyStatusLabel(prof.currentStatus)}
                      </Badge>
                    </Td>
                    <Td>
                      {userById[prof._id]?.role === 'FACULTY' && (
                        <HStack spacing={2}>
                          <ChakraButton size="xs" variant="outline" onClick={() => setScheduleOf(prof)}>Schedule</ChakraButton>
                          <ChakraButton size="xs" variant="outline" onClick={() => openIdEdit(userById[prof._id])}>
                            {userById[prof._id]?.facultyId ? 'Edit ID' : 'Add ID'}
                          </ChakraButton>
                          <ChakraButton size="xs" variant="outline" onClick={() => openEmailEdit(userById[prof._id])}>Change email</ChakraButton>
                          <ChakraButton size="xs" variant="outline" onClick={() => openNameEdit(userById[prof._id])}>Edit name</ChakraButton>
                        </HStack>
                      )}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table></ScrollTable>
          </Box>
        )}

        {activePage === 'users' && userTab === 'students' && (
          <Box bg={cardBg} p={6} borderRadius="lg" borderWidth="1px" borderColor={borderColor} shadow="sm">
            <FilterPanel
              shown={visibleStudents.length} total={allStudents.length} noun="students"
              canClear={!!(studentGender || filterProgram || filterYear || filterSection || studentSearch)}
              onClear={() => { setStudentGender(''); setFilterProgram(''); setFilterYear(''); setFilterSection(''); setStudentSearch(''); }}
            >
              <FilterField label="Gender">
                <SearchableSelect placeholder="All genders" value={studentGender} onChange={setStudentGender} maxW="100%" options={GENDER_OPTIONS} />
              </FilterField>
              <FilterField label="Program">
                <SearchableSelect placeholder="All programs" value={filterProgram}
                  onChange={setFilterProgram}
                  maxW="100%" options={Object.keys(cohortConfig).map(prog => ({ value: prog, label: prog }))} />
              </FilterField>
              <FilterField label="Year">
                <SearchableSelect placeholder="All years" value={filterYear}
                  onChange={setFilterYear} maxW="100%"
                  options={[...new Set(Object.values(cohortConfig).flatMap(p => Object.keys(p)))].sort().map(y => ({ value: y, label: `Year ${y}` }))} />
              </FilterField>
              <FilterField label="Section">
                <SearchableSelect placeholder="All sections" value={filterSection} onChange={setFilterSection} maxW="100%"
                  options={[...new Set(Object.values(cohortConfig).flatMap(p => Object.values(p).flat()))].sort().map(sec => ({ value: sec, label: `Section ${sec}` }))} />
              </FilterField>
              <Box gridColumn={{ base: 'auto', lg: '1 / -1' }}>
                <FilterField label="Search">
                  <Input
                    placeholder="Name, email or school ID..."
                    value={studentSearch}
                    onChange={(e) => setStudentSearch(e.target.value)}
                    color={textColor} borderColor={borderColor} bg={cardBg}
                  />
                </FilterField>
              </Box>
            </FilterPanel>

            <ScrollTable><Table variant="simple" size="md">
              <Thead><Tr><Th color={mutedText}>Name</Th><Th color={mutedText}>School ID</Th><Th color={mutedText}>Gender</Th><Th color={mutedText}>Program / Section</Th><Th color={mutedText}>Action</Th></Tr></Thead>
              <Tbody>
                {visibleStudents.length === 0 && (
                  <Tr><Td colSpan={5}><Text color={mutedText} py={6} textAlign="center">No students match these filters.</Text></Td></Tr>
                )}
                {visibleStudents.map(student => (
                  <Tr key={student._id} _hover={{ bg: hoverBg }}>
                    <Td color={textColor}><PersonCell name={student.name} sub={student.email} /></Td>
                    <Td color={textColor}>{student.schoolId || (student.noIdYet ? <Badge colorScheme="yellow">No ID yet</Badge> : '—')}</Td>
                    <Td><GenderBadge gender={student.gender} /></Td>
                    <Td>{student.programPosition ? <Badge colorScheme="purple" variant="subtle" borderRadius="full" px={2}>{student.programPosition}</Badge> : '—'}</Td>
                    <Td>
                      <HStack spacing={2}>
                        <ChakraButton size="xs" variant="outline" onClick={() => openIdEdit(student)}>
                          {student.schoolId ? 'Edit ID' : 'Add ID'}
                        </ChakraButton>
                        <ChakraButton size="xs" variant="outline" onClick={() => openEmailEdit(student)}>Change email</ChakraButton>
                        <ChakraButton size="xs" variant="outline" onClick={() => openNameEdit(student)}>Edit name</ChakraButton>
                      </HStack>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table></ScrollTable>
          </Box>
        )}

        {(activePage === 'analytics' || activePage === 'records') && (
          // Print support: when the browser prints, everything on the page is
          // hidden except this wrapper (id="print-area"), and this wrapper is
          // repositioned to the top of the page. The sidebar, nav, search box
          // and buttons never show up in the printed/PDF output, only the
          // report content itself. This is pure CSS, no extra library.
          <style>{`
            @media print {
              body * { visibility: hidden; }
              #print-area, #print-area * { visibility: visible; }
              #print-area { position: absolute; left: 0; top: 0; width: 100%; padding: 0; }
              .no-print { display: none !important; }
            }
          `}</style>
        )}

        {activePage === 'analytics' && (
          <Box id="print-area">
            <Box sx={{ display: 'none', '@media print': { display: 'block' } }} mb={4}>
              <Heading size="md" color={textColor}>Reports & Analytics</Heading>
              <Text fontSize="sm" color={mutedText}>Generated {formatDateTime(new Date())}</Text>
            </Box>

            <AnalyticsReport />
          </Box>
        )}

        {activePage === 'records' && (
          <Box bg={cardBg} p={6} borderRadius="lg" borderWidth="1px" borderColor={borderColor} shadow="sm">
            <Flex mb={4} align="center" justify="space-between" gap={3} flexWrap="wrap" className="no-print">
              <Text color={mutedText} fontSize="sm">
                Completed consultations signed off by faculty. {recordsFaculty ? 'The printout is that faculty member\'s Students\' Consultation Form.' : 'Choose a faculty to print their Students\' Consultation Form.'}
              </Text>
              <ChakraButton colorScheme="blue" size="sm" onClick={printConsultationForm} isDisabled={!printReady}
                title={recordsFaculty ? undefined : 'Choose a faculty first'}>Print / Save as PDF</ChakraButton>
            </Flex>

            <FilterPanel
              shown={filteredRecords.length} total={consultationRecords.length} noun="records"
              canClear={!!(recordsFaculty || recordsCase || recordsSearch || recordsSort !== 'desc')}
              onClear={() => { setRecordsFaculty(''); setRecordsCase(''); setRecordsSearch(''); setRecordsSort('desc'); }}
            >
              <FilterField label="Faculty">
                <SearchableSelect placeholder="All faculty" value={recordsFaculty} onChange={setRecordsFaculty} maxW="100%"
                  options={[...new Map(consultationRecords.filter(r => r.facultyId?._id).map(r => [r.facultyId._id, { value: r.facultyId._id, label: r.facultyId.name || 'Unknown' }])).values()]} />
              </FilterField>
              <FilterField label="Case presented">
                <SearchableSelect placeholder="All cases" value={recordsCase} onChange={setRecordsCase} maxW="100%"
                  options={[...new Set(consultationRecords.map(r => r.casePresented).filter(Boolean))].sort().map(value => ({ value, label: value }))} />
              </FilterField>
              <FilterField label="Sort by day">
                <SearchableSelect placeholder="Newest day first" searchable={false} clearable={false} value={recordsSort} onChange={(v) => setRecordsSort(v === 'asc' ? 'asc' : 'desc')} maxW="100%"
                  options={[{ value: 'desc', label: 'Newest day first' }, { value: 'asc', label: 'Oldest day first' }]} />
              </FilterField>
              <FilterField label="Search">
                <Input
                  placeholder="Student, faculty or reason..."
                  value={recordsSearch}
                  onChange={(e) => setRecordsSearch(e.target.value)}
                  color={textColor} borderColor={borderColor} bg={cardBg}
                />
              </FilterField>
            </FilterPanel>

            <ScrollTable><Table variant="simple" size="md">
              <Thead>
                <Tr>
                  <Th color={mutedText} whiteSpace="nowrap">Consultation Date</Th>
                  <Th color={mutedText}>Student</Th>
                  <Th color={mutedText}>Faculty</Th>
                  <Th color={mutedText}>Case Presented</Th>
                  <Th color={mutedText}>Intervention Taken</Th>
                </Tr>
              </Thead>
              <Tbody>
                {filteredRecords.length === 0 && (
                  <Tr><Td colSpan={5}><Text color={mutedText} py={6} textAlign="center">No completed consultations found.</Text></Td></Tr>
                )}
                {recordGroups.map(g => (
                  <React.Fragment key={g.day || 'older'}>
                  <Tr><Td colSpan={5} py={2} fontWeight="700" fontSize="sm" bg="blackAlpha.50" _dark={{ bg: 'whiteAlpha.100' }} color={textColor}>{g.day ? `Saved ${dayHeading(g.day)}` : 'Earlier records'}</Td></Tr>
                  {g.rows.map(r => (
                  <Tr key={r._id} _hover={{ bg: hoverBg }}>
                    <Td color={textColor} whiteSpace="nowrap">{r.date ? formatDate(r.date) : ''}</Td>
                    <Td color={textColor}><PersonCell name={r.studentName || 'Unknown'} sub={r.studentSection} /></Td>
                    <Td color={textColor}>{r.facultyId?.name || 'Unknown'}</Td>
                    <Td maxW="220px" color={textColor} whiteSpace="normal">{r.casePresented ? <Badge colorScheme="orange" variant="subtle" whiteSpace="normal" borderRadius="md" px={2}>{r.casePresented}</Badge> : '—'}</Td>
                    <Td maxW="260px" color={textColor} whiteSpace="normal">{r.interventionTaken}</Td>
                  </Tr>
                  ))}
                  </React.Fragment>
                ))}
              </Tbody>
            </Table></ScrollTable>

            {printReady && printLog && (
              <ConsultationPrintForm facultyName={facultyList.find(f => f._id === recordsFaculty)?.name || filteredRecords.find(r => r.facultyId?._id === recordsFaculty)?.facultyId?.name || ''} entries={printLog.rows} />
            )}
          </Box>
        )}

        {activePage === 'appointments' && (
          <Box bg={cardBg} p={{ base: 3, md: 6 }} borderRadius="lg" borderWidth="1px" borderColor={borderColor} shadow="sm">
            {/* Same list as the Student and Faculty pages (filters, grouped by the day requested, View Details), but read-only for the Admin. */}
            <RequestList role="ADMIN" requests={appointments} onViewDetails={setDetailsId} onChanged={fetchAllData} />
          </Box>
        )}

        <Modal isOpen={!!emailEdit} onClose={() => setEmailEdit(null)} isCentered>
          <ModalOverlay />
          <ModalContent>
            <ModalHeader>Change email — {emailEdit?.name}</ModalHeader>
            <ModalCloseButton />
            <ModalBody pb={6}>
              <Text fontSize="sm" mb={3} color={mutedText}>
                Current: {emailEdit?.email}. Enter their school email so they can sign in with Google. Their appointments and ID stay with the account.
              </Text>
              <FormControl isRequired mb={4}>
                <FormLabel>School email</FormLabel>
                <Input placeholder="name@antiquespride.edu.ph" value={emailEditValue} onChange={(e) => setEmailEditValue(e.target.value.trim().toLowerCase())} />
              </FormControl>
              <ChakraButton colorScheme="blue" w="100%" onClick={saveEmail} isLoading={emailSaving}>Save email</ChakraButton>
            </ModalBody>
          </ModalContent>
        </Modal>

        <Modal isOpen={!!nameEdit} onClose={() => setNameEdit(null)} isCentered>
          <ModalOverlay />
          <ModalContent>
            <ModalHeader>Edit name</ModalHeader>
            <ModalCloseButton />
            <ModalBody pb={6}>
              <Text fontSize="sm" mb={3} color={mutedText}>
                Use this to fix a name copied wrongly from the Google account (e.g. "Last, First, M.I." order). Appointments stay linked to the account.
              </Text>
              <FormControl isRequired mb={4}>
                <FormLabel>Full name</FormLabel>
                <Input value={nameEditValue} onChange={(e) => setNameEditValue(e.target.value)} />
              </FormControl>
              <ChakraButton colorScheme="blue" w="100%" onClick={saveName} isLoading={nameSaving}>Save name</ChakraButton>
            </ModalBody>
          </ModalContent>
        </Modal>

        <Modal isOpen={!!idEdit} onClose={() => setIdEdit(null)} isCentered>
          <ModalOverlay />
          <ModalContent>
            <ModalHeader>{idEdit?.role === 'STUDENT' ? 'School ID' : 'Faculty ID'} — {idEdit?.name}</ModalHeader>
            <ModalCloseButton />
            <ModalBody pb={6}>
              <FormControl isRequired mb={4}>
                <FormLabel>{idEdit?.role === 'STUDENT' ? 'School ID' : 'Faculty ID'}</FormLabel>
                <Input
                  placeholder={idEdit?.role === 'STUDENT' ? '2025-S00001 or 2025-1234-A' : '2025S-00001'}
                  value={idEditValue}
                  onChange={(e) => setIdEditValue(e.target.value.toUpperCase())}
                />
              </FormControl>
              <ChakraButton colorScheme="blue" w="100%" onClick={saveId} isLoading={idSaving}>Save ID</ChakraButton>
            </ModalBody>
          </ModalContent>
        </Modal>
      </Box>
      <AppointmentDetailsDrawer aptId={detailsId} onClose={() => setDetailsId(null)} />
    </DashboardShell>
  );
}
