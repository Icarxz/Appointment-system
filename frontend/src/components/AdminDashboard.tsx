import React, { useState, useEffect } from 'react';
import { cohortConfig, FACULTY_POSITIONS } from '../data/cohortConfig';
import { PROGRAM_OPTIONS, facultyProgram, programOfPosition } from '../utils/programs';
import { GENDER_OPTIONS, matchesGender, parseCohort, GenderBadge, PersonCell, FilterField, FilterPanel } from './PeopleUi';
import { formatDate, formatDateTime } from './dateUtils';
import { 
  Box, Heading, Text, Button as ChakraButton, VStack, Input, FormControl, FormLabel, 
  useToast, Select, HStack, Flex, SimpleGrid, useColorModeValue, Table, Thead, Tbody, Tr, Th, Td, Badge,
  Modal, ModalOverlay, ModalContent, ModalHeader, ModalCloseButton, ModalBody, ModalFooter,
  InputGroup, InputRightAddon
} from '@chakra-ui/react';
import { IdTray, isIdComplete } from './IdTray';
import { ConnectionBanner, OfflineState, FilterPanelSkeleton, TableSkeleton, CardListSkeleton, useOnlineStatus, useSlowLoading } from './LoadingStates';
import { authFetch } from './authFetch';
import ConsultationPrintForm, { printConsultationForm } from './ConsultationPrintForm';
import { dayHeading, groupByDay, manilaDay } from '../utils/logDays';
import ClassGridEditor from './ClassGridEditor';
import AdminEditAccountModal from './AdminEditAccountModal';
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
import SchedulePdfImporter from './SchedulePdfImporter';
import BulkSchedulePdfImporter from './BulkSchedulePdfImporter';
import { PAGE_PAD, useNavPalette } from '../utils/uiTokens';
import { facultyStatusColor, facultyStatusLabel, facultyStatusOf, facultyStatusUntil } from './appointmentStatus';
import AnalyticsReport from './AnalyticsReport';
// import { QRCodeSVG } from 'qrcode.react';

const SCHOOL_DOMAIN = 'antiquespride.edu.ph';

// Disabled accounts are RESTRICTED or ARCHIVED (the backend blocks sign-in and hides them from booking lists).
const isAccountDisabled = (u: any) => u?.accountStatus === 'RESTRICTED' || u?.accountStatus === 'ARCHIVED';

// "mx@antiquespride.edu.ph" -> "mx"; anything not on the school domain -> ''
const emailLocalOf = (email?: string) => {
  const e = (email || '').toLowerCase();
  return e.endsWith('@' + SCHOOL_DOMAIN) ? e.slice(0, -(SCHOOL_DOMAIN.length + 1)) : '';
};

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
  const [userTab, setUserTab] = useState<'faculty' | 'students' | 'disabled'>('faculty');
  const [facultySearch, setFacultySearch] = useState('');
  const [studentSearch, setStudentSearch] = useState('');
  const [disabledSearch, setDisabledSearch] = useState('');
  const [disabledRoleFilter, setDisabledRoleFilter] = useState('');
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
  const [schoolId, setSchoolId] = useState('');
  const [facultyId, setFacultyId] = useState('');
  const [studentProgram, setStudentProgram] = useState('');
  const [studentYear, setStudentYear] = useState('');
  const [studentSection, setStudentSection] = useState('');
  const [gender, setGender] = useState('');
  const [loading, setLoading] = useState(false);
  // const [generatedQr, setGeneratedQr] = useState('');
  const [newFacultyName, setNewFacultyName] = useState('');
  const [newAccount, setNewAccount] = useState<{ id: string; role: string } | null>(null); // the account just created, so its class grid can open

  const [provisionImportOpen, setProvisionImportOpen] = useState(false); // Provision Account: import a schedule PDF for the account just created
  const [reviewOpen, setReviewOpen] = useState(false); // Class Schedules: review an OCR schedule draft (importer preview)
  const [bulkOpen, setBulkOpen] = useState(false); // Class Schedules: bulk import of several schedule PDFs
  const [gridKey, setGridKey] = useState(0); // bumped after an import so the class grid reloads
  const [scheduleOf, setScheduleOf] = useState<any | null>(null); // faculty whose schedule is open
  const [emailEdit, setEmailEdit] = useState<any | null>(null); // account being moved to a school email
  const [emailEditValue, setEmailEditValue] = useState('');
  const [nameEdit, setNameEdit] = useState<any | null>(null);
  const [nameEditValue, setNameEditValue] = useState('');
  const [nameSaving, setNameSaving] = useState(false);
  const [emailSaving, setEmailSaving] = useState(false);
  const [accountEdit, setAccountEdit] = useState<any | null>(null); // Faculty / Students > Edit: the account open in the profile-style form
  const [idEdit, setIdEdit] = useState<any | null>(null);    // account whose School/Faculty ID is being added or edited
  const [idEditValue, setIdEditValue] = useState('');
  const [idSaving, setIdSaving] = useState(false);
  const [emailDomainWarn, setEmailDomainWarn] = useState(false);
  const [statusTarget, setStatusTarget] = useState<any | null>(null); // account about to be disabled / re-enabled
  const [statusSaving, setStatusSaving] = useState(false);
  const [bulkTemplateKind, setBulkTemplateKind] = useState<'student' | 'faculty'>('student');
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkPreview, setBulkPreview] = useState<any | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkSummary, setBulkSummary] = useState<any | null>(null);

  const [selectedFacultyId, setSelectedFacultyId] = useState('');

  const palette = useNavPalette();
  const cardBg = palette.surface;
  const borderColor = palette.border;
  const textColor = palette.text;
  const mutedText = palette.textMid;
  const hoverBg = useColorModeValue('blue.50', 'whiteAlpha.100');

  // First load shows skeleton trays; if it fails (offline / server down) the page shows a Retry panel.
  // Later refreshes keep whatever is already on screen, so a dropped connection never blanks the page.
  const [dataStatus, setDataStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');
  const online = useOnlineStatus();
  const slowLoad = useSlowLoading(dataStatus === 'loading');
  const fetchAllData = async () => {
    const api = import.meta.env.VITE_API_URL;
    const get = async (path: string) => {
      const res = await authFetch(`${api}${path}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load the data.');
      return data;
    };
    try {
      const [fac, appts, users] = await Promise.all([
        get('/api/faculty/status'), get('/api/faculty/appointments/all'), get('/api/faculty/users/all'),
      ]);
      setFacultyList(fac); setAppointments(appts); setAllUsers(users);
      setLoadError(''); setDataStatus('ready');
    } catch (e: any) {
      setLoadError(e instanceof TypeError ? 'We could not reach the server. Check your connection and try again.' : (e.message || 'Could not load the data.'));
      setDataStatus(prev => (prev === 'ready' ? 'ready' : 'error'));
    }
  };
  const retryLoad = () => { setDataStatus(prev => (prev === 'error' ? 'loading' : prev)); return fetchAllData(); };
  const dataReady = dataStatus === 'ready';
  const needsData = activePage === 'appointments' || activePage === 'users' || activePage === 'records';

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
  const [facultyProgramFilter, setFacultyProgramFilter] = useState('');
  const [newProgram, setNewProgram] = useState(''); // Provision Account: the program of a new faculty member (optional)
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

  // The Faculty list also shows every Dean account (even one who has not turned consultations on), so an account switched to Dean can still be edited.
  const facultyRows = React.useMemo(
    () => [...facultyList, ...allUsers.filter(u => u.role === 'DEAN' && !facultyList.some(f => f._id === u._id))]
      .filter(u => !isAccountDisabled(allUsers.find(a => a._id === u._id))),
    [facultyList, allUsers],
  );
  const filteredFacultyList = React.useMemo(() => facultyRows.filter(f =>
    (!facultyPositionFilter || f.programPosition === facultyPositionFilter) &&
    (!facultyProgramFilter || facultyProgram(f) === facultyProgramFilter) &&
    (!facultyStatusFilter || facultyStatusOf(f) === facultyStatusFilter) &&
    matchesGender(f.gender, facultyGender)
  ), [facultyRows, facultyPositionFilter, facultyProgramFilter, facultyStatusFilter, facultyGender]);

  // Admin: set (or clear, with '') the program of a faculty member. A Program Head's program also comes from the position, so clearing it falls back to that.
  const saveProgram = async (id: string, program: string) => {
    try {
      const response = await authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/program/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ program })
      });
      const data = await response.json();
      if (response.ok) setFacultyList(list => list.map(f => (f._id === id ? { ...f, program: data.program || undefined } : f)));
      else toast({ title: data.error || 'Could not save the program.', status: 'error' });
    } catch { toast({ title: 'Could not reach the server.', status: 'error' }); }
  };

  const downloadBulkTemplate = async (kind: 'student' | 'faculty', format: 'xlsx' | 'csv') => {
    try {
      const response = await authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/bulk/template/${kind}.${format}`);
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Could not download the template.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${kind}-account-template.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error: any) {
      toast({ title: 'Template download failed', description: error.message, status: 'error' });
    }
  };

  const previewBulkFile = async () => {
    if (!bulkFile) return;
    setBulkBusy(true);
    setBulkPreview(null);
    setBulkSummary(null);
    try {
      const extension = bulkFile.name.toLowerCase();
      if (!extension.endsWith('.xlsx') && !extension.endsWith('.csv')) throw new Error('Only .xlsx and .csv files are accepted.');
      if (bulkFile.size > 2 * 1024 * 1024) throw new Error('The file exceeds the 2 MB limit.');
      const form = new FormData();
      form.append('file', bulkFile);
      const response = await authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/bulk/preview?template=${bulkTemplateKind}`, {
        method: 'POST',
        body: form,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not preview the spreadsheet.');
      setBulkPreview(data);
    } catch (error: any) {
      toast({ title: 'Preview failed', description: error.message, status: 'error' });
    }
    setBulkBusy(false);
  };

  const confirmBulkFile = async () => {
    if (!bulkFile || !bulkPreview) return;
    setBulkBusy(true);
    try {
      const form = new FormData();
      form.append('file', bulkFile);
      const response = await authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/bulk/confirm?template=${bulkTemplateKind}`, {
        method: 'POST',
        body: form,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not import the spreadsheet.');
      setBulkSummary(data);
      setBulkPreview(null);
      fetchAllData();
    } catch (error: any) {
      toast({ title: 'Import failed', description: error.message, status: 'error' });
    }
    setBulkBusy(false);
  };

  const downloadBulkErrorReport = () => {
    const rejected = bulkSummary?.rejectedRows || bulkPreview?.rows?.filter((r: any) => !r.valid).map((r: any) => ({
      rowNumber: r.rowNumber,
      submitted: r.submitted,
      reason: r.errors.join(' '),
    })) || [];
    if (!rejected.length) return;
    const escapeCsv = (value: any) => {
      let out = value === null || value === undefined ? '' : String(value);
      if (/^[=+\-@\t\r]/.test(out)) out = "'" + out;
      return '"' + out.replace(/"/g, '""') + '"';
    };
    const headers = ['Row number', 'Full name', 'School email', 'School ID', 'Employee ID', 'Program', 'Year', 'Section', 'Position', 'Role', 'Employment type', 'Reason'];
    const lines = [headers.map(escapeCsv).join(',')];
    rejected.forEach((item: any) => {
      const s = item.submitted || {};
      lines.push([
        item.rowNumber,
        s.name,
        s.email,
        s.schoolId,
        s.employeeId,
        s.program,
        s.year,
        s.section,
        s.position,
        s.role,
        s.employmentType,
        item.reason,
      ].map(escapeCsv).join(','));
    });
    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'account-import-rejected-rows.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handleAddFaculty = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); 
    // setGeneratedQr('');
    try {
      const response = await authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/add`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, email, role, gender: gender || undefined,
          schoolId: role === 'STUDENT' ? schoolId : undefined,
          facultyId: role !== 'STUDENT' ? facultyId : undefined,
          program: role === 'STUDENT' ? studentProgram : (role === 'FACULTY' ? newProgram : ''),
          year: role === 'STUDENT' ? studentYear : undefined,
          section: role === 'STUDENT' ? studentSection : undefined,
          programPosition: role !== 'STUDENT' ? programPosition : undefined,
        })
      });
      const data = await response.json();
      if (response.ok) {
        toast({ title: data.message, status: 'success' });
        setNewFacultyName(data.facultyName);
        setNewAccount({ id: data.userId, role: data.role });
        setName(''); setEmail(''); setProgramPosition(''); setNewProgram('');
        setSchoolId(''); setFacultyId(''); setStudentProgram(''); setStudentYear(''); setStudentSection(''); setGender('');
        fetchAllData();
      } else { toast({ title: data.error, status: 'error' }); }
    } catch (error) { }
    setLoading(false);
  };

  // Quick lookup so the faculty table (which comes from the status list) can show IDs.
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
  const allStudents = allUsers.filter(u => u.role === 'STUDENT' && !isAccountDisabled(u));
  const visibleStudents = allStudents.filter(u => {
    const pp = u.programPosition || '';
    const c = parseCohort(pp);
    return (!filterProgram || c.program === filterProgram || pp.startsWith(filterProgram)) &&
      (!filterYear || c.year === filterYear) &&
      (!filterSection || c.section === filterSection) &&
      matchesGender(u.gender, studentGender) &&
      (!studentQ || u.name.toLowerCase().includes(studentQ) || (u.email || '').toLowerCase().includes(studentQ) || (u.schoolId || '').toLowerCase().includes(studentQ));
  });
  const disabledAccounts = allUsers.filter(u =>
    ['STUDENT', 'FACULTY', 'DEAN'].includes(u.role) && isAccountDisabled(u)
  );
  const visibleDisabledAccounts = disabledAccounts.filter(u => {
    const q = disabledSearch.trim().toLowerCase();
    return (!disabledRoleFilter || u.role === disabledRoleFilter) &&
      (!q || u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q) ||
        (u.schoolId || '').toLowerCase().includes(q) || (u.facultyId || '').toLowerCase().includes(q));
  });

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

  // emailEditValue holds only the part before @antiquespride.edu.ph
  const openEmailEdit = (u: any) => { setEmailEdit(u); setEmailEditValue(emailLocalOf(u?.email)); setEmailDomainWarn(false); };
  const newEmail = `${emailEditValue}@${SCHOOL_DOMAIN}`;
  const emailValid = /^[a-z0-9._-]+$/.test(emailEditValue);
  const emailUnchanged = !!emailEdit && newEmail === (emailEdit.email || '').toLowerCase();
  const saveEmail = async () => {
    if (!emailEdit || !emailValid) return;
    setEmailSaving(true);
    try {
      const response = await authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/users/${emailEdit._id}/email`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail })
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

  // Disable / re-enable an account. A disabled account cannot sign in and is hidden from booking lists (enforced by the backend).
  const saveStatus = async () => {
    if (!statusTarget) return;
    const disable = !isAccountDisabled(statusTarget);
    setStatusSaving(true);
    try {
      const response = await authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/users/${statusTarget._id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disabled: disable })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      toast({ title: disable ? 'Account disabled' : 'Account enabled', description: data.message, status: 'success' });
      setStatusTarget(null);
      fetchAllData();
    } catch (error: any) {
      toast({ title: 'Could not update account', description: error.message, status: 'error' });
    }
    setStatusSaving(false);
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
        { key: 'faculty', section: 'People', icon: 'users', label: `Faculty (${allUsers.filter(u => u.role === 'FACULTY' && !isAccountDisabled(u)).length})`, active: activePage === 'users' && userTab === 'faculty', onClick: () => { setUserTab('faculty'); setActivePage('users'); } },
        { key: 'students', section: 'People', icon: 'graduation', label: `Students (${allUsers.filter(u => u.role === 'STUDENT' && !isAccountDisabled(u)).length})`, active: activePage === 'users' && userTab === 'students', onClick: () => { setUserTab('students'); setActivePage('users'); } },
        { key: 'disabled', section: 'People', icon: 'users', label: `Disabled (${disabledAccounts.length})`, active: activePage === 'users' && userTab === 'disabled', onClick: () => { setUserTab('disabled'); setActivePage('users'); } },
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
          {activePage === 'users' && (userTab === 'faculty' ? "Faculty Management" : userTab === 'students' ? "Student Management" : "Disabled Accounts")}
          {activePage === 'appointments' && "Appointments"}
          {activePage === 'records' && "Consultation Records"}
          {activePage === 'profile' && "My Profile"}
        </PageTitle>}

        <ConnectionBanner slow={slowLoad} onReconnect={fetchAllData} />

        {needsData && dataStatus === 'loading' && (
          activePage === 'appointments' ? <CardListSkeleton count={4} /> : (
            <Box bg={cardBg} p={6} borderRadius="lg" borderWidth="1px" borderColor={borderColor} shadow="sm">
              <FilterPanelSkeleton fields={activePage === 'records' ? 3 : 4} />
              <TableSkeleton rows={6} cols={5} />
            </Box>
          )
        )}
        {needsData && dataStatus === 'error' && <OfflineState offline={!online} message={loadError} onRetry={retryLoad} />}

        {activePage === 'profile' && <ProfilePage />}

        {activePage === 'home' && (
          <Box bg={cardBg} p={6} borderRadius="lg" borderWidth="1px" borderColor={borderColor} shadow="sm">
            <FormControl maxW="360px" mb={5}>
              <FormLabel color={textColor}>Instructor</FormLabel>
              <SearchableSelect placeholder="Choose instructor..." value={selectedFacultyId} onChange={setSelectedFacultyId} maxW="360px"
                options={facultyList.map(f => ({ value: f._id, label: f.name }))} />
            </FormControl>
            <HStack mb={3} justify="flex-end">
              <ChakraButton size="sm" colorScheme="blue" onClick={() => setBulkOpen(true)} title="Upload several faculty schedule PDFs at once. Each file name picks the faculty; you review and confirm each one.">Bulk Import PDFs</ChakraButton>
              <BulkSchedulePdfImporter isOpen={bulkOpen} onClose={() => setBulkOpen(false)} facultyList={facultyList} onApplied={() => setGridKey(k => k + 1)} />
            </HStack>
            {selectedFacultyId && (
              <HStack mb={3} justify="flex-end">
                <ChakraButton size="sm" variant="outline" onClick={() => setReviewOpen(true)} title="Upload a scanned Faculty Load PDF, review it, then confirm to replace the class schedule.">Import Schedule PDF</ChakraButton>
                <SchedulePdfImporter key={selectedFacultyId} mode="admin" facultyId={selectedFacultyId} facultyName={facultyList.find(f => f._id === selectedFacultyId)?.name || ''} isOpen={reviewOpen} onClose={() => setReviewOpen(false)} onApplied={() => setGridKey(k => k + 1)} />
              </HStack>
            )}
            {selectedFacultyId
              ? <ClassGridEditor key={`${selectedFacultyId}-${gridKey}`} facultyId={selectedFacultyId} facultyName={facultyList.find(f => f._id === selectedFacultyId)?.name || ''} />
              : <Text color={mutedText}>Choose an instructor to see and edit their classes.</Text>}
          </Box>
        )}

        {activePage === 'provision' && (
          <>
          <Box display="flex" gap={8} flexDir={{ base: 'column', xl: 'row' }}>
            <Box flex={{ base: 'none', xl: '0 0 520px' }}>
              <Box bg={cardBg} p={6} borderRadius="lg" borderWidth="1px" borderColor={borderColor} shadow="sm">
                <form onSubmit={handleAddFaculty}>
                  <VStack spacing={4} align="stretch">
                    <FormControl isRequired>
                      <FormLabel color={textColor}>Full Name</FormLabel>
                      <Input value={name} onChange={(e) => setName(e.target.value)} color={textColor} borderColor={borderColor}/>
                    </FormControl>

                    <FormControl isRequired>
                      <FormLabel color={textColor}>Email</FormLabel>
                      <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} color={textColor} borderColor={borderColor}/>
                    </FormControl>

                    <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4} alignItems="start">
                      <FormControl isRequired>
                        <FormLabel color={textColor}>Access Level</FormLabel>
                        <Select value={role} onChange={(e) => setRole(e.target.value)} color={textColor} borderColor={borderColor}>
                          <option value="STUDENT">Student</option>
                          <option value="FACULTY">Faculty Member</option>
                          <option value="DEAN">College Dean</option>
                        </Select>
                      </FormControl>
                    </SimpleGrid>

                    {role === 'STUDENT' ? (
                      <VStack spacing={4} align="stretch">
                        <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
                          <FormControl isRequired>
                            <FormLabel color={textColor}>School ID</FormLabel>
                            <Input value={schoolId} onChange={(e) => setSchoolId(e.target.value.toUpperCase())} placeholder="2025-S00001" />
                          </FormControl>
                          <FormControl isRequired>
                            <FormLabel color={textColor}>Program</FormLabel>
                            <SearchableSelect placeholder="Select program..." value={studentProgram} onChange={(v) => { setStudentProgram(v); setStudentYear(''); setStudentSection(''); }} searchable={false}
                              options={Object.keys(cohortConfig).map(p => ({ value: p, label: p }))} />
                          </FormControl>
                        </SimpleGrid>
                        <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
                          <FormControl isRequired>
                            <FormLabel color={textColor}>Year</FormLabel>
                            <SearchableSelect placeholder="Select year..." value={studentYear} onChange={(v) => { setStudentYear(v); setStudentSection(''); }} searchable={false} isDisabled={!studentProgram}
                              options={studentProgram ? Object.keys(cohortConfig[studentProgram]).map(y => ({ value: y, label: y })) : []} />
                          </FormControl>
                          <FormControl isRequired>
                            <FormLabel color={textColor}>Section</FormLabel>
                            <SearchableSelect placeholder="Select section..." value={studentSection} onChange={setStudentSection} searchable={false} isDisabled={!studentYear}
                              options={studentProgram && studentYear ? cohortConfig[studentProgram][studentYear].map(s => ({ value: s, label: s })) : []} />
                          </FormControl>
                        </SimpleGrid>
                        <FormControl>
                          <FormLabel color={textColor}>Gender (optional)</FormLabel>
                          <SearchableSelect placeholder="Not specified" value={gender} onChange={setGender} searchable={false} options={[{ value: 'Male', label: 'Male' }, { value: 'Female', label: 'Female' }]} />
                        </FormControl>
                      </VStack>
                    ) : (
                      <VStack spacing={4} align="stretch">
                        <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
                          <FormControl isRequired>
                            <FormLabel color={textColor}>Employee ID</FormLabel>
                            <Input value={facultyId} onChange={(e) => setFacultyId(e.target.value.toUpperCase())} placeholder="2025S-00001" />
                          </FormControl>
                          <FormControl isRequired>
                            <FormLabel color={textColor}>Position</FormLabel>
                            <SearchableSelect placeholder="Select position..." value={programPosition} onChange={setProgramPosition} maxW="100%"
                              options={FACULTY_POSITIONS.map(position => ({ value: position, label: position }))} />
                          </FormControl>
                        </SimpleGrid>
                        {role === 'FACULTY' && (
                          <FormControl>
                            <FormLabel color={textColor}>Faculty Program (optional)</FormLabel>
                            <SearchableSelect placeholder="Not set" value={newProgram} onChange={setNewProgram} maxW="100%" searchable={false} options={PROGRAM_OPTIONS} />
                          </FormControl>
                        )}
                        <FormControl>
                          <FormLabel color={textColor}>Gender (optional)</FormLabel>
                          <SearchableSelect placeholder="Not specified" value={gender} onChange={setGender} searchable={false} options={[{ value: 'Male', label: 'Male' }, { value: 'Female', label: 'Female' }]} />
                        </FormControl>
                      </VStack>
                    )}

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
                    <HStack mb={3} justify="flex-end">
                      <ChakraButton size="sm" variant="outline" onClick={() => setProvisionImportOpen(true)} title="Upload a scanned Faculty Load PDF, review it, then confirm to replace the class schedule.">Import Schedule PDF</ChakraButton>
                      <SchedulePdfImporter key={`p${newAccount.id}`} mode="admin" facultyId={newAccount.id} facultyName={newFacultyName} isOpen={provisionImportOpen} onClose={() => setProvisionImportOpen(false)} onApplied={() => setGridKey(k => k + 1)} />
                    </HStack>
                    <ClassGridEditor key={`${newAccount.id}-${gridKey}`} facultyId={newAccount.id} facultyName={newFacultyName} />
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
          <Box bg={cardBg} p={6} mt={6} borderRadius="lg" borderWidth="1px" borderColor={borderColor} shadow="sm">
            <Heading size="md" color={textColor} mb={1}>Bulk Account Provisioning</Heading>
            <Text fontSize="sm" color={mutedText} mb={4}>Preview is read-only. Accounts are created only after confirmation.</Text>
            <HStack flexWrap="wrap" spacing={3} mb={4}>
              <ChakraButton size="sm" variant="outline" onClick={() => downloadBulkTemplate('student', 'xlsx')}>Download Student Template (Excel)</ChakraButton>
              <ChakraButton size="sm" variant="outline" onClick={() => downloadBulkTemplate('student', 'csv')}>Download Student Template (CSV)</ChakraButton>
              <ChakraButton size="sm" variant="outline" onClick={() => downloadBulkTemplate('faculty', 'xlsx')}>Download Faculty/Dean Template (Excel)</ChakraButton>
              <ChakraButton size="sm" variant="outline" onClick={() => downloadBulkTemplate('faculty', 'csv')}>Download Faculty/Dean Template (CSV)</ChakraButton>
            </HStack>
            <SimpleGrid columns={{ base: 1, md: 3 }} spacing={4} alignItems="end">
              <FormControl>
                <FormLabel color={textColor}>Template type</FormLabel>
                <Select value={bulkTemplateKind} onChange={(e) => { setBulkTemplateKind(e.target.value as 'student' | 'faculty'); setBulkFile(null); setBulkPreview(null); setBulkSummary(null); }} color={textColor}>
                  <option value="student">Student accounts</option>
                  <option value="faculty">Faculty and Dean accounts</option>
                </Select>
              </FormControl>
              <FormControl>
                <FormLabel color={textColor}>Spreadsheet file</FormLabel>
                <Input type="file" accept=".xlsx,.csv" p={1} onChange={(e) => { setBulkFile(e.target.files?.[0] || null); setBulkPreview(null); setBulkSummary(null); }} />
              </FormControl>
              <ChakraButton colorScheme="blue" onClick={previewBulkFile} isDisabled={!bulkFile} isLoading={bulkBusy}>Preview Accounts</ChakraButton>
            </SimpleGrid>

            {bulkPreview && (
              <Box mt={5}>
                <HStack justify="space-between" flexWrap="wrap" mb={3}>
                  <Text fontWeight="semibold" color={textColor}>{bulkPreview.totalRows} rows: {bulkPreview.validRows} valid, {bulkPreview.rejectedRows} rejected</Text>
                  <HStack>
                    {bulkPreview.rejectedRows > 0 && (
                      <ChakraButton size="sm" variant="outline" onClick={downloadBulkErrorReport}>Download Rejected Rows</ChakraButton>
                    )}
                    <ChakraButton size="sm" colorScheme="green" onClick={confirmBulkFile} isDisabled={bulkPreview.validRows === 0} isLoading={bulkBusy}>Confirm Import</ChakraButton>
                  </HStack>
                </HStack>
                <ScrollTable><Table size="sm">
                  <Thead><Tr><Th>Row</Th><Th>Status</Th><Th>Submitted values</Th><Th>Reason</Th></Tr></Thead>
                  <Tbody>
                    {bulkPreview.rows.map((row: any) => (
                      <Tr key={row.rowNumber}>
                        <Td>{row.rowNumber}</Td>
                        <Td><Badge colorScheme={row.valid ? 'green' : 'red'}>{row.valid ? 'Valid' : 'Invalid'}</Badge></Td>
                        <Td>
                          <Text fontSize="xs">{row.submitted.name || '—'}{row.submitted.email ? ` · ${row.submitted.email}` : ''}</Text>
                          <Text fontSize="xs" color={mutedText}>{row.submitted.schoolId || row.submitted.employeeId || ''}</Text>
                        </Td>
                        <Td><Text fontSize="xs" color={row.valid ? mutedText : 'red.500'}>{row.valid ? 'Ready to create' : row.errors.join(' ')}</Text></Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table></ScrollTable>
              </Box>
            )}

            {bulkSummary && (
              <Box mt={5} p={4} borderWidth="1px" borderColor={borderColor} borderRadius="md">
                <Text fontWeight="semibold" color={textColor}>Import complete</Text>
                <Text fontSize="sm" color={mutedText}>Processed {bulkSummary.totalRows}: {bulkSummary.created} created, {bulkSummary.rejected} rejected.</Text>
                {bulkSummary.rejectedRows?.length > 0 && (
                  <ChakraButton mt={3} size="sm" variant="outline" onClick={downloadBulkErrorReport}>Download Error Report</ChakraButton>
                )}
              </Box>
            )}
          </Box>
          </>
        )}

        {dataReady && activePage === 'users' && userTab === 'faculty' && (
          <Box bg={cardBg} p={6} borderRadius="lg" borderWidth="1px" borderColor={borderColor} shadow="sm">
            <FilterPanel
              shown={visibleFaculty.length} total={facultyList.length} noun="faculty"
              canClear={!!(facultyGender || facultyPositionFilter || facultyProgramFilter || facultyStatusFilter || facultySearch)}
              onClear={() => { setFacultyGender(''); setFacultyPositionFilter(''); setFacultyProgramFilter(''); setFacultyStatusFilter(''); setFacultySearch(''); }}
            >
              <FilterField label="Gender">
                <SearchableSelect placeholder="All genders" value={facultyGender} onChange={setFacultyGender} maxW="100%" options={GENDER_OPTIONS} />
              </FilterField>
              <FilterField label="Position">
                <SearchableSelect placeholder="All positions" value={facultyPositionFilter} onChange={setFacultyPositionFilter} maxW="100%"
                  options={[...new Set(facultyList.map(f => f.programPosition).filter(Boolean))].sort().map(position => ({ value: position, label: position }))} />
              </FilterField>
              <FilterField label="Program">
                <SearchableSelect placeholder="All programs" value={facultyProgramFilter} onChange={setFacultyProgramFilter} maxW="100%" searchable={false} options={PROGRAM_OPTIONS} />
              </FilterField>
              <FilterField label="Status">
                <SearchableSelect placeholder="All statuses" value={facultyStatusFilter} onChange={setFacultyStatusFilter} maxW="100%"
                  options={[...new Set(facultyList.map(f => facultyStatusOf(f)).filter(Boolean))].sort().map(status => ({ value: status, label: facultyStatusLabel(status) }))} />
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
              <Thead><Tr><Th color={mutedText}>Name</Th><Th color={mutedText}>Position</Th><Th color={mutedText}>Program</Th><Th color={mutedText}>Gender</Th><Th color={mutedText}>Faculty ID</Th><Th color={mutedText}>Status</Th><Th color={mutedText}>Action</Th></Tr></Thead>
              <Tbody>
                {visibleFaculty.length === 0 && (
                  <Tr><Td colSpan={7}><Text color={mutedText} py={6} textAlign="center">No faculty match these filters.</Text></Td></Tr>
                )}
                {visibleFaculty.map(prof => (
                  <Tr key={prof._id} _hover={{ bg: hoverBg }}>
                    <Td color={textColor}><PersonCell name={prof.name} sub={userById[prof._id]?.email} onClick={() => setScheduleOf(prof)} title="View schedule" disabled={isAccountDisabled(userById[prof._id])} /></Td>
                    <Td color={textColor}>{prof.programPosition}</Td>
                    <Td minW="150px">
                      <SearchableSelect size="sm" maxW="150px" portal searchable={false} ariaLabel={`Program of ${prof.name}`} placeholder="Not set"
                        value={facultyProgram(prof)} onChange={(v) => saveProgram(prof._id, v)} options={PROGRAM_OPTIONS} isDisabled={!!programOfPosition(prof.programPosition)} />
                    </Td>
                    <Td><GenderBadge gender={prof.gender} /></Td>
                    <Td color={textColor}>{userById[prof._id]?.facultyId || (userById[prof._id]?.noIdYet ? <Badge colorScheme="yellow">No ID yet</Badge> : '—')}</Td>
                    <Td>
                      <Badge colorScheme={facultyStatusColor(facultyStatusOf(prof))} borderRadius="full" px={2}>
                        {facultyStatusLabel(facultyStatusOf(prof))}
                      </Badge>
                      {facultyStatusUntil(prof) && <Text fontSize="xs" color={mutedText}>{facultyStatusUntil(prof)}</Text>}
                    </Td>
                    <Td>
                      {(userById[prof._id]?.role === 'FACULTY' || userById[prof._id]?.role === 'DEAN') && (
                        <HStack spacing={2}>
                          {userById[prof._id]?.role === 'FACULTY' && <ChakraButton size="xs" variant="outline" onClick={() => setScheduleOf(prof)}>Schedule</ChakraButton>}
                          <ChakraButton size="xs" variant="outline" onClick={() => userById[prof._id] && setAccountEdit(userById[prof._id])}>Edit</ChakraButton>
                          {(userById[prof._id]?.role === 'FACULTY' || userById[prof._id]?.role === 'DEAN') && (
                            <ChakraButton size="xs" variant="outline" colorScheme={isAccountDisabled(userById[prof._id]) ? 'green' : 'red'} onClick={() => setStatusTarget(userById[prof._id])}>
                              {isAccountDisabled(userById[prof._id]) ? 'Enable' : 'Disable'}
                            </ChakraButton>
                          )}
                        </HStack>
                      )}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table></ScrollTable>
          </Box>
        )}

        {dataReady && activePage === 'users' && userTab === 'students' && (
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
                    <Td color={textColor}><PersonCell name={student.name} sub={student.email} disabled={isAccountDisabled(student)} /></Td>
                    <Td color={textColor}>{student.schoolId || (student.noIdYet ? <Badge colorScheme="yellow">No ID yet</Badge> : '—')}</Td>
                    <Td><GenderBadge gender={student.gender} /></Td>
                    <Td>{student.programPosition ? <Badge colorScheme="purple" variant="subtle" borderRadius="full" px={2}>{student.programPosition}</Badge> : '—'}</Td>
                    <Td>
                      <HStack spacing={2}>
                        <ChakraButton size="xs" variant="outline" onClick={() => setAccountEdit(student)}>Edit</ChakraButton>
                        <ChakraButton size="xs" variant="outline" colorScheme={isAccountDisabled(student) ? 'green' : 'red'} onClick={() => setStatusTarget(student)}>
                          {isAccountDisabled(student) ? 'Enable' : 'Disable'}
                        </ChakraButton>
                      </HStack>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table></ScrollTable>
          </Box>
        )}

        {dataReady && activePage === 'users' && userTab === 'disabled' && (
          <Box bg={cardBg} p={6} borderRadius="lg" borderWidth="1px" borderColor={borderColor} shadow="sm">
            <FilterPanel
              shown={visibleDisabledAccounts.length} total={disabledAccounts.length} noun="disabled accounts"
              canClear={!!(disabledSearch || disabledRoleFilter)}
              onClear={() => { setDisabledSearch(''); setDisabledRoleFilter(''); }}
            >
              <FilterField label="Role">
                <SearchableSelect placeholder="All roles" value={disabledRoleFilter} onChange={setDisabledRoleFilter} maxW="100%"
                  searchable={false}
                  options={[
                    { value: 'STUDENT', label: 'Student' },
                    { value: 'FACULTY', label: 'Faculty' },
                    { value: 'DEAN', label: 'Dean' },
                  ]} />
              </FilterField>
              <Box gridColumn={{ base: 'auto', lg: '1 / -1' }}>
                <FilterField label="Search">
                  <Input
                    placeholder="Name, email or ID..."
                    value={disabledSearch}
                    onChange={(e) => setDisabledSearch(e.target.value)}
                    color={textColor} borderColor={borderColor} bg={cardBg}
                  />
                </FilterField>
              </Box>
            </FilterPanel>

            <ScrollTable><Table variant="simple" size="md">
              <Thead><Tr><Th color={mutedText}>Name</Th><Th color={mutedText}>Role</Th><Th color={mutedText}>Email</Th><Th color={mutedText}>ID</Th><Th color={mutedText}>Status</Th><Th color={mutedText}>Action</Th></Tr></Thead>
              <Tbody>
                {visibleDisabledAccounts.length === 0 && (
                  <Tr><Td colSpan={6}><Text color={mutedText} py={6} textAlign="center">No disabled accounts match these filters.</Text></Td></Tr>
                )}
                {visibleDisabledAccounts.map(account => (
                  <Tr key={account._id} _hover={{ bg: hoverBg }}>
                    <Td color={textColor}><PersonCell name={account.name} sub={account.email} disabled /></Td>
                    <Td color={textColor}>{account.role.charAt(0) + account.role.slice(1).toLowerCase()}</Td>
                    <Td color={textColor}>{account.email}</Td>
                    <Td color={textColor}>{account.role === 'STUDENT' ? (account.schoolId || '—') : (account.facultyId || '—')}</Td>
                    <Td><Badge colorScheme={account.accountStatus === 'ARCHIVED' ? 'gray' : 'red'} borderRadius="full" px={2}>{account.accountStatus}</Badge></Td>
                    <Td>
                      <ChakraButton size="xs" variant="outline" colorScheme="green" onClick={() => setStatusTarget(account)}>
                        Enable
                      </ChakraButton>
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

        {dataReady && activePage === 'records' && (
          <Box bg={cardBg} p={6} borderRadius="lg" borderWidth="1px" borderColor={borderColor} shadow="sm">
            <Flex mb={4} align="center" justify="space-between" gap={3} flexWrap="wrap" className="no-print">
              <Text color={mutedText} fontSize="sm">
                Saved consultations of faculty. {recordsFaculty ? 'The printout is that faculty member\'s Students\' Consultation Form.' : 'Choose a faculty to print their Students\' Consultation Form.'}
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

        {dataReady && activePage === 'appointments' && (
          <Box bg={cardBg} p={{ base: 3, md: 6 }} borderRadius="lg" borderWidth="1px" borderColor={borderColor} shadow="sm">
            {/* Same list as the Student and Faculty pages (filters, grouped by the day requested, View Details), but read-only for the Admin. */}
            <RequestList role="ADMIN" requests={appointments} onViewDetails={setDetailsId} onChanged={fetchAllData} />
          </Box>
        )}

        <Modal isOpen={!!emailEdit} onClose={() => setEmailEdit(null)} isCentered>
          <ModalOverlay />
          <ModalContent>
            <ModalHeader>Edit email — {emailEdit?.name}</ModalHeader>
            <ModalCloseButton />
            <ModalBody pb={6}>
              <Text fontSize="sm" mb={3} color={mutedText}>
                Current: {emailEdit?.email}. Use their @{SCHOOL_DOMAIN} account so they can sign in with Google. You can change it again any time; appointments and ID stay with the account.
              </Text>
              <FormControl isRequired isInvalid={emailDomainWarn || (!!emailEditValue && !emailValid)} mb={4}>
                <FormLabel>School email</FormLabel>
                <InputGroup>
                  <Input
                    placeholder="name"
                    value={emailEditValue}
                    onChange={(e) => {
                      const [local, domain] = e.target.value.trim().toLowerCase().split('@');
                      setEmailDomainWarn(domain !== undefined && domain !== '' && !SCHOOL_DOMAIN.startsWith(domain));
                      setEmailEditValue(local);
                    }}
                  />
                  <InputRightAddon>@{SCHOOL_DOMAIN}</InputRightAddon>
                </InputGroup>
                {emailDomainWarn && <Text fontSize="xs" color="red.500" mt={1}>Only @{SCHOOL_DOMAIN} accounts are allowed.</Text>}
                {!emailDomainWarn && !!emailEditValue && !emailValid && <Text fontSize="xs" color="red.500" mt={1}>Use letters, numbers, dots, dashes or underscores only.</Text>}
              </FormControl>
              <ChakraButton colorScheme="blue" w="100%" onClick={saveEmail} isLoading={emailSaving} isDisabled={!emailValid || emailUnchanged}>Save email</ChakraButton>
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
                Use this to fix a name copied wrongly from the Google account. Appointments stay linked to the account.
              </Text>
              <FormControl isRequired mb={4}>
                <FormLabel>Full name</FormLabel>
                <Input value={nameEditValue} onChange={(e) => setNameEditValue(e.target.value)} />
              </FormControl>
              <ChakraButton colorScheme="blue" w="100%" onClick={saveName} isLoading={nameSaving}>Save name</ChakraButton>
            </ModalBody>
          </ModalContent>
        </Modal>

        <AdminEditAccountModal user={accountEdit} onClose={() => setAccountEdit(null)} onSaved={fetchAllData} onChangeEmail={u => { setAccountEdit(null); openEmailEdit(u); }} />
        <Modal isOpen={!!idEdit} onClose={() => setIdEdit(null)} isCentered>
          <ModalOverlay />
          <ModalContent>
            <ModalHeader>{idEdit?.role === 'STUDENT' ? 'School ID' : 'Faculty ID'} — {idEdit?.name}</ModalHeader>
            <ModalCloseButton />
            <ModalBody pb={6}>
              <Box mb={5}>
                <IdTray kind={idEdit?.role === 'STUDENT' ? 'STUDENT' : 'FACULTY'} value={idEditValue} onChange={setIdEditValue} />
              </Box>
              <ChakraButton
                colorScheme="blue" w="100%" onClick={saveId} isLoading={idSaving}
                isDisabled={!isIdComplete(idEdit?.role === 'STUDENT' ? 'STUDENT' : 'FACULTY', idEditValue)}
              >Save ID</ChakraButton>
            </ModalBody>
          </ModalContent>
        </Modal>

        <Modal isOpen={!!statusTarget} onClose={() => !statusSaving && setStatusTarget(null)} isCentered>
          <ModalOverlay />
          <ModalContent>
            <ModalHeader>{isAccountDisabled(statusTarget) ? 'Enable account' : 'Disable account'} — {statusTarget?.name}</ModalHeader>
            <ModalCloseButton />
            <ModalBody>
              <Text fontSize="sm" color={mutedText}>
                {isAccountDisabled(statusTarget)
                  ? 'This account will be able to sign in again and will show up in booking lists.'
                  : 'This account will not be able to sign in and will be hidden from booking lists. Their appointments, ID and records are kept, and you can enable it again any time.'}
              </Text>
            </ModalBody>
            <ModalFooter gap={2}>
              <ChakraButton variant="ghost" onClick={() => setStatusTarget(null)} isDisabled={statusSaving}>Cancel</ChakraButton>
              <ChakraButton colorScheme={isAccountDisabled(statusTarget) ? 'green' : 'red'} onClick={saveStatus} isLoading={statusSaving}>
                {isAccountDisabled(statusTarget) ? 'Enable account' : 'Disable account'}
              </ChakraButton>
            </ModalFooter>
          </ModalContent>
        </Modal>
      </Box>
      <AppointmentDetailsDrawer aptId={detailsId} onClose={() => setDetailsId(null)} />
    </DashboardShell>
  );
}
