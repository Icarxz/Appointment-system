import React, { useState, useEffect } from 'react';
import { cohortConfig } from '../data/cohortConfig';
import { formatDate, formatDateTime } from './dateUtils';
import { 
  Box, Heading, Text, Button as ChakraButton, VStack, Input, FormControl, FormLabel, 
  useToast, Select, HStack, Divider, Table, Thead, Tbody, Tr, Th, Td, Badge, useColorModeValue,
  Modal, ModalOverlay, ModalContent, ModalHeader, ModalCloseButton, ModalBody
} from '@chakra-ui/react';
import { authFetch } from './authFetch';
import ProfileGate from './ProfileGate';
import DashboardShell from './DashboardShell';
import PageTitle from './PageTitle';
import ScrollTable from './ScrollTable';
import WelcomeHeader from './WelcomeHeader';
import { PAGE_PAD } from '../utils/uiTokens';
import { statusColor, statusLabel } from './appointmentStatus';
import AnalyticsReport from './AnalyticsReport';
// import { QRCodeSVG } from 'qrcode.react';

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

  const [activePage, setActivePage] = useState('home');
  const [facultyList, setFacultyList] = useState<any[]>([]);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [userTab, setUserTab] = useState<'faculty' | 'students'>('faculty');
  const [facultySearch, setFacultySearch] = useState('');
  const [studentSearch, setStudentSearch] = useState('');
  const [filterProgram, setFilterProgram] = useState('');
  const [filterYear, setFilterYear] = useState('');
  const [filterSection, setFilterSection] = useState('');
  const [role, setRole] = useState('FACULTY'); 
  const [allUsers, setAllUsers] = useState<any[]>([]);
  // const [selectedQr, setSelectedQr] = useState({ hash: '', name: '' }); 

  // Form States
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [programPosition, setProgramPosition] = useState('');
  const [room, setRoom] = useState('');
  const [loading, setLoading] = useState(false);
  // const [generatedQr, setGeneratedQr] = useState('');
  const [newFacultyName, setNewFacultyName] = useState('');

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
  const [subject, setSubject] = useState('');
  const [schedRoom, setSchedRoom] = useState('');
  const [dayOfWeek, setDayOfWeek] = useState('1'); 
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');

  const cardBg = useColorModeValue('#ffffff', '#111d30');
  const borderColor = useColorModeValue('#dde3ec', '#1e3048');
  const textColor = useColorModeValue('#0f2240', '#e8f0fe');
  const mutedText = useColorModeValue('#6b7fa0', '#7a93b0');

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
  const filteredRecords = React.useMemo(() => {
    const q = recordsSearch.trim().toLowerCase();
    if (!q) return consultationRecords;
    return consultationRecords.filter(r =>
      r.studentName?.toLowerCase().includes(q) ||
      r.facultyId?.name?.toLowerCase().includes(q) ||
      r.reason?.toLowerCase().includes(q)
    );
  }, [consultationRecords, recordsSearch]);

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
        setName(''); setEmail(''); setProgramPosition(''); setRoom('');
        fetchAllData();
      } else { toast({ title: data.error, status: 'error' }); }
    } catch (error) { }
    setLoading(false);
  };

  // Quick lookup so the faculty table (which comes from the live-status list) can show IDs.
  const userById: Record<string, any> = {};
  allUsers.forEach(u => { userById[u._id] = u; });

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

  // Approve a pending account. No ID is assigned here — the School ID / Faculty ID the person
  // entered at registration is kept as-is.
  const approveUser = async (id: string, name: string) => {
    try {
      const response = await authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/users/${id}/verify`, { method: 'PATCH' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      toast({ title: 'Approved', description: data.message || `${name} has been approved.`, status: data.emailSent === false ? 'warning' : 'success', duration: data.emailSent === false ? 9000 : 5000 });
      // refresh the list so the approved user disappears from the pending queue
      fetchAllData();
    } catch (error: any) {
      toast({ title: 'Approval Failed', description: error.message, status: 'error' });
    }
  };

  const handleAddSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/schedule/add`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facultyId: selectedFacultyId, subject, room: schedRoom, dayOfWeek: Number(dayOfWeek), startTime, endTime })
      });
      if (response.ok) {
        toast({ title: 'Schedule Added Successfully!', status: 'success' });
        setSubject(''); setSchedRoom(''); setStartTime(''); setEndTime('');
      }
    } catch (err) { toast({ title: 'Error adding schedule', status: 'error' }); }
  };

  const updateAppointmentStatus = async (targetApt: any, newStatus: string) => {
    if (newStatus === 'APPROVED') {
      const approvedThatDay = appointments.filter(a => a.status === 'APPROVED' && a.date === targetApt.date && a.facultyId?._id === targetApt.facultyId?._id);
      const timeToMinutes = (timeStr: string) => {
        const [hours, minutes] = timeStr.split(':').map(Number);
        return (hours * 60) + minutes;
      };
      const targetMinutes = timeToMinutes(targetApt.time);

      for (let existingApt of approvedThatDay) {
        const existingMinutes = timeToMinutes(existingApt.time);
        const timeDifference = Math.abs(targetMinutes - existingMinutes);
        if (timeDifference === 0) {
          toast({ title: "Overlap Blocked", description: `This faculty already has an appointment at this exact time!`, status: "error", duration: 5000 });
          return; 
        }
        if (timeDifference <= 60) {
          const isConfirmed = window.confirm(`WARNING: This is only ${timeDifference} minutes away from another approved meeting for this faculty. Proceed?`);
          if (!isConfirmed) return; 
        }
      }
    }
    try {
      const response = await authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/appointment/${targetApt._id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      if (response.ok) {
        toast({ title: `Appointment ${newStatus}`, status: 'success' });
        fetchAllData();
      }
    } catch (error) {}
  };

  return (
    <DashboardShell
      portalLabel="Admin Console"
      userName={userName || ''}
      showMailbox={false}
      extras={<ProfileGate role="ADMIN" />}
      nav={[
        { key: 'home', label: 'Class Schedules', active: activePage === 'home', onClick: () => setActivePage('home') },
        { key: 'appointments', label: `Appointments (${appointments.filter(a => a.status === 'PENDING').length})`, active: activePage === 'appointments', onClick: () => setActivePage('appointments') },
        { key: 'verification', label: 'Verification Queue', active: activePage === 'verification', onClick: () => setActivePage('verification') },
        {
          key: 'users', label: 'User Management', active: activePage === 'provision' || activePage === 'users', onClick: () => {},
          children: [
            { key: 'provision', label: 'Provision Account', active: activePage === 'provision', onClick: () => setActivePage('provision') },
            { key: 'faculty', label: `Faculty (${allUsers.filter(u => u.role === 'FACULTY').length || facultyList.length})`, active: activePage === 'users' && userTab === 'faculty', onClick: () => { setUserTab('faculty'); setActivePage('users'); } },
            { key: 'students', label: `Students (${allUsers.filter(u => u.role === 'STUDENT').length})`, active: activePage === 'users' && userTab === 'students', onClick: () => { setUserTab('students'); setActivePage('users'); } },
          ],
        },
        { key: 'analytics', label: 'Reports & Analytics', active: activePage === 'analytics', onClick: () => setActivePage('analytics') },
        { key: 'records', label: 'Consultation Records', active: activePage === 'records', onClick: () => setActivePage('records') },
      ]}
    >
      <WelcomeHeader name={userName || ''} />
      <Box flex="1" minH={0} overflowY="auto" p={PAGE_PAD}>
        <PageTitle>
          {activePage === 'home' && "Teaching Schedules"}
          {activePage === 'provision' && "Provision Account"}
          {activePage === 'users' && (userTab === 'faculty' ? "Faculty Management" : "Student Management")}
          {activePage === 'appointments' && "Appointment Management"}
          {activePage === 'verification' && "Account Verification Queue"}
          {activePage === 'analytics' && "Reports & Analytics"}
          {activePage === 'records' && "Consultation Records"}
        </PageTitle>

        {activePage === 'home' && (
          <Box maxW="760px">
              <Box bg={cardBg} p={6} borderRadius="lg" borderWidth="1px" borderColor={borderColor} shadow="sm">
                <Heading size="sm" mb={6} textTransform="uppercase" color={mutedText}>Assign Teaching Schedule</Heading>
                <form onSubmit={handleAddSchedule}>
                  <VStack spacing={4}>
                    <HStack w="100%">
                      <FormControl isRequired><FormLabel color={textColor}>Instructor</FormLabel><Select placeholder="Choose..." value={selectedFacultyId} onChange={(e) => setSelectedFacultyId(e.target.value)} color={textColor} borderColor={borderColor}>{facultyList.map(f => <option key={f._id} value={f._id}>{f.name}</option>)}</Select></FormControl>
                      <FormControl isRequired><FormLabel color={textColor}>Subject</FormLabel><Input value={subject} onChange={e => setSubject(e.target.value)} color={textColor} borderColor={borderColor}/></FormControl>
                    </HStack>
                    <HStack w="100%">
                      <FormControl isRequired><FormLabel color={textColor}>Day</FormLabel><Select value={dayOfWeek} onChange={e => setDayOfWeek(e.target.value)} color={textColor} borderColor={borderColor}><option value="1">Monday</option><option value="2">Tuesday</option><option value="3">Wednesday</option><option value="4">Thursday</option><option value="5">Friday</option><option value="6">Saturday</option></Select></FormControl>
                      <FormControl isRequired><FormLabel color={textColor}>Room</FormLabel><Input value={schedRoom} onChange={e => setSchedRoom(e.target.value)} color={textColor} borderColor={borderColor}/></FormControl>
                    </HStack>
                    <HStack w="100%">
                      <FormControl isRequired><FormLabel color={textColor}>Start</FormLabel><Input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} color={textColor} borderColor={borderColor}/></FormControl>
                      <FormControl isRequired><FormLabel color={textColor}>End</FormLabel><Input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} color={textColor} borderColor={borderColor}/></FormControl>
                    </HStack>
                    <ChakraButton type="submit" colorScheme="gray" variant="outline" w="100%">Assign Class Block</ChakraButton>
                  </VStack>
                </form>
              </Box>
          </Box>
        )}

        {activePage === 'provision' && (
          <Box display="flex" gap={8} flexDir={{ base: 'column', xl: 'row' }}>
            <Box flex="1">
              <Box bg={cardBg} p={6} borderRadius="lg" borderWidth="1px" borderColor={borderColor} shadow="sm">
                <Heading size="sm" mb={6} textTransform="uppercase" color={mutedText}>Provision Account</Heading>
                <form onSubmit={handleAddFaculty}>
                  <VStack spacing={4}>
                    <FormControl isRequired><FormLabel color={textColor}>Full Name</FormLabel><Input value={name} onChange={(e) => setName(e.target.value)} color={textColor} borderColor={borderColor}/></FormControl>
                    
                    <HStack w="100%">
                      <FormControl isRequired>
                        <FormLabel color={textColor}>Email</FormLabel>
                        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} color={textColor} borderColor={borderColor}/>
                      </FormControl>
                      
                      <FormControl isRequired>
                        <FormLabel color={textColor}>Access Level (Role)</FormLabel>
                        <Select value={role} onChange={(e) => setRole(e.target.value)} color={textColor} borderColor={borderColor}>
                          <option value="FACULTY">Faculty Member</option>
                          <option value="DEAN">College Dean</option>
                          <option value="ADMIN">System Admin</option>
                        </Select>
                      </FormControl>
                    </HStack>

                    <HStack w="100%">
                      <FormControl isRequired>
                        <FormLabel color={textColor}>Program & Position</FormLabel>
                        <Input value={programPosition} onChange={(e) => setProgramPosition(e.target.value)} color={textColor} placeholder="e.g. Dean, CCIS" borderColor={borderColor}/>
                      </FormControl>
                      <FormControl isRequired>
                        <FormLabel color={textColor}>Room / Office</FormLabel>
                        <Input value={room} onChange={(e) => setRoom(e.target.value)} color={textColor} placeholder="e.g. Dean's Office" borderColor={borderColor}/>
                      </FormControl>
                    </HStack>
                    
                    <ChakraButton type="submit" colorScheme="blue" w="100%" isLoading={loading}>Generate Account</ChakraButton>
                  </VStack>
                </form>
              </Box>
            </Box>
            <Box bg={cardBg} p={6} borderRadius="lg" borderWidth="1px" borderColor={borderColor} shadow="sm" flex="1" minH="400px" display="flex" flexDir="column" alignItems="center" justifyContent="center">
              {newFacultyName ? (
                <VStack spacing={4}>
                  <Heading size="md" color="green.500">Provisioning Complete</Heading>
                  <Text textAlign="center" color={textColor}>Account created for <b>{newFacultyName}</b></Text>
                </VStack>
              ) : (
                <Text color={mutedText} textAlign="center">Fill provisioning form to create a faculty account.</Text>
              )}
            </Box>
          </Box>
        )}

        {activePage === 'users' && userTab === 'faculty' && (
          <Box bg={cardBg} p={6} borderRadius="lg" borderWidth="1px" borderColor={borderColor} shadow="sm">
            <Input
              placeholder="Search by name, position or email..."
              value={facultySearch}
              onChange={(e) => setFacultySearch(e.target.value)}
              mb={4}
              maxW="400px"
              color={textColor}
              borderColor={borderColor}
            />
            <ScrollTable><Table variant="simple" size="sm">
              <Thead><Tr><Th color={mutedText}>Name</Th><Th color={mutedText}>Position</Th><Th color={mutedText}>Faculty ID</Th><Th color={mutedText}>Live Status</Th><Th color={mutedText}>Action</Th></Tr></Thead>
              <Tbody>
                {facultyList
                  .filter(prof =>
                    prof.name.toLowerCase().includes(facultySearch.toLowerCase()) ||
                    prof.programPosition.toLowerCase().includes(facultySearch.toLowerCase()) ||
                    (userById[prof._id]?.email || '').toLowerCase().includes(facultySearch.toLowerCase())
                  )
                  .map(prof => (
                    <Tr key={prof._id}>
                      <Td fontWeight="bold" color={textColor}>{prof.name}</Td>
                      <Td color={textColor}>{prof.programPosition}</Td>
                      <Td color={textColor}>{userById[prof._id]?.facultyId || (userById[prof._id]?.noIdYet ? <Badge colorScheme="yellow">No ID yet</Badge> : '—')}</Td>
                      <Td>
                        <Badge colorScheme={
                          prof.currentStatus === 'AVAILABLE'       ? 'green'  :
                          prof.currentStatus === 'IN_CLASS'        ? 'blue'   :
                          prof.currentStatus === 'IN_CONSULTATION' ? 'teal'   :
                          prof.currentStatus === 'IN_MEETING'      ? 'yellow' :
                          prof.currentStatus === 'ON_BREAK'        ? 'orange' :
                          prof.currentStatus === 'ON_LEAVE'        ? 'purple' :
                          prof.currentStatus === 'ABSENT'          ? 'red'    : 'gray'
                        }>
                          {({
                            AVAILABLE: 'Available', IN_CLASS: 'In Class',
                            IN_CONSULTATION: 'Consultation Hours', IN_MEETING: 'In a Meeting',
                            ON_BREAK: 'On Break', OUT_OF_OFFICE: 'Out of Office',
                            ON_LEAVE: 'On Leave', ABSENT: 'Absent', NOT_UPDATED: 'No Update',
                          } as Record<string,string>)[prof.currentStatus] ?? prof.currentStatus}
                        </Badge>
                      </Td>
                      <Td>
                        {userById[prof._id]?.role === 'FACULTY' && (
                          <HStack spacing={2}>
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
            <HStack spacing={3} mb={4}>
              <Select
                placeholder="Program"
                value={filterProgram}
                onChange={(e) => { setFilterProgram(e.target.value); setFilterYear(''); setFilterSection(''); }}
                maxW="180px" color={textColor} borderColor={borderColor}
              >
                {Object.keys(cohortConfig).map(prog => <option key={prog} value={prog}>{prog}</option>)}
              </Select>

              <Select
                placeholder="Year"
                value={filterYear}
                onChange={(e) => { setFilterYear(e.target.value); setFilterSection(''); }}
                isDisabled={!filterProgram}
                maxW="120px" color={textColor} borderColor={borderColor}
              >
                {filterProgram && Object.keys(cohortConfig[filterProgram]).map(y => <option key={y} value={y}>{y}</option>)}
              </Select>

              <Select
                placeholder="Section"
                value={filterSection}
                onChange={(e) => setFilterSection(e.target.value)}
                isDisabled={!filterYear}
                maxW="120px" color={textColor} borderColor={borderColor}
              >
                {filterProgram && filterYear && cohortConfig[filterProgram][filterYear].map(sec => <option key={sec} value={sec}>{sec}</option>)}
              </Select>

              <Input
                placeholder="Search by name or email..."
                value={studentSearch}
                onChange={(e) => setStudentSearch(e.target.value)}
                color={textColor} borderColor={borderColor}
              />
            </HStack>

            <ScrollTable><Table variant="simple" size="sm">
              <Thead><Tr><Th color={mutedText}>Name</Th><Th color={mutedText}>School ID</Th><Th color={mutedText}>Program / Section</Th><Th color={mutedText}>Email</Th><Th color={mutedText}>Action</Th></Tr></Thead>
              <Tbody>
                {allUsers
                  .filter(u => u.role === 'STUDENT')
                  .filter(u => !filterProgram || u.programPosition?.startsWith(filterProgram))
                  .filter(u => !filterYear || u.programPosition?.includes(` ${filterYear}`))
                  .filter(u => !filterSection || u.programPosition?.endsWith(filterSection))
                  .filter(u => u.name.toLowerCase().includes(studentSearch.toLowerCase()) || (u.email || '').toLowerCase().includes(studentSearch.toLowerCase()))
                  .map(student => (
                    <Tr key={student._id}>
                      <Td fontWeight="bold" color={textColor}>{student.name}</Td>
                      <Td color={textColor}>{student.schoolId || (student.noIdYet ? <Badge colorScheme="yellow">No ID yet</Badge> : '—')}</Td>
                      <Td color={textColor}>{student.programPosition}</Td>
                      <Td color={textColor}>{student.email}</Td>
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
          <Box id="print-area" bg={cardBg} p={6} borderRadius="lg" borderWidth="1px" borderColor={borderColor} shadow="sm">
            <HStack justifyContent="space-between" mb={6} className="no-print">
              <Text color={mutedText} fontSize="sm">Calculated live by the database.</Text>
            </HStack>
            <Box sx={{ display: 'none', '@media print': { display: 'block' } }} mb={4}>
              <Heading size="md" color={textColor}>Reports & Analytics</Heading>
              <Text fontSize="sm" color={mutedText}>Generated {formatDateTime(new Date())}</Text>
            </Box>

            <AnalyticsReport />
          </Box>
        )}

        {activePage === 'records' && (
          <Box id="print-area" bg={cardBg} p={6} borderRadius="lg" borderWidth="1px" borderColor={borderColor} shadow="sm">
            <HStack justifyContent="space-between" mb={4} className="no-print">
              <Input
                placeholder="Search by student, faculty, or reason..."
                value={recordsSearch}
                onChange={(e) => setRecordsSearch(e.target.value)}
                maxW="320px" color={textColor} borderColor={borderColor}
              />
              <ChakraButton size="sm" colorScheme="blue" onClick={() => window.print()}>Print / Save as PDF</ChakraButton>
            </HStack>
            <Box sx={{ display: 'none', '@media print': { display: 'block' } }} mb={4}>
              <Heading size="md" color={textColor}>Consultation Records</Heading>
              <Text fontSize="sm" color={mutedText}>Generated {formatDateTime(new Date())}</Text>
            </Box>

            <ScrollTable><Table variant="simple" size="sm">
              <Thead>
                <Tr>
                  <Th color={mutedText}>Date Signed Off</Th>
                  <Th color={mutedText}>Student</Th>
                  <Th color={mutedText}>Faculty</Th>
                  <Th color={mutedText}>Case Presented</Th>
                  <Th color={mutedText}>Intervention Taken</Th>
                  <Th color={mutedText}>Remarks</Th>
                </Tr>
              </Thead>
              <Tbody>
                {filteredRecords.length === 0 && (
                  <Tr><Td colSpan={6}><Text color={mutedText} py={4} textAlign="center">No completed consultations found.</Text></Td></Tr>
                )}
                {filteredRecords.map(r => (
                  <Tr key={r._id}>
                    <Td color={textColor}>{r.completedAt ? formatDate(r.completedAt) : ''}</Td>
                    <Td fontWeight="bold" color={textColor}>{r.studentName} ({r.studentSection})</Td>
                    <Td color={textColor}>{r.facultyId?.name || 'Unknown'}</Td>
                    <Td maxW="200px" color={textColor}>{r.casePresented}</Td>
                    <Td maxW="200px" color={textColor}>{r.interventionTaken}</Td>
                    <Td maxW="160px" color={textColor}>{r.remarks}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table></ScrollTable>
          </Box>
        )}

        {activePage === 'appointments' && (
          <Box bg={cardBg} p={6} borderRadius="lg" borderWidth="1px" borderColor={borderColor} shadow="sm">
            <ScrollTable><Table variant="simple" size="sm">
              <Thead><Tr><Th color={mutedText}>Student</Th><Th color={mutedText}>Target Faculty</Th><Th color={mutedText}>Date/Time</Th><Th color={mutedText}>Reason</Th><Th color={mutedText}>Status</Th><Th color={mutedText}>Action</Th></Tr></Thead>
              <Tbody>
                {appointments.map(apt => (
                  <Tr key={apt._id}>
                    <Td fontWeight="bold" color={textColor}>
                      {apt.studentName} ({apt.studentSection})
                      {apt.status === 'COMPLETED' && (
                        <Text fontSize="xs" fontWeight="normal" color="green.500">(Completed)</Text>
                      )}
                    </Td>
                    <Td color={textColor}>{apt.facultyId ? apt.facultyId.name : 'Unknown'}</Td>
                    <Td color={textColor}>{formatDate(apt.date)} at {formatTime(apt.time)}</Td>
                    <Td maxW="200px" isTruncated color={textColor}>{apt.reason}</Td>
                    <Td><Badge colorScheme={statusColor(apt.status)}>{statusLabel(apt.status)}</Badge></Td>
                    <Td>
                      {apt.status === 'PENDING' && (
                        <HStack spacing={2}>
                          <ChakraButton size="xs" colorScheme="green" onClick={() => updateAppointmentStatus(apt, 'APPROVED')}>Approve</ChakraButton>
                          <ChakraButton size="xs" colorScheme="red" onClick={() => updateAppointmentStatus(apt, 'REJECTED')}>Reject</ChakraButton>
                        </HStack>
                      )}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table></ScrollTable>
          </Box>
        )}

        {activePage === 'verification' && (
        <Box bg={cardBg} p={6} borderRadius="lg" borderWidth="1px" borderColor={borderColor} shadow="sm">
          {/* <Text mb={4} color={mutedText}>
            <em>Note:</em> This queue shows students who registered without an official School ID (e.g. recent transferees), pending manual verification.
          </Text> */}
          <Divider mb={4} borderColor={borderColor}/>
          <ScrollTable><Table variant="simple" size="sm">
            <Thead><Tr><Th color={mutedText}>Name</Th><Th color={mutedText}>Email</Th><Th color={mutedText}>Program</Th><Th color={mutedText}>Registered ID</Th><Th color={mutedText}>Status</Th><Th color={mutedText}>Action</Th></Tr></Thead>
            <Tbody>
              {allUsers
                .filter(u => 
                  (u.role === 'STUDENT' && u.accountStatus === 'PENDING_APPROVAL') ||
                  (u.role === 'FACULTY' && u.accountStatus === 'PENDING_APPROVAL')
                )
                .map(user => (
                  <Tr key={user._id}>
                    <Td fontWeight="bold" color={textColor}>{user.name}</Td>
                    <Td color={textColor}>{user.email}</Td>
                    <Td color={textColor}>{user.programPosition}</Td>
                    <Td color={textColor}>{(user.role === 'STUDENT' ? user.schoolId : user.facultyId) || (user.noIdYet ? <Badge colorScheme="yellow">No ID yet</Badge> : '—')}</Td>
                    <Td><Badge colorScheme="orange">Awaiting approval</Badge></Td>
                    <Td>
                      <ChakraButton size="xs" colorScheme="green" onClick={() => approveUser(user._id, user.name)}>
                        Approve
                      </ChakraButton>
                    </Td>
                  </Tr>
                ))}
            </Tbody>
          </Table></ScrollTable>
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
    </DashboardShell>
  );
}
