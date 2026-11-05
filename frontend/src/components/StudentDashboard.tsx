import React, { useEffect, useState } from 'react';
import { cohortConfig } from '../data/cohortConfig';
import { formatDate, formatDateTime } from './dateUtils';
import BroadcastBanner from './BroadcastBanner';
import OnboardingModal from './OnboardingModal';
import PrivacyPolicyModal from './PrivacyPolicyModal';
import {
  Box, Grid, Heading, Text, Button as ChakraButton, Table, Thead, Tbody, Tr, Th, Td, TableContainer,
  Badge, Input, Select, VStack, HStack, useToast, FormControl, FormLabel, Flex,
  useColorModeValue,
  Modal, ModalOverlay, ModalContent, ModalHeader, ModalCloseButton, ModalBody, ModalFooter, useDisclosure
} from '@chakra-ui/react';
import { authFetch } from './authFetch';
import { BOOKING_LEAD_HOURS, facultyStatusColor, facultyStatusLabel } from './appointmentStatus';
import AppointmentDetailsDrawer from './AppointmentDetailsDrawer';
import { useDeepLink } from '../utils/useDeepLink';
import CancelReasonPicker, { STUDENT_CANCEL_REASONS } from './CancelReasonPicker';
import BulkCancelModal from './BulkCancelModal';
import WeeklyCalendar from './WeeklyCalendar';
import DashboardShell from './DashboardShell';
import PageTitle from './PageTitle';
import { PAGE_PAD, CARD_PAD, useNavPalette } from '../utils/uiTokens';
import RequestList from './RequestList';
import WelcomeHeader from './WelcomeHeader';
import ProfilePage from './ProfilePage';
import { manilaToday, addDaysIso, mondayOf, weeksBetween, weekLabel } from '../utils/weekUtils';
import WeeklyBookingCalendar from './WeeklyBookingCalendar';
import BookingConfirmModal from './BookingConfirmModal';

const PURPOSE_OPTIONS = [
  'Capstone / Thesis Consultation',
  'Programming / Code Debugging Assistance',
  'Academic Advising / Curriculum & Subject Enlistment',
  'OJT / Internship / Practicum Guidance',
  'Grade Dispute / Clearance for "INC" (Incomplete)',
  'Exam / Quiz Result Review',
  'Submission of Delayed Work / Make-up Requirements',
  'Others',
];

// "2026-10-19" -> "Mon, Oct 19" (T00:00:00 keeps it in local time, see dateUtils.ts)
const formatDatePreview = (val: string) => {
  if (!val) return '';
  const d = new Date(`${val}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

// Matches the dayOfWeek convention used on the faculty side (1 = Mon ... 6 = Sat)
export default function StudentDashboard() {
  const toast = useToast();
  const userName = localStorage.getItem('userName') || 'Student';
  const userId = localStorage.getItem('userId') || '';
  // Read-only mode: until the profile (incl. a valid ID) is complete, students can browse but not book.
  const profileComplete = localStorage.getItem('onboardingComplete') !== 'false';
  const { isOpen: isProfileOpen, onOpen: onProfileOpen, onClose: onProfileClose } = useDisclosure();
  const { isOpen: isPrivacyOpen, onOpen: onPrivacyOpen, onClose: onPrivacyClose } = useDisclosure();
  useEffect(() => { if (!profileComplete) onProfileOpen(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [activePage, setActivePage] = useState('home');
  // Notification links: ?page= switches page, ?apt= opens that appointment's details
  const { aptId, closeApt } = useDeepLink(['home', 'appointments', 'requests', 'profile'] as const, setActivePage);
  const [faculty, setFaculty] = useState<any[]>([]);
  const [studentSection] = useState(localStorage.getItem('programPosition') || '');

  // Faculty Status: search + filters (Gender, Position, Status) and the master-schedule dialog
  const [statusSearch, setStatusSearch] = useState('');
  const [fGender, setFGender] = useState('');
  const [fPosition, setFPosition] = useState('');
  const [fStatus, setFStatus] = useState('');
  const { isOpen: isMasterOpen, onOpen: onMasterOpen, onClose: onMasterClose } = useDisclosure();
  const [masterFaculty, setMasterFaculty] = useState<any>(null);
  const [masterData, setMasterData] = useState<{ classes: any[]; official: any[]; added: any[] }>({ classes: [], official: [], added: [] });
  const [masterLoading, setMasterLoading] = useState(false);

  const openMaster = (prof: any) => {
    setMasterFaculty(prof); setMasterLoading(true); onMasterOpen();
    const base = `${import.meta.env.VITE_API_URL}/api/faculty`;
    Promise.all([
      authFetch(`${base}/my-schedule/${prof._id}`).then(r => r.json()),
      authFetch(`${base}/consultation-hours/${prof._id}`).then(r => r.json()),
      authFetch(`${base}/added-hours/of/${prof._id}`).then(r => r.json()),
    ])
      .then(([classes, official, added]) => setMasterData({
        classes: Array.isArray(classes) ? classes : [], official: Array.isArray(official) ? official : [], added: Array.isArray(added) ? added : [],
      }))
      .catch(() => setMasterData({ classes: [], official: [], added: [] }))
      .finally(() => setMasterLoading(false));
  };

  const [selectedFaculty, setSelectedFaculty] = useState('');
  const [facultySearch, setFacultySearch] = useState('');
  // Bookable slots for the chosen professor (hourly pieces of official + added consultation hours, next 4 weeks)
  const [slots, setSlots] = useState<any[]>([]);
  const [busy, setBusy] = useState<any[]>([]);           // class and already-booked times (no names), for the calendar
  const [leadHours, setLeadHours] = useState(BOOKING_LEAD_HOURS);
  const [confirmOpen, setConfirmOpen] = useState(false); // the "Request this consultation" panel
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState(''); // "YYYY-MM-DD|HH:MM"
  const [weekOffset, setWeekOffset] = useState(0); // 0 = the current week; the booking window is 4 weeks ahead
  const [movedNote, setMovedNote] = useState(false); // true when the calendar jumped ahead by itself
  const [aptReason, setAptReason] = useState('');
  const [aptPurpose, setAptPurpose] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const [myRequests, setMyRequests] = useState<any[]>([]);
  const [detailsId, setDetailsId] = useState<string | null>(null); // the request whose View Details panel is open
  const [bulkOpen, setBulkOpen] = useState(false);
  const { isOpen: isSummaryOpen, onOpen: onSummaryOpen, onClose: onSummaryClose } = useDisclosure();
  const [summaryApt, setSummaryApt] = useState<any>(null);
  const viewAccomplishment = (apt: any) => { setSummaryApt(apt); onSummaryOpen(); };

  const palette = useNavPalette();
  const cardBg = palette.surface;
  const borderColor = palette.border;
  const textColor = palette.text;
  const mutedText = palette.textMid;
  const facultyRowHoverBg = useColorModeValue('gray.50', 'whiteAlpha.100');
  const readOnlyFieldBg = useColorModeValue('gray.50', 'whiteAlpha.100'); // hooks must run on every render, never inside conditional JSX

  const fetchData = () => {
    authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/status`)
      .then(res => res.json())
      .then(data => setFaculty(data));
    if (userId) {
      authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/appointments/student/${userId}`)
        .then(res => res.json())
        .then(data => setMyRequests(data));
    }
  };

  const formatTime = (timeStr: string) => {
    if (!timeStr) return '';
    const normalized = timeStr.replace(/-/g, ':');
    const parts = normalized.split(':');
    if (parts.length < 2) return normalized;
    const hours = parseInt(parts[0], 10);
    const minutes = parts[1].padStart(2, '0');
    if (Number.isNaN(hours)) return normalized;
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const h12 = hours % 12 === 0 ? 12 : hours % 12;
    return `${h12}:${minutes} ${ampm}`;
  };

  useEffect(() => {
    fetchData();
    const intervalId = setInterval(fetchData, 5000);
    return () => clearInterval(intervalId);
  }, [userId]);

  // When a professor is chosen, load their open consultation slots. Refreshed every 15 s so the
  // pending counts and taken slots stay current while the student is choosing.
  useEffect(() => {
    setSelectedSlot('');
    setConfirmOpen(false);
    setWeekOffset(0);
    setMovedNote(false);
    if (!selectedFaculty) { setSlots([]); setBusy([]); return; }
    let alive = true;
    const load = (first: boolean) => {
      if (first) setScheduleLoading(true);
      authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/slots/${selectedFaculty}`)
        .then(res => res.json())
        .then(data => {
          if (alive && Array.isArray(data.slots)) {
            setSlots(data.slots); setBusy(Array.isArray(data.busy) ? data.busy : []);
            setLeadHours(data.leadHours || BOOKING_LEAD_HOURS);
            // First load only (never on the 15-second refresh, so the student is not moved while looking):
            // if this week has nothing left to request, open the first week that does.
            if (first) {
              const firstOpen = data.slots[0]; // the server sorts slots by date and time
              const jump = firstOpen ? weeksBetween(mondayOf(manilaToday()), mondayOf(firstOpen.date)) : 0;
              if (jump > 0) { setWeekOffset(jump); setMovedNote(true); }
            }
          }
        })
        .catch(() => { if (alive && first) { setSlots([]); setBusy([]); } })
        .finally(() => { if (alive && first) setScheduleLoading(false); });
    };
    load(true);
    const id = setInterval(() => load(false), 15000);
    return () => { alive = false; clearInterval(id); };
  }, [selectedFaculty]);

  // Week-by-week view: Monday to Sunday, never earlier than the current week, never past the booking window.
  const todayIso = manilaToday();
  const thisMonday = mondayOf(todayIso);
  const maxWeekOffset = weeksBetween(thisMonday, mondayOf(addDaysIso(todayIso, 27)));
  const weekStart = addDaysIso(thisMonday, weekOffset * 7);

  const slotKey = (sl: any) => `${sl.date}|${sl.start}`;
  const slotLabel = (sl: any) => `${formatDatePreview(sl.date)} · ${formatTime(sl.start)} – ${formatTime(sl.end)}`;
  const chosenSlot = slots.find(sl => slotKey(sl) === selectedSlot);

  // Clicking a calendar cell: choose that hour and open the confirm panel (read-only mode cannot book).
  const pickSlot = (sl: any) => {
    if (!profileComplete) {
      toast({ title: 'Read-only mode', description: 'Complete your profile details and ID verification to unlock consultation requests.', status: 'warning', position: 'top' });
      return;
    }
    setSelectedSlot(slotKey(sl));
    setConfirmOpen(true);
  };

  // If the chosen hour is taken or closes while the panel is open (the list refreshes every 15 seconds), say so.
  useEffect(() => {
    if (confirmOpen && selectedSlot && !chosenSlot) {
      setConfirmOpen(false); setSelectedSlot('');
      toast({ title: 'That time is no longer available', description: 'Someone else got it, or it is too close to the start time. Please choose another hour.', status: 'info', position: 'top' });
    }
  }, [confirmOpen, selectedSlot, chosenSlot]); // eslint-disable-line react-hooks/exhaustive-deps

  // Professors the student has booked before, most recent first (shown by default and pinned to the top).
  const recommendedIds: string[] = React.useMemo(() => {
    const seen: string[] = [];
    myRequests.forEach((r: any) => { const id = r.facultyId?._id; if (id && !seen.includes(id)) seen.push(id); });
    return seen;
  }, [myRequests]);

  const positionOptions = Array.from(new Set(faculty.map(f => (f.programPosition || '').trim()).filter(Boolean))).sort();
  const statusGroups: Record<string, string[]> = {
    IN_CLASS: ['IN_CLASS'], IN_CONSULTATION: ['IN_CONSULTATION'], LEAVE_ABSENT: ['ON_LEAVE', 'ABSENT'],
  };
  const namedStatuses = Object.values(statusGroups).flat();
  const matchesStatus = (st: string) => fStatus === 'OTHER' ? !namedStatuses.includes(st) : statusGroups[fStatus].includes(st);
  const statusFiltered = faculty.filter(f =>
    f.name.toLowerCase().includes(statusSearch.toLowerCase()) &&
    (!fGender || f.gender === fGender) &&
    (!fPosition || (f.programPosition || '').trim() === fPosition) &&
    (!fStatus || matchesStatus(f.currentStatus))
  );

  const matchingFaculty = faculty.filter(f => f.name.toLowerCase().includes(facultySearch.toLowerCase()));
  const recommendedFaculty = recommendedIds.map(id => matchingFaculty.find(f => f._id === id)).filter(Boolean) as any[];
  // With nothing typed only the recommendations show; once the student types, they stay pinned on top.
  const filteredFaculty = [
    ...recommendedFaculty,
    ...(facultySearch.trim() ? matchingFaculty.filter(f => !recommendedIds.includes(f._id)) : []),
  ];

  const selectedFacultyObj = faculty.find(f => f._id === selectedFaculty);

  // Validates "Your Section" against the real program/year/section structure (e.g. "BS INFO 4D"),
  // rather than trusting whatever was typed. Returns an error message, or null if valid.
  const validateStudentSection = (input: string): string | null => {
    const trimmed = input.trim();
    const match = trimmed.match(/^(.+)\s(\d)([A-Za-z])$/);
    if (!match) return 'Format must be like "BS INFO 4D" (program, year, section).';
    const [, program, year, letter] = match;
    const section = letter.toUpperCase();
    if (!cohortConfig[program]) return `"${program}" isn't a recognized program.`;
    if (!cohortConfig[program][year]) return `Year ${year} isn't valid for ${program}.`;
    if (!cohortConfig[program][year].includes(section)) return `Section ${section} isn't valid for ${program} Year ${year}.`;
    return null;
  };

  const handleAppointmentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileComplete) {
      toast({ title: 'Read-only mode', description: 'Complete your profile details and ID verification to unlock consultation requests.', status: 'warning', position: 'top' });
      return;
    }

    const sectionError = validateStudentSection(studentSection);
    if (sectionError) {
      toast({ title: 'Invalid section', description: sectionError, status: 'warning' });
      return;
    }

    if (!chosenSlot) {
      toast({ title: 'Choose a time', description: 'Select an available consultation slot.', status: 'warning', position: 'top' });
      return;
    }

    if (!aptReason.trim()) {
      toast({
        title: 'Purpose of Meeting required',
        description: aptPurpose === 'Others'
          ? 'Please specify your purpose in the text box.'
          : 'Please select a purpose of meeting.',
        status: 'warning',
      });
      return;
    }

    setIsSubmitting(true);
    
    try {
      const response = await authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/appointment`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentName: userName, studentSection, facultyId: selectedFaculty, date: chosenSlot.date, time: chosenSlot.start, reason: aptReason })
      });

      // 1. We must parse the JSON to read the custom error message from the backend
      const data = await response.json();

      // 2. === THE INTERCEPTOR ===
      // If the backend threw a 400 Bad Request (Class collision, Double-booking, or Spam)
      if (!response.ok) {
        throw new Error(data.error || 'Failed to request appointment.');
      }

      // 3. If it was mathematically safe and successful:
      toast({ 
        title: 'Appointment Requested!', 
        description: 'Your request is now pending professor approval.',
        status: 'success', 
        duration: 3000,
        isClosable: true
      });
      
      setConfirmOpen(false);
      setSelectedFaculty(''); setSelectedSlot(''); setAptReason(''); setAptPurpose('');
      setActivePage('requests'); 
      fetchData(); 
      
    } catch (error: any) { 
      // 4. === THE SPAM BLOCKER TOAST ===
      // Catches the backend error and displays it loudly at the top of the screen
      toast({ 
        title: 'Time Slot Unavailable', 
        description: error.message,
        status: 'error', 
        duration: 6000, // Stays visible long enough for the student to read it
        isClosable: true,
        position: 'top'
      }); 
    }
    
    setIsSubmitting(false);
  };

  // Cancelling (pending or approved) asks for a reason first
  const [cancelTarget, setCancelTarget] = useState<any | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);

  const handleCancelAppointment = async () => {
    if (!cancelTarget) return;
    setCancelBusy(true);
    try {
      const response = await authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/appointment/${cancelTarget._id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'CANCELLED BY STUDENT', reason: cancelReason })
      });
      if (response.ok) {
        toast({ title: `Appointment Cancelled`, status: 'info' });
        setCancelTarget(null);
        fetchData();
      } else {
        const data = await response.json().catch(() => ({}));
        toast({ title: 'Could not cancel', description: data.error || 'Please try again.', status: 'error' });
      }
    } catch (error) {
      toast({ title: 'Could not cancel', description: 'Network error. Please try again.', status: 'error' });
    } finally { setCancelBusy(false); }
  };

  return (
    <>
    <DashboardShell
      portalLabel="Student Portal"
      userName={userName}
      nav={[
        { key: 'home', label: 'Faculty Status', active: activePage === 'home', onClick: () => setActivePage('home') },
        { key: 'appointments', label: 'Book Consultation', active: activePage === 'appointments', onClick: () => setActivePage('appointments') },
        { key: 'requests', label: 'My Requests', active: activePage === 'requests', onClick: () => setActivePage('requests') },
      ]}
      onOpenProfile={() => setActivePage('profile')}
      profileActive={activePage === 'profile'}
    >
        <WelcomeHeader name={userName} />
        <BroadcastBanner userRole="STUDENT" />
        <Box flex="1" minH={0} overflowY="auto" p={PAGE_PAD}>
          <PageTitle>
            {activePage === 'home' && "Live Faculty Status"}
            {activePage === 'appointments' && "Schedule a Consultation"}
            {activePage === 'requests' && "My Appointment Requests"}
            {activePage === 'profile' && "My Profile"}
          </PageTitle>

          {activePage === 'profile' && <ProfilePage />}

          {activePage === 'home' && (
            <Box bg={cardBg} p={6} borderRadius="lg" borderWidth="1px" borderColor={borderColor} shadow="sm">
              <Flex gap={3} mb={4} wrap="wrap">
                <Input placeholder="Search faculty by name..." value={statusSearch} onChange={(e) => setStatusSearch(e.target.value)} maxW="280px" color={textColor} borderColor={borderColor} />
                <Select placeholder="Gender" value={fGender} onChange={(e) => setFGender(e.target.value)} maxW="150px" color={textColor} borderColor={borderColor}>
                  <option value="Male">Male</option><option value="Female">Female</option>
                </Select>
                <Select placeholder="Position" value={fPosition} onChange={(e) => setFPosition(e.target.value)} maxW="220px" color={textColor} borderColor={borderColor}>
                  {positionOptions.map(p => <option key={p} value={p}>{p}</option>)}
                </Select>
                <Select placeholder="Status" value={fStatus} onChange={(e) => setFStatus(e.target.value)} maxW="200px" color={textColor} borderColor={borderColor}>
                  <option value="IN_CLASS">In Class</option>
                  <option value="IN_CONSULTATION">In Consultation</option>
                  <option value="LEAVE_ABSENT">On Leave / Absent</option>
                  <option value="OTHER">Other (Available, Meeting, Break, Out of Office...)</option>
                </Select>
              </Flex>
              <Text fontSize="xs" color={mutedText} mb={2}>
                Not Published means the faculty member has not yet shared their current availability.
              </Text>
              <TableContainer>
                <Table variant="simple" size="md">
                  <Thead><Tr><Th color={mutedText}>Faculty Name</Th><Th color={mutedText}>Live Status</Th><Th color={mutedText}>Announcements / Notices</Th></Tr></Thead>
                  <Tbody>
                    {statusFiltered.length === 0 && (
                      <Tr><Td colSpan={3}><Text color={mutedText} fontSize="sm">No faculty match your search or filters.</Text></Td></Tr>
                    )}
                    {statusFiltered.map((prof) => {
                      return (
                        <Tr key={prof._id}>
                          <Td fontWeight="bold" color={textColor}>
                            <Text cursor="pointer" color="blue.500" _hover={{ textDecoration: 'underline' }} onClick={() => openMaster(prof)} title="View master schedule">{prof.name}</Text>
                            <Text fontSize="xs" color={mutedText} fontWeight="normal">{prof.programPosition}</Text>
                          </Td>
                          <Td>
                            <HStack>
                              <Badge colorScheme={facultyStatusColor(prof.currentStatus)} px={3} py={1} borderRadius="full">
                                {facultyStatusLabel(prof.currentStatus)}
                              </Badge>
                            </HStack>
                          </Td>
                          <Td maxW="300px">
                            <VStack align="start" spacing={1}>
                              {prof.noticeMessage && <Badge colorScheme="blue" textTransform="none" whiteSpace="normal" p={2} borderRadius="md">📢 {prof.noticeMessage}</Badge>}
                              {prof.flaggedDate && <Badge colorScheme="orange" textTransform="none" p={2} borderRadius="md">🗓️ Out on {prof.flaggedDate} {prof.flaggedReason ? `(${prof.flaggedReason})` : ''}</Badge>}
                              {!prof.noticeMessage && !prof.flaggedDate && <Text color={mutedText} fontSize="sm">No current notices</Text>}
                            </VStack>
                          </Td>
                        </Tr>
                      );
                    })}
                  </Tbody>
                </Table>
              </TableContainer>
            </Box>
          )}

          {activePage === 'appointments' && (
            <Grid templateColumns={{ base: 'minmax(0, 1fr)', xl: '300px minmax(0, 1fr)' }} gap={6} alignItems="start">
              <Box bg={cardBg} p={CARD_PAD} borderRadius="lg" borderWidth="1px" borderColor={borderColor} shadow="sm">
                {!profileComplete && (
                  <Box mb={4} p={4} borderRadius="md" bg="orange.50" borderWidth="1px" borderColor="orange.300" color="orange.900">
                    <Text fontWeight="bold" mb={1}>Read-only mode</Text>
                    <Text fontSize="sm" mb={3}>Complete your profile details and ID verification to unlock consultation requests.</Text>
                    <ChakraButton size="sm" colorScheme="orange" onClick={onProfileOpen}>Complete profile</ChakraButton>
                  </Box>
                )}
                <VStack spacing={4} align="stretch">
                    <FormControl isRequired>
                      <FormLabel color={textColor}>Your Section</FormLabel>
                      <Input value={studentSection} isReadOnly color={textColor} borderColor={borderColor} bg={readOnlyFieldBg} cursor="not-allowed" />
                      <Text fontSize="xs" color={mutedText} mt={1}>From your account registration. Contact an admin if this is wrong.</Text>
                    </FormControl>
                    <FormControl isRequired>
                      <FormLabel color={textColor}>Select Professor</FormLabel>
                      <Input
                        placeholder="Search professor by name..."
                        value={selectedFacultyObj ? selectedFacultyObj.name : facultySearch}
                        onChange={(e) => { setFacultySearch(e.target.value); setSelectedFaculty(''); }}
                        color={textColor} borderColor={borderColor} mb={2}
                      />
                      {!selectedFaculty && (facultySearch.trim() || filteredFaculty.length > 0) && (
                        <Box borderWidth="1px" borderColor={borderColor} borderRadius="md" maxH="180px" overflowY="auto">
                          {!facultySearch.trim() && filteredFaculty.length > 0 && (
                            <Text px={3} pt={2} fontSize="xs" color={mutedText}>Booked before. Type to search all professors.</Text>
                          )}
                          {filteredFaculty.length === 0 && (
                            <Text p={3} fontSize="sm" color={mutedText}>No professors found.</Text>
                          )}
                          {filteredFaculty.map(f => {
                            const unavailable = f.currentStatus === 'ABSENT' || f.currentStatus === 'ON_LEAVE';
                            return (
                              <Box
                                key={f._id}
                                p={3}
                                cursor={unavailable ? 'not-allowed' : 'pointer'}
                                opacity={unavailable ? 0.5 : 1}
                                _hover={unavailable ? {} : { bg: facultyRowHoverBg }}
                                onClick={() => { if (!unavailable) { setSelectedFaculty(f._id); setFacultySearch(''); } }}
                              >
                                <Text fontWeight="600" color={textColor} fontSize="sm">{f.name} {unavailable ? '(Unavailable)' : ''} {recommendedIds.includes(f._id) && <Badge ml={1} colorScheme="blue" fontSize="9px">Booked before</Badge>}</Text>
                                <Text fontSize="xs" color={mutedText}>{f.programPosition}</Text>
                              </Box>
                            );
                          })}
                        </Box>
                      )}
                      {selectedFaculty && (
                        <ChakraButton size="xs" variant="link" colorScheme="blue" onClick={() => { setSelectedFaculty(''); setFacultySearch(''); }}>Change professor</ChakraButton>
                      )}
                    </FormControl>
                </VStack>
              </Box>

              <Box bg={cardBg} p={CARD_PAD} borderRadius="lg" borderWidth="1px" borderColor={borderColor} shadow="sm" minW={0}>
                <Heading size="sm" color={textColor} mb={4}>
                  {selectedFacultyObj ? `${selectedFacultyObj.name}'s Weekly Calendar` : 'Select a professor to view their calendar'}
                </Heading>
                {!selectedFaculty && (
                  <Text fontSize="sm" color={mutedText}>Search and choose a professor on the left to see when they can be booked.</Text>
                )}
                {selectedFaculty && scheduleLoading && (
                  <Text fontSize="sm" color={mutedText}>Loading schedule...</Text>
                )}
                {selectedFaculty && !scheduleLoading && slots.length === 0 && (
                  <Text fontSize="sm" color={mutedText}>No open hours in the next 4 weeks.</Text>
                )}
                {selectedFaculty && !scheduleLoading && slots.length > 0 && (
                  <VStack align="stretch" spacing={4}>
                    <Flex align="center" justify="space-between" gap={2}>
                      <ChakraButton size="sm" variant="outline" isDisabled={weekOffset === 0} visibility={weekOffset === 0 ? 'hidden' : 'visible'} onClick={() => { setMovedNote(false); setWeekOffset(w => Math.max(0, w - 1)); }}>‹ Previous Week</ChakraButton>
                      <Text fontWeight="700" fontSize="sm" color={textColor} textAlign="center">{weekLabel(weekStart)}</Text>
                      <ChakraButton size="sm" variant="outline" isDisabled={weekOffset >= maxWeekOffset} onClick={() => { setMovedNote(false); setWeekOffset(w => Math.min(maxWeekOffset, w + 1)); }}>Next Week ›</ChakraButton>
                    </Flex>
                    {movedNote && (
                      <Text fontSize="xs" color={mutedText} textAlign="center">Nothing is left to request in the current week, so the calendar moved to the first week with open hours.</Text>
                    )}
                    <WeeklyBookingCalendar
                      slots={slots} busy={busy} weekStart={weekStart} leadHours={leadHours}
                      selectedKey={selectedSlot} onPick={pickSlot}
                    />
                  </VStack>
                )}
              </Box>
            </Grid>
          )}

          {activePage === 'requests' && (
            <Box>
              <Flex justify="flex-end" mb={3}>
                <ChakraButton size="sm" colorScheme="red" variant="outline" onClick={() => setBulkOpen(true)}>Cancel several…</ChakraButton>
              </Flex>
              <BulkCancelModal isOpen={bulkOpen} onClose={() => setBulkOpen(false)} role="STUDENT" appointments={myRequests} onDone={fetchData} />
              <RequestList
                role="STUDENT"
                requests={myRequests}
                onViewDetails={setDetailsId}
                onCancel={(apt) => { setCancelReason(''); setCancelTarget(apt); }}
                onViewAccomplishment={viewAccomplishment}
                onChanged={fetchData}
              />
            </Box>
          )}
        </Box>
    </DashboardShell>

      {/* Cancel dialog: reason is required (dropdown, or "Others" to type one) */}
      <Modal isOpen={!!cancelTarget} onClose={() => !cancelBusy && setCancelTarget(null)} isCentered>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>{cancelTarget?.status === 'APPROVED' ? 'Cancel this appointment?' : 'Cancel this request?'}</ModalHeader>
          <ModalCloseButton isDisabled={cancelBusy} />
          <ModalBody>
            {cancelTarget && (
              <Text fontSize="sm" mb={4} color={mutedText}>
                {cancelTarget.facultyId ? cancelTarget.facultyId.name : 'The professor'} — {formatDate(cancelTarget.date)} at {formatTime(cancelTarget.time)}.
                {cancelTarget.status === 'APPROVED' ? ' The professor already approved this, and will be notified.' : ''}
              </Text>
            )}
            {cancelTarget && (
              <CancelReasonPicker key={cancelTarget._id} options={STUDENT_CANCEL_REASONS} onChange={setCancelReason} />
            )}
          </ModalBody>
          <ModalFooter>
            <ChakraButton variant="ghost" mr={3} onClick={() => setCancelTarget(null)} isDisabled={cancelBusy}>Keep it</ChakraButton>
            <ChakraButton colorScheme="red" onClick={handleCancelAppointment} isLoading={cancelBusy} isDisabled={!cancelReason.trim()}>Confirm cancel</ChakraButton>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Accomplishment view: read-only summary of a signed-off consultation.
          The student can't edit this — only the faculty member who completed
          the consultation can write casePresented/interventionTaken/remarks,
          via FacultyDashboard's "Complete & Sign Off" form. */}
      <OnboardingModal
        isOpen={isProfileOpen}
        role="STUDENT"
        email={localStorage.getItem('userEmail') || ''}
        name={localStorage.getItem('userName') || ''}
        token={localStorage.getItem('token') || ''}
        onOpenPrivacy={onPrivacyOpen}
        onSkip={onProfileClose}
        onDone={(data) => {
          localStorage.setItem('userName', data.name);
          localStorage.setItem('token', data.token);
          localStorage.setItem('programPosition', data.programPosition || '');
          localStorage.setItem('onboardingComplete', 'true');
          window.location.reload(); // refresh so every part of the dashboard uses the completed profile
        }}
      />
      <PrivacyPolicyModal isOpen={isPrivacyOpen} onClose={onPrivacyClose} />
      <BookingConfirmModal
        isOpen={confirmOpen && !!chosenSlot}
        onClose={() => { setConfirmOpen(false); setSelectedSlot(''); }}
        facultyName={selectedFacultyObj ? selectedFacultyObj.name : ''}
        slot={chosenSlot}
        whenLabel={chosenSlot ? slotLabel(chosenSlot) : ''}
        purposeOptions={PURPOSE_OPTIONS}
        purpose={aptPurpose}
        // For every purpose except "Others" the dropdown choice IS the reason sent to the server; "Others" clears it so one must be typed.
        onPurposeChange={(value) => { setAptPurpose(value); setAptReason(value === 'Others' ? '' : value); }}
        reason={aptReason}
        onReasonChange={setAptReason}
        isSubmitting={isSubmitting}
        onSubmit={handleAppointmentSubmit}
      />
      <AppointmentDetailsDrawer aptId={detailsId ?? aptId} onClose={() => { setDetailsId(null); closeApt(); }} />
      <Modal isOpen={isMasterOpen} onClose={onMasterClose} size="4xl" isCentered scrollBehavior="inside">
        <ModalOverlay />
        <ModalContent bg={cardBg}>
          <ModalHeader color={textColor}>{masterFaculty?.name}: Master Schedule</ModalHeader>
          <ModalCloseButton />
          <ModalBody pb={6}>
            {masterLoading ? <Text color={mutedText}>Loading schedule...</Text> : (
              <WeeklyCalendar classes={masterData.classes} official={masterData.official} added={masterData.added} />
            )}
          </ModalBody>
        </ModalContent>
      </Modal>
      <Modal isOpen={isSummaryOpen} onClose={onSummaryClose} isCentered>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Consultation Accomplishment</ModalHeader>
          <ModalCloseButton />
          <ModalBody pb={8}>
            <VStack align="stretch" spacing={4}>
              <Box>
                <Text fontSize="xs" fontWeight="700" color={mutedText} textTransform="uppercase">Faculty</Text>
                <Text color={textColor}>{summaryApt?.facultyId?.name || 'Unknown'}</Text>
              </Box>
              <Box>
                <Text fontSize="xs" fontWeight="700" color={mutedText} textTransform="uppercase">Date</Text>
                <Text color={textColor}>{formatDate(summaryApt?.date)} {summaryApt ? `at ${formatTime(summaryApt.time)}` : ''}</Text>
              </Box>
              <Box>
                <Text fontSize="xs" fontWeight="700" color={mutedText} textTransform="uppercase">Case Presented</Text>
                <Text color={textColor}>{summaryApt?.casePresented || '—'}</Text>
              </Box>
              <Box>
                <Text fontSize="xs" fontWeight="700" color={mutedText} textTransform="uppercase">Intervention / Action Taken</Text>
                <Text color={textColor}>{summaryApt?.interventionTaken || '—'}</Text>
              </Box>
              <Box>
                <Text fontSize="xs" fontWeight="700" color={mutedText} textTransform="uppercase">Remarks</Text>
                <Text color={textColor}>{summaryApt?.remarks || '—'}</Text>
              </Box>
              <Box>
                <Text fontSize="xs" fontWeight="700" color={mutedText} textTransform="uppercase">Signed Off</Text>
                <Text color={textColor}>{formatDateTime(summaryApt?.completedAt)}</Text>
              </Box>
            </VStack>
          </ModalBody>
        </ModalContent>
      </Modal>
    </>

  );
}
