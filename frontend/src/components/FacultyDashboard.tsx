"use client";

import React, { useEffect, useState, useRef, useMemo } from 'react';
import { formatDate } from './dateUtils';
import NoticeCalendarPicker from './NoticeCalendarPicker';
import type { PickedWhen } from './NoticeCalendarPicker';
import BroadcastBanner from './BroadcastBanner';
import {
  Box, Heading, Table, Thead, Tbody, Tr, Th, Td, Badge, Text, 
  Button as ChakraButton, Input, HStack, useToast, FormControl, 
  FormLabel, Flex, VStack, Textarea, Tabs, TabList, TabPanels, Tab, TabPanel
} from '@chakra-ui/react';
import { authFetch } from './authFetch';
import ProfileGate from './ProfileGate';
import { hasStarted } from './appointmentStatus';
import type { AvailableWindow, RequestRow } from './appointmentStatus';
import AppointmentDetailsDrawer from './AppointmentDetailsDrawer';
import { useDeepLink } from '../utils/useDeepLink';
import CancelReasonPicker, { FACULTY_CANCEL_REASONS, FACULTY_MISSED_REASONS } from './CancelReasonPicker';
import BulkCancelModal from './BulkCancelModal';
import FacultyAnalytics from './FacultyAnalytics';
import DashboardShell from './DashboardShell';
import WelcomeHeader from './WelcomeHeader';
import ProfilePage from './ProfilePage';
import PageTitle from './PageTitle';
import type { IconName } from './NavIcon';
import RequestList from './RequestList';
import ConfirmAction from './ConfirmAction';
import ConsultationPrintForm, { printConsultationForm } from './ConsultationPrintForm';
import type { ConfirmConfig } from './ConfirmAction';
import { PAGE_PAD, useNavPalette } from '../utils/uiTokens';
import { visibleDays } from '../utils/daySettings';
import { friendlyError, responseError } from '../utils/friendlyError';
import ExportBar from './ExportBar';
import SearchableSelect from './SearchableSelect';
import SchedulePdfImporter from './SchedulePdfImporter';
import ClassGridEditor from './ClassGridEditor';
import { cohortConfig } from '../data/cohortConfig';
import { dayHeading, groupByDay, manilaDay } from '../utils/logDays';
import { GENDER_OPTIONS, matchesGender, parseCohort, GenderBadge, PersonCell, FilterField, FilterPanel } from './PeopleUi';
import HistoryPage from './HistoryPage';
import { usePersistentPage } from '../utils/usePersistentPage';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

type Page      = "status" | "schedule" | "requests" | "log" | "analytics" | "profile" | "hours" | "history";
type ViewMode  = "week" | "day";
type EventType = "teaching" | "appointment" | "consultation" | "note";

interface ScheduleEvent {
  id:          string;
  subject:     string;     
  section:     string;     
  room:        string;     
  type:        EventType;
  completed?:  boolean;
  dayOfWeek:   number;
  startHour:   number;
  startMinute: number;
  endHour:     number;
  endMinute:   number;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS & HELPERS
// ─────────────────────────────────────────────────────────────────────────────

// Up to seven columns, Monday first (utils/daySettings.ts decides which show). The server stores Sunday as 0 and Monday to Saturday as 1-6.
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// Consultation hours are Monday to Friday only, so the pickers offer five days (values 1-5).
const CONSULT_DAY_LABELS = DAY_LABELS.slice(0, 5);
// Stored day (0 = Sunday ... 6 = Saturday) -> column on screen (0 = Monday ... 6 = Sunday)
const columnOfStoredDay = (d: number) => (d + 6) % 7;
const timeToMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const START_HOUR = 7;
const END_HOUR   = 20;
const SLOT_PX = 30;

const INTERVENTION_OPTIONS = [
  'Provided academic guidance',
  'Explained or clarified concepts',
  'Reviewed student work or requirements',
  'Demonstrated a procedure or solution',
  'Recommended learning resources',
  'Referred to another office or person',
] as const;

const interventionChoice = (value = '') =>
  INTERVENTION_OPTIONS.includes(value as typeof INTERVENTION_OPTIONS[number]) ? value : value ? 'Others' : '';

const interventionOtherText = (value = '') =>
  value && value !== 'Others' && !INTERVENTION_OPTIONS.includes(value as typeof INTERVENTION_OPTIONS[number]) ? value : '';

const TOTAL_SLOTS = (END_HOUR - START_HOUR) * 2;
const GRID_HEIGHT = TOTAL_SLOTS * SLOT_PX;

function getWeekDates(offset: number): Date[] {
  const today  = new Date();
  const dow    = today.getDay(); 
  const monday = new Date(today);
  monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1) + offset * 7);
  monday.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

function formatWeekLabel(dates: Date[]): string {
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const s = dates[0];
  const e = dates[dates.length - 1];
  return `${MONTHS[s.getMonth()]} ${s.getDate()} – ${MONTHS[e.getMonth()]} ${e.getDate()}, ${e.getFullYear()}`;
}

function formatHour(hour: number): string {
  const h = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  return `${h}${hour >= 12 ? "PM" : "AM"}`;
}

export const formatTime = (timeStr: string) => {
  if (!timeStr) return '';
  const [hour, minute] = timeStr.split(':');
  const h = parseInt(hour, 10);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const standardHour = h % 12 || 12;
  return `${standardHour}:${minute} ${ampm}`;
};

function isToday(date: Date): boolean {
  const t = new Date();
  return (
    date.getDate()     === t.getDate()  &&
    date.getMonth()    === t.getMonth() &&
    date.getFullYear() === t.getFullYear()
  );
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function timeToMinutes(t: string): number {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// True if the time range aStart-aEnd overlaps bStart-bEnd at all (times given as 'HH:MM')
function timeRangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return timeToMinutes(aStart) < timeToMinutes(bEnd) && timeToMinutes(bStart) < timeToMinutes(aEnd);
}

function getEventPos(event: ScheduleEvent): { top: number; height: number } {
  const startSlot = (event.startHour - START_HOUR) * 2 + event.startMinute / 30;
  const endSlot   = (event.endHour   - START_HOUR) * 2 + event.endMinute   / 30;
  return {
    top:    Math.max(0, startSlot) * SLOT_PX,
    height: Math.max(28, (endSlot - startSlot) * SLOT_PX - 2),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

// The Dean's own consultation pages are these same pages, shown inside the Dean's portal: pass `embeddedPage` and the
// component draws only that page (no menu, no welcome header). The Dean cannot import a schedule PDF yet (needs the adviser), so
// `canImportSchedule` is false for him. His hours may total 30 minutes to 4 hours (utils/consultationHoursRule.js on the server).
const EmbeddedFrame = ({ children }: { children?: React.ReactNode } & Record<string, unknown>) => <>{children}</>;

interface FacultyDashboardProps { embeddedPage?: Page; role?: 'FACULTY' | 'DEAN'; canImportSchedule?: boolean }

export default function FacultyDashboard({ embeddedPage, role = 'FACULTY', canImportSchedule = true }: FacultyDashboardProps = {}) {
  const isDean = role === 'DEAN';
  const embedded = embeddedPage !== undefined;
  const Frame: React.ComponentType<any> = embedded ? EmbeddedFrame : DashboardShell;
  const toast = useToast();
  const palette = useNavPalette();
  
  const userId = localStorage.getItem('userId');
  const userName = localStorage.getItem('userName');
  const credentialReviewRequired = !embedded && localStorage.getItem('credentialConfirmationRequired') === 'true';

  // ── UI State ─────────────────────────────────────────────────────────────────
  const facultyPages = ["status", "schedule", "requests", "log", "analytics", "profile", "hours", "history"] as const;
  const [activePage, setActivePage] = usePersistentPage<Page>(
    'faculty-dashboard-page', facultyPages, credentialReviewRequired ? 'profile' : 'schedule',
    embeddedPage || (credentialReviewRequired ? 'profile' : undefined), !embedded,
  );
  // Notification links: ?page= switches page, ?apt= opens that appointment's details
  const { aptId, closeApt } = useDeepLink<Page>(embedded ? [] : credentialReviewRequired ? ['profile'] : facultyPages, setActivePage); // embedded: the Dean dashboard handles links itself
  useEffect(() => { if (credentialReviewRequired) closeApt(); }, [credentialReviewRequired, closeApt]);
  const [weekOffset, setWeekOffset] = useState(0);
  const [scheduleTab, setScheduleTab] = useState<'view' | 'edit'>('view'); // Master Schedule: weekly view or Edit Schedule
  const [importOpen, setImportOpen] = useState(false); // Master Schedule: import my schedule from a scanned PDF
  const [showWeekend, setShowWeekend] = useState(false); // display preference: reveal empty Saturday / Sunday columns
  // Phones open on one day at a time; the 7-column week grid needs a wider screen.
  const [viewMode,   setViewMode]   = useState<ViewMode>(() => (typeof window !== "undefined" && window.innerWidth < 768 ? "day" : "week"));
  const [focusDay,   setFocusDay]   = useState(0);       
  
  // ── Data State ───────────────────────────────────────────────────────────────
  const [myStatus, setMyStatus] = useState('');          // the manual status being chosen in the form
  const [myDuration, setMyDuration] = useState('');       // 15 | 30 | 60 | 120 | UNTIL | EOD
  const [myUntil, setMyUntil] = useState('');             // "HH:MM", used when duration is UNTIL
  const [myCurrent, setMyCurrent] = useState<any>(null);  // my effective status from the server
  const [isUpdating, setIsUpdating] = useState(false);
  const [mySchedule, setMySchedule] = useState<any[]>([]);
  const [myConsultHours, setMyConsultHours] = useState<any[]>([]);
  const [myAppointments, setMyAppointments] = useState<any[]>([]);
  // Post a Notice form + my upcoming notices
  const [myNotices, setMyNotices] = useState<any[]>([]);
  const [nType, setNType] = useState('');              // IN_MEETING | ON_LEAVE
  const [nStartDate, setNStartDate] = useState('');    // "YYYY-MM-DD"
  const [nEndDate, setNEndDate] = useState('');        // leave only
  const [nStartTime, setNStartTime] = useState('');    // meeting only
  const [nEndTime, setNEndTime] = useState('');        // meeting only
  const [nReason, setNReason] = useState('');
  const [nReasonOther, setNReasonOther] = useState('');
  const [nMakeUp, setNMakeUp] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [confirmCfg, setConfirmCfg] = useState<ConfirmConfig | null>(null); // the "Are you sure?" dialog for save buttons
  const [detailsId, setDetailsId] = useState<string | null>(null); // the request whose View Details panel is open
  // Faculty's own private calendar notes — date-specific (not recurring), e.g. { _id, date: 'YYYY-MM-DD', startTime, endTime, text }
  const [personalEvents, setPersonalEvents] = useState<any[]>([]);
  const [noteModal, setNoteModal] = useState<{ date: string; startTime: string; endTime: string; text: string; editingId: string | null } | null>(null);
  const [isSavingNote, setIsSavingNote] = useState(false);

  const [consultBlocks, setConsultBlocks] = useState<{dayOfWeek: number, startTime: string, endTime: string}[]>([]);
  // Load the faculty's already-saved consultation-hour blocks into the editor once,
  // so "Fixed Consultation Hours" doesn't start blank (0.0/4.0) when 4 hours are
  // already committed and visible on the Master Schedule.
  const hasSyncedConsultBlocksRef = useRef(false);
  useEffect(() => {
    if (myConsultHours.length > 0 && !hasSyncedConsultBlocksRef.current) {
      setConsultBlocks(myConsultHours.map((b: any) => ({
        dayOfWeek: b.dayOfWeek,
        startTime: b.startTime,
        endTime: b.endTime,
      })));
      hasSyncedConsultBlocksRef.current = true;
    }
  }, [myConsultHours]);

  const totalMinutes = consultBlocks.reduce((sum, b) => {
    if (!b.startTime || !b.endTime) return sum;
    const [sh, sm] = b.startTime.split(':').map(Number);
    const [eh, em] = b.endTime.split(':').map(Number);
    return sum + ((eh * 60 + em) - (sh * 60 + sm));
  }, 0);
  const totalHours = (totalMinutes / 60).toFixed(1);
  const isValidTotal = isDean ? totalMinutes >= 30 && totalMinutes <= 240 : totalMinutes === 240; // faculty: exactly 4 hours; Dean: 30 minutes to 4 hours

  const addBlock = () => setConsultBlocks([...consultBlocks, { dayOfWeek: 1, startTime: '', endTime: '' }]);
  const removeBlock = (index: number) => setConsultBlocks(consultBlocks.filter((_, i) => i !== index));
  const updateBlock = (index: number, field: string, value: any) => {
    const updated = [...consultBlocks];
    updated[index] = { ...updated[index], [field]: value };
    setConsultBlocks(updated);
  };

  const [consultLog, setConsultLog] = useState<any[]>([]);
  const [logForm, setLogForm] = useState<{ [id: string]: { casePresented: string; interventionTaken: string } }>({});
  const [savingLogId, setSavingLogId] = useState<string | null>(null);
  // Shown right after a consultation is successfully signed off.
  const [completionModal, setCompletionModal] = useState<{ studentName: string; studentSection: string } | null>(null);

const fetchLog = () => {
  authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/consultation-log/${userId}`)
    .then(r => r.json())
    .then(data => setConsultLog(Array.isArray(data) ? data : []))
    .catch(() => {});
};
useEffect(() => { fetchLog(); }, []);

const submitLogEntry = async (aptId: string) => {
  const apt = myAppointments.find(a => a._id === aptId);
  const draft = logForm[aptId] || { casePresented: '', interventionTaken: '' };
  const entry = {
    casePresented: String(apt?.reason ?? '').trim(), // not editable: always the Purpose of Meeting
    interventionTaken: draft.interventionTaken === 'Others' ? '' : draft.interventionTaken.trim(),
  };
  if (!entry.casePresented || !entry.interventionTaken) {
    toast({
      title: 'Complete the consultation details',
      description: 'Enter the case presented and choose an intervention. If you select Others, describe it.',
      status: 'warning',
      duration: 3500,
    });
    return;
  }
  try {
    const response = await authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/appointment/${aptId}/complete`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry)
    });
    const data = await response.json();
    if (!response.ok) throw responseError(response, data.error || 'Could not complete the consultation. Please try again.');
    fetchLog();
    setCompletionModal({ studentName: apt?.studentName || 'Student', studentSection: apt?.studentSection || '' });
    fetchData();
  } catch (error: any) {
    toast({ title: 'Failed', description: friendlyError(error, 'Could not complete the consultation. Please try again.'), status: 'error' });
  }
};

const updateSavedLogField = (aptId: string, field: 'interventionTaken', value: string) => { // the case presented is read-only
  setConsultLog(prev => prev.map(apt => apt._id === aptId ? { ...apt, [field]: value } : apt));
};

const saveConsultLogChanges = async (apt: any) => {
  const casePresented = String(apt.casePresented || apt.reason || '').trim();
  const interventionTaken = apt.interventionTaken === 'Others' ? '' : String(apt.interventionTaken || '').trim();
  if (!casePresented || !interventionTaken) {
    toast({
      title: 'Complete the consultation details',
      description: 'Enter the case presented and choose an intervention. If you select Others, describe it.',
      status: 'warning',
      duration: 3500,
    });
    return;
  }
  setSavingLogId(apt._id);
  try {
    const response = await authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/appointment/${apt._id}/consultation-log`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        casePresented,
        interventionTaken,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw responseError(response, data.error || 'Could not update this consultation log. Please try again.');
    setConsultLog(prev => prev.map(row => row._id === apt._id ? data.appointment : row));
    toast({ title: 'Consultation log updated', status: 'success', duration: 2500 });
  } catch (error: any) {
    toast({ title: 'Could not save changes', description: friendlyError(error, 'Could not update this consultation log. Please try again.'), status: 'error' });
  } finally {
    setSavingLogId(null);
  }
};

// Extra WEEKLY consultation hours in vacant time, on top of the 4 official weekly hours
  const [addedHours, setAddedHours] = useState<any[]>([]);
  const [addedForm, setAddedForm] = useState({ dayOfWeek: 1, startTime: '', endTime: '' });
  const loadAddedHours = () => {
    authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/added-hours`)
      .then(res => res.json())
      .then(data => setAddedHours(Array.isArray(data) ? data : []))
      .catch(() => {});
  };
  useEffect(() => { loadAddedHours(); }, []);

  const addExtraHours = async () => {
    try {
      const response = await authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/added-hours`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addedForm)
      });
      const data = await response.json();
      if (!response.ok) throw responseError(response, data.error || 'Could not add consultation hours. Please try again.');
      toast({ title: 'Added hours saved', status: 'success' });
      setAddedForm({ dayOfWeek: addedForm.dayOfWeek, startTime: '', endTime: '' });
      loadAddedHours();
    } catch (error: any) {
      toast({ title: 'Could not add hours', description: friendlyError(error, 'Could not add consultation hours. Please try again.'), status: 'error', position: 'top' });
    }
  };
  const removeExtraHours = async (id: string) => {
    try {
      const response = await authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/added-hours/${id}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw responseError(response, data.error || 'Could not remove consultation hours. Please try again.');
      loadAddedHours();
    } catch (error: any) {
      toast({ title: 'Could not remove', description: friendlyError(error, 'Could not remove consultation hours. Please try again.'), status: 'error', position: 'top' });
    }
  };

const saveConsultationHours = async () => {
  if (!isValidTotal) {
    return toast({ title: 'Invalid Total', description: isDean ? `Must be between 30 minutes and 4 hours. Currently ${totalHours} hours.` : `Must total exactly 4 hours. Currently ${totalHours} hours.`, status: 'warning' });
  }
  try {
    const response = await authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/consultation-hours`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ facultyId: userId, hours: consultBlocks })
    });
    const data = await response.json();
    if (!response.ok) throw responseError(response, data.error || 'Could not save consultation hours. Please try again.');
    toast({ title: 'Saved', description: data.message, status: 'success' });
  } catch (error: any) {
    toast({ title: 'Failed', description: friendlyError(error, 'Could not save consultation hours. Please try again.'), status: 'error' });
  }
};

  // ── Derived values ────────────────────────────────────────────────────────
  // ── Consultation Log filters: Gender, Program, Year, Section, Sort by date, Search ──
  const [logSearch, setLogSearch] = useState('');
  const [logGender, setLogGender] = useState('');
  const [logProgram, setLogProgram] = useState('');
  const [logYear, setLogYear] = useState('');
  const [logSection, setLogSection] = useState('');
  const [logSort, setLogSort] = useState<'desc' | 'asc'>('desc'); // order of the day groups
  const [logDay, setLogDay] = useState(''); // one chosen day ("YYYY-MM-DD"): the day requested for pending rows, the day saved for saved rows
  const logFiltersActive = !!(logSearch || logGender || logProgram || logYear || logSection || logDay || logSort !== 'desc');
  const clearLogFilters = () => { setLogSearch(''); setLogGender(''); setLogProgram(''); setLogYear(''); setLogSection(''); setLogDay(''); setLogSort('desc'); };
  const matchesLogFilters = (apt: any) => {
    const section = apt.studentSection || '';
    const c = parseCohort(section);
    const q = logSearch.trim().toLowerCase();
    return matchesGender(apt.studentId?.gender, logGender) &&
      (!logProgram || c.program === logProgram || section.startsWith(logProgram)) &&
      (!logYear || c.year === logYear) &&
      (!logSection || c.section === logSection) &&
      (!q || (apt.studentName || '').toLowerCase().includes(q) || (apt.casePresented || apt.reason || '').toLowerCase().includes(q));
  };
  // Pending consultations are grouped by the day the student REQUESTED; saved consultations by the day they were SAVED.
  const requestedDayOf = (a: any) => manilaDay(a.createdAt);
  const savedDayOf = (a: any) => manilaDay(a.completedAt);
  const signOffAll = myAppointments.filter(a => a.status === 'APPROVED'); // only approved consultations can be signed off; missed ones cannot
  const pendingSignOff = signOffAll.filter(a => matchesLogFilters(a) && (!logDay || requestedDayOf(a) === logDay));
  const savedLog = consultLog.filter(a => matchesLogFilters(a) && (!logDay || savedDayOf(a) === logDay));
  const signOffGroups = groupByDay(pendingSignOff, requestedDayOf, a => a.createdAt || '', logSort);
  const savedGroups = groupByDay(savedLog, savedDayOf, a => a.completedAt || '', logSort);
  const dayRow = (day: string, verb: string, none: string) => (
    <Tr><Td colSpan={7} py={2} fontWeight="700" fontSize="sm" bg="blackAlpha.50" _dark={{ bg: 'whiteAlpha.100' }} color={textColor}>{day ? `${verb} ${dayHeading(day)}` : none}</Td></Tr>
  );

  const weekDates = useMemo(() => getWeekDates(weekOffset), [weekOffset]);
  // Monday to Friday always. Saturday / Sunday only when this faculty has a class that day, or "Show weekend" is on
  // (a weekend column that holds a class is always shown). Weekend columns are for notes only: no consultation hours or requests.
  const weekColumns = visibleDays({ classDays: mySchedule.map((c: any) => c.dayOfWeek), showWeekend }).map(columnOfStoredDay);
  const weekendHasClass = mySchedule.some((c: any) => c.dayOfWeek === 0 || c.dayOfWeek === 6);
  const weekLabel = formatWeekLabel(weekDates.slice(0, Math.max(...weekColumns) + 1));
  const visibleDayIndices = viewMode === "week" ? weekColumns : [focusDay];

  // ── Color tokens (Synced with Chakra Dark Mode) ────────────────────────────
  const dk = palette.dk;
  const C = {
    pageBg:    palette.pageBg,
    sidebar:   palette.sidebar,
    surface:   palette.surface,
    surfaceAlt:dk ? "#0d1828" : "#f8fafc",
    border:    palette.border,
    borderFaint:dk? "#162035" : "#f0f3f7",
    text:      palette.text,
    textMid:   palette.textMid,
    navText:   palette.navText,
    navActive: palette.navActive,
    navBg:     palette.navBg,
    teach:     "#1d4ed8",
    teachBg:   dk ? "#162340"   : "#dbeafe",
    teachText: dk ? "#93c5fd"   : "#1e40af",
    consult: "#8b5cf6", // purple, distinct from teach (blue) and appt (green)
    consultBg:   dk ? "#241b42" : "#ede9fe",
    consultText: dk ? "#c4b5fd" : "#5b21b6",
    appt:      "#059669",
    apptBg:    dk ? "#0d2e22"   : "#d1fae5",
    apptText:  dk ? "#6ee7b7"   : "#065f46",
    note:      "#d97706", // amber, distinct from the three existing event colors
    noteBg:    dk ? "#3a2a0d"   : "#fef3c7",
    noteText:  dk ? "#fcd34d"   : "#92400e",
    todayBorder: "#2563eb",
    todayHead:   dk ? "#0f2745" : "#eff6ff",
    todayBand:   dk ? "rgba(37,99,235,0.06)" : "rgba(219,234,254,0.28)",
  };

  const btnBase: React.CSSProperties = {
    border: "none", cursor: "pointer", fontFamily: "inherit", letterSpacing:"0.01em",
  };

  const cardBg = palette.surface;
  const borderColor = palette.border;
  const textColor = palette.text;
  const mutedText = palette.textMid;

  // ── API Functions ────────────────────────────────────────────────────────
  const fetchData = () => {
    authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/status`)
      .then((res) => res.json())
      .then((data) => {
        if (userId && Array.isArray(data)) setMyCurrent(data.find((f: any) => f._id === userId) || null);
      });
      
    if (userId) {
      authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/appointments/me/${userId}`)
        .then(res => res.json())
        .then(data => setMyAppointments(data));
        
            authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/my-schedule/${userId}`)
        .then(res => res.json())
        .then(data => setMySchedule(data));

      authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/consultation-hours/${userId}`)
        .then(res => res.json())
        .then(data => setMyConsultHours(data));

      authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/notices/mine`)
        .then(res => res.json())
        .then(data => setMyNotices(Array.isArray(data) ? data : []))
        .catch(() => setMyNotices([]));

      authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/notes/${userId}`)
        .then(res => res.json())
        .then(data => setPersonalEvents(Array.isArray(data) ? data : []))
        .catch(() => setPersonalEvents([]));
    }
  };

  useEffect(() => {
    fetchData();
    const intervalId = setInterval(fetchData, 5000);
    return () => clearInterval(intervalId);
  }, [userId]);

  // ── Existing Status Handlers ────────────────────────────────────────
  const STATUS_LABELS: Record<string, string> = {
    IN_CLASS: 'In Class', IN_CONSULTATION: 'In Consultation', CONSULTATION_HOURS: 'Consultation Hours', VACANT: 'Vacant', OFF_SCHEDULE: '--',
    IN_MEETING: 'In a Meeting', ON_BREAK: 'On Break', OUT_OF_OFFICE: 'Out of Office', ON_LEAVE: 'On Leave',
  };
  const STATUS_COLORS: Record<string, string> = {
    IN_CLASS: 'orange', IN_CONSULTATION: 'purple', CONSULTATION_HOURS: 'teal', VACANT: 'green', OFF_SCHEDULE: 'gray',
    IN_MEETING: 'blue', ON_BREAK: 'yellow', OUT_OF_OFFICE: 'gray', ON_LEAVE: 'red',
  };
  // Only these are chosen by hand. Each has its own list of "how long" choices.
  const MANUAL_STATUS_OPTIONS = ['IN_MEETING', 'ON_BREAK', 'OUT_OF_OFFICE', 'ON_LEAVE'];
  const DURATION_CHOICES: Record<string, [string, string][]> = {
    ON_BREAK: [['15', '15 minutes'], ['30', '30 minutes'], ['60', '1 hour']],
    IN_MEETING: [['30', '30 minutes'], ['60', '1 hour'], ['120', '2 hours'], ['UNTIL', 'Until a time...']],
    OUT_OF_OFFICE: [['UNTIL', 'Until a time...'], ['EOD', 'Rest of today']],
    ON_LEAVE: [['EOD', 'Rest of today']],
  };
  const fmtUntil = (iso?: string) => iso ? new Date(iso).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' }) : '';
  const statusSourceText = (c: any) => {
    if (!c) return '';
    if (c.status === 'OFF_SCHEDULE') return 'Outside your class schedule (7 AM until your last class)';
    const until = c.statusUntil ? ` until ${fmtUntil(c.statusUntil)}` : '';
    return c.statusSource === 'manual' ? `Set by you${until}` : `Scheduled${until}`;
  };
  const durationLabel = () => (DURATION_CHOICES[myStatus] || []).find(([v]) => v === myDuration)?.[1] || '';

  // Times for "Until a time..." in 30-minute steps from the next half-hour (Manila), so nothing is typed.
  const untilTimeOptions = (() => {
    const t = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hour12: false });
    const [h, m] = t.split(':').map(Number);
    const out: { value: string; label: string }[] = [];
    for (let min = Math.ceil((h * 60 + m + 1) / 30) * 30; min <= 23 * 60 + 30; min += 30) {
      const v = `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
      out.push({ value: v, label: formatTime(v) });
    }
    return out;
  })();

  const handleUpdateMyStatus = async () => {
    setIsUpdating(true);
    try {
      const response = await authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/status-entry`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: myStatus, duration: myDuration, untilTime: myUntil })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw responseError(response, data.error || 'Could not set your status. Please try again.');
      }
      toast({ title: 'Status set!', status: 'success', duration: 2000 });
      setMyStatus(''); setMyDuration(''); setMyUntil('');
      fetchData();
    } catch (error: any) {
      toast({ title: 'Could not set status', description: friendlyError(error, 'Could not set your status. Please try again.'), status: 'error' });
    }
    setIsUpdating(false);
  };

  const handleClearMyStatus = async () => {
    if (!myCurrent?.statusEntryId) return;
    try {
      const response = await authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/status-entry/${myCurrent.statusEntryId}`, { method: 'DELETE' });
      if (!response.ok) throw responseError(response, 'Could not clear your status. Please try again.');
      toast({ title: 'Status cleared', status: 'success', duration: 2000 });
      fetchData();
    } catch (error: any) {
      toast({ title: 'Could not clear status', description: friendlyError(error, 'Could not clear your status. Please try again.'), status: 'error' });
    }
  };

  const NOTICE_REASONS: Record<string, string[]> = {
    IN_MEETING: ['Faculty meeting', 'Department meeting', 'Seminar / training', 'Official school activity', 'Other'],
    ON_LEAVE: ['Sick leave', 'Vacation leave', 'Official business', 'Emergency', 'Study leave', 'Other'],
  };
  const todayManila = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }); // "YYYY-MM-DD"
  const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' });
  const fmtClock = (iso: string) => new Date(iso).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' });
  const noticeWhen = (n: any) => {
    if (n.type === 'IN_MEETING') return `${fmtDay(n.startAt)}, ${fmtClock(n.startAt)} to ${fmtClock(n.endAt)}`;
    const lastDay = new Date(new Date(n.endAt).getTime() - 1).toISOString();
    return fmtDay(n.startAt) === fmtDay(lastDay) ? fmtDay(n.startAt) : `${fmtDay(n.startAt)} to ${fmtDay(lastDay)}`;
  };
  const noticeReasonText = (n: any) => (n.reason === 'Other' && n.reasonOther ? n.reasonOther : n.reason);
  // "Fri, Nov 20, 2026, 1:00 PM to 3:00 PM" or "Mon, Nov 23, 2026 to Wed, Nov 25, 2026"
  const whenText = (type: string, sd: string, ed: string, st: string, et: string) => {
    if (!sd) return '';
    if (type === 'IN_MEETING') return `${formatDate(sd)}, ${formatTime(st)} to ${formatTime(et)}`;
    return !ed || ed === sd ? formatDate(sd) : `${formatDate(sd)} to ${formatDate(ed)}`;
  };
  const handlePickWhen = (p: PickedWhen) => setConfirmCfg({
    title: nType === 'IN_MEETING' ? 'Use this meeting time?' : 'Use these leave days?',
    body: whenText(nType, p.startDate, p.endDate, p.startTime, p.endTime),
    confirmLabel: 'Use this',
    run: () => { setNStartDate(p.startDate); setNEndDate(p.endDate); setNStartTime(p.startTime); setNEndTime(p.endTime); },
  });
  const noticeReady = !!nType && !!nStartDate && !!nReason && (nReason !== 'Other' || !!nReasonOther.trim())
    && (nType === 'IN_MEETING' ? !!nStartTime && !!nEndTime : true);

  const handlePostNotice = async () => {
    setIsPosting(true);
    try {
      const response = await authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/notice-entry`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: nType, startDate: nStartDate, endDate: nType === 'ON_LEAVE' ? (nEndDate || nStartDate) : undefined,
          startTime: nStartTime, endTime: nEndTime, reason: nReason, reasonOther: nReasonOther, makeUpInfo: nMakeUp,
        })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw responseError(response, data.error || 'Could not announce this notice. Please try again.');
      }
      toast({ title: 'Announced to students!', status: 'success', duration: 2000 });
      setNType(''); setNStartDate(''); setNEndDate(''); setNStartTime(''); setNEndTime(''); setNReason(''); setNReasonOther(''); setNMakeUp('');
      fetchData();
    } catch (error: any) {
      toast({ title: 'Could not announce', description: friendlyError(error, 'Could not announce this notice. Please try again.'), status: 'error' });
    }
    setIsPosting(false);
  };

  const handleCancelNotice = async (id: string) => {
    try {
      const response = await authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/status-entry/${id}`, { method: 'DELETE' });
      if (!response.ok) throw responseError(response, 'Could not cancel this notice. Please try again.');
      toast({ title: 'Announcement cancelled', status: 'success', duration: 2000 });
      fetchData();
    } catch (error: any) {
      toast({ title: 'Could not cancel the announcement', description: friendlyError(error, 'Could not cancel this notice. Please try again.'), status: 'error' });
    }
  };


  // A note can't be placed on top of a teaching block or consultation hours for that day/date.
  // (Overlapping an already-approved appointment is still blocked too, to keep the slot unambiguous.)
  const isSlotBlocked = (dayIndex: number, startTime: string, endTime: string): boolean => {
    const dayEvts = dynamicEvents.filter(e => e.dayOfWeek === dayIndex && e.type !== "note");
    return dayEvts.some(e => {
      const evStart = `${String(e.startHour).padStart(2, '0')}:${String(e.startMinute).padStart(2, '0')}`;
      const evEnd = `${String(e.endHour).padStart(2, '0')}:${String(e.endMinute).padStart(2, '0')}`;
      return timeRangesOverlap(startTime, endTime, evStart, evEnd);
    });
  };

  const handleSaveNote = async () => {
    if (!noteModal || !userId) return;
    const { date, startTime, endTime, text, editingId } = noteModal;
    if (!text.trim()) {
      toast({ title: 'Note text is required', status: 'warning' }); return;
    }
    if (timeToMinutes(endTime) <= timeToMinutes(startTime)) {
      toast({ title: 'End time must be after start time', status: 'warning' }); return;
    }
    const dow = (new Date(date + 'T00:00:00').getDay() + 6) % 7; // 0=Mon ... matches DAY_LABELS indexing
    if (isSlotBlocked(dow, startTime, endTime)) {
      toast({ title: 'That time overlaps class or consultation hours', description: 'Notes can only be added to open time slots.', status: 'error', duration: 6000 });
      return;
    }

    setIsSavingNote(true);
    try {
      const url = editingId
        ? `${import.meta.env.VITE_API_URL}/api/faculty/notes/${editingId}`
        : `${import.meta.env.VITE_API_URL}/api/faculty/notes/${userId}`;
      const response = await authFetch(url, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, startTime, endTime, text: text.trim() })
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw responseError(response, err.error || 'Could not save the note. Please try again.');
      }
      toast({ title: editingId ? 'Note updated' : 'Note added', status: 'success' });
      setNoteModal(null);
      fetchData();
    } catch (error: any) {
      toast({ title: 'Could not save note', description: friendlyError(error, 'Could not save the note. Please try again.'), status: 'error' });
    } finally {
      setIsSavingNote(false);
    }
  };

  const handleDeleteNote = async () => {
    if (!noteModal?.editingId) return;
    setIsSavingNote(true);
    try {
      await authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/notes/${noteModal.editingId}`, { method: 'DELETE' });
      toast({ title: 'Note deleted', status: 'success' });
      setNoteModal(null);
      fetchData();
    } catch (error) {
      toast({ title: 'Could not delete note', status: 'error' });
    } finally {
      setIsSavingNote(false);
    }
  };

  // Approving a pending request: the professor picks a start and a length inside the free time the server worked out
  // (consultation + vacant hours, up to the next class or approved appointment). Several students may have asked for
  // the same hour; approving one never declines the others.
  const [approveDuration, setApproveDuration] = useState<Record<string, number>>({});
  const [approveStart, setApproveStart] = useState<Record<string, string>>({});
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const hhmm = (m: number) => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
  const startChoice = (apt: RequestRow): string => approveStart[apt._id] ?? apt.availableWindow?.start ?? apt.time;
  const startOptions = (w: AvailableWindow): string[] => {
    const out: string[] = [];
    for (let m = timeToMin(w.start); m < timeToMin(w.end); m += 15) out.push(hhmm(m));
    return out;
  };
  const lengthRoom = (apt: RequestRow): number => {
    const w = apt.availableWindow;
    return w ? Math.min(120, timeToMin(w.end) - timeToMin(startChoice(apt))) : (apt.duration || 60);
  };
  const lengthChoice = (apt: RequestRow): number => {
    const room = lengthRoom(apt);
    const wanted = approveDuration[apt._id] ?? apt.duration ?? 60;
    return Math.max(15, Math.min(wanted, Math.floor(room / 15) * 15));
  };
  const lengthOptions = (apt: RequestRow): number[] => {
    const out: number[] = [];
    for (let m = 15; m <= lengthRoom(apt); m += 15) out.push(m);
    return out;
  };
  const lengthText = (m: number) => (m % 60 === 0 ? `${m / 60} hour${m > 60 ? 's' : ''}` : m > 60 ? `${Math.floor(m / 60)} hr ${m % 60} min` : `${m} min`);

  const updateAppointmentStatus = async (targetApt: RequestRow, newStatus: string) => {
    try {
      const body: { status: string; time?: string; duration?: number } = { status: newStatus };
      let chosenTime = targetApt.time;
      if (newStatus === 'APPROVED' && targetApt.availableWindow) {
        chosenTime = startChoice(targetApt);
        const length = lengthChoice(targetApt);
        if (chosenTime !== targetApt.time) body.time = chosenTime;
        if (length !== targetApt.duration) body.duration = length;
      }
      const response = await authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/appointment/${targetApt._id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await response.json();
      if (!response.ok) throw responseError(response, data.error || 'Could not process the appointment. Please try again.');

      toast({ title: newStatus === 'APPROVED' && chosenTime !== targetApt.time ? `Approved for ${formatTime(chosenTime)}` : `Appointment ${newStatus}`, status: 'success' });
      fetchData(); 
    } catch (error: any) {
      toast({
        title: "Scheduling Conflict Blocked", description: friendlyError(error, 'Could not process the appointment. Please try again.'),
        status: "error", duration: 7000, isClosable: true, position: "top", 
      });
    }
  };

  // Cancel an approved consultation (asks for a reason the student will see)
  const [cancelTarget, setCancelTarget] = useState<any | null>(null);
  // 'cancel' = cancel an approved consultation; 'reject' = decline a pending request
  const [cancelMode, setCancelMode] = useState<'cancel' | 'reject'>('cancel');
  const [cancelReason, setCancelReason] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);

  const confirmCancel = async () => {
    if (!cancelTarget) return;
    setCancelBusy(true);
    try {
      const rejecting = cancelMode === 'reject';
      const response = await authFetch(
        `${import.meta.env.VITE_API_URL}/api/faculty/appointment/${cancelTarget._id}${rejecting ? '' : '/cancel'}`,
        {
          method: rejecting ? 'PUT' : 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(rejecting ? { status: 'REJECTED', reason: cancelReason } : { reason: cancelReason })
        }
      );
      const data = await response.json();
      if (!response.ok) throw responseError(response, data.error || 'Could not cancel the consultation. Please try again.');
      toast({ title: cancelMode === 'reject' ? 'Request declined' : 'Consultation cancelled', description: 'The student has been notified.', status: 'success' });
      setCancelTarget(null);
      fetchData();
    } catch (error: any) {
      toast({ title: 'Could not cancel', description: friendlyError(error, 'Could not cancel the consultation. Please try again.'), status: 'error' });
    } finally { setCancelBusy(false); }
  };

  // The student did not turn up to an approved consultation: ask for a reason (the student will see it), then mark it.
  const [missTarget, setMissTarget] = useState<any | null>(null);
  const [missReason, setMissReason] = useState('');
  const [missBusy, setMissBusy] = useState(false);

  const markNoShow = (apt: any) => { setMissReason(''); setMissTarget(apt); };

  const confirmMissedByStudent = async () => {
    if (!missTarget) return;
    setMissBusy(true);
    try {
      const response = await authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/appointment/${missTarget._id}/no-show`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: missReason })
      });
      const data = await response.json();
      if (!response.ok) throw responseError(response, data.error || 'Could not mark the consultation as missed. Please try again.');
      toast({ title: 'Marked as Missed by Student', description: 'The student has been notified, with your reason.', status: 'info' });
      setMissTarget(null);
      fetchData();
    } catch (error: any) {
      toast({ title: 'Could not update', description: friendlyError(error, 'Could not mark the consultation as missed. Please try again.'), status: 'error' });
    } finally { setMissBusy(false); }
  };

  // ── DYNAMIC DATA TRANSLATOR ──────────────────────────────────
  const dynamicEvents = useMemo(() => {
    const generated: ScheduleEvent[] = [];

    myConsultHours.forEach(block => {
      const [sH, sM] = block.startTime.split(':').map(Number);
      const [eH, eM] = block.endTime.split(':').map(Number);
      generated.push({
        id: block._id,
        subject: "Consultation Hours",
        section: "",
        room: "",
        type: "consultation",
        dayOfWeek: columnOfStoredDay(block.dayOfWeek),
        startHour: sH, startMinute: sM,
        endHour: eH, endMinute: eM
      });
    });

    mySchedule.forEach(sched => {
      const [sH, sM] = sched.startTime.split(':').map(Number);
      const [eH, eM] = sched.endTime.split(':').map(Number);
      
      let subject = sched.subject;
      let section = "";
      if (subject.includes('(')) {
          const parts = subject.split('(');
          subject = parts[0].trim();
          section = parts[1].replace(')', '').trim();
      }

      generated.push({
        id: sched._id,
        subject,
        section,
        room: sched.room,
        type: "teaching",
        dayOfWeek: columnOfStoredDay(sched.dayOfWeek), 
        startHour: sH,
        startMinute: sM,
        endHour: eH,
        endMinute: eM
      });
    });

    // Keep completed consultations visible on the master schedule too, so the
    // weekly grid still shows who/when even after sign-off — just labeled.
    const approvedApts = myAppointments.filter(a => a.status === 'APPROVED' || a.status === 'COMPLETED');
    approvedApts.forEach(apt => {
        const aptDate = new Date(apt.date);
        const dayIndex = weekDates.findIndex(wd => 
          wd.getFullYear() === aptDate.getFullYear() && 
          wd.getMonth() === aptDate.getMonth() && 
          wd.getDate() === aptDate.getDate()
        );
        
        if (dayIndex !== -1) {
          const [sH, sM] = apt.time.split(':').map(Number);
          let eH = sH + 1; 
          if (eH > 20) eH = 20; 
          
          generated.push({
              id: apt._id,
              subject: apt.studentName,
              section: apt.studentSection || '',
              room: apt.reason,
              type: "appointment",
              completed: apt.status === 'COMPLETED',
              dayOfWeek: dayIndex,
              startHour: sH,
              startMinute: sM,
              endHour: eH,
              endMinute: sM
          });
        }
    });

    return generated;
  }, [mySchedule, myAppointments, weekDates, myConsultHours]);

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  // The Approve / Reject bar the request list shows under a request that is waiting for an answer: the free time left,
  // a start and a length to choose from, then Approve or Reject. Other rows get no bar.
  const answerBar = (apt: RequestRow) => {
    if (apt.status !== 'PENDING') return null;
    if (hasStarted(apt.date, apt.time)) return <Text fontSize="xs" color={mutedText}>This request expired because the requested time has started.</Text>;
    const w = apt.availableWindow;
    return (
      <HStack spacing={3} flexWrap="wrap">
        {w && (w.minutes > 0
          ? <Text fontSize="xs" color={mutedText}>Available window: {w.label}</Text>
          : <Badge colorScheme="orange">No time left</Badge>)}
        <HStack spacing={2} flexWrap="wrap">
          {w && w.minutes > 0 && (
            <>
              <SearchableSelect size="xs" maxW="110px" portal searchable={false} clearable={false} ariaLabel="Start time" placeholder="Start time" value={startChoice(apt)}
                onChange={(v) => setApproveStart({ ...approveStart, [apt._id]: v })}
                options={startOptions(w).map(t => ({ value: t, label: formatTime(t) }))} />
              <SearchableSelect size="xs" maxW="110px" portal searchable={false} clearable={false} ariaLabel="Consultation length" placeholder="Length" value={String(lengthChoice(apt))}
                onChange={(v) => setApproveDuration({ ...approveDuration, [apt._id]: Number(v) })}
                options={lengthOptions(apt).map(m => ({ value: String(m), label: lengthText(m) }))} />
              <ChakraButton size="xs" colorScheme="green" onClick={() => updateAppointmentStatus(apt, 'APPROVED')}>Approve</ChakraButton>
            </>
          )}
          <ChakraButton size="xs" colorScheme="red" onClick={() => { setCancelReason(''); setCancelMode('reject'); setCancelTarget(apt); }}>Reject</ChakraButton>
        </HStack>
      </HStack>
    );
  };

  // Master Schedule has two tabs: the weekly view and Edit Schedule (class grid + Import Schedule PDF). Not for the Dean.
  const scheduleTabBar = canImportSchedule ? (
    <HStack spacing={2} px={{ base: 3, md: 6 }} pt={3} pb={2} borderBottom={`1px solid ${C.border}`} background={C.surface} flexShrink={0} className="no-print">
      {([['view', 'Weekly view'], ['edit', 'Edit Schedule']] as const).map(([key, label]) => (
        <ChakraButton key={key} size="sm" borderRadius="full" variant={scheduleTab === key ? 'solid' : 'ghost'} colorScheme="blue"
          onClick={() => { setScheduleTab(key); if (key === 'view') fetchData(); }}>{label}</ChakraButton>
      ))}
    </HStack>
  ) : null;

  return (
    <>
    <Frame
      portalLabel="Faculty Portal"
      userName={userName || ''}
      profileRequired={credentialReviewRequired}
      showMailbox={!credentialReviewRequired}
      extras={<ProfileGate role="FACULTY" />}
      nav={([
        { page: "schedule",  section: "Consultations", icon: "calendar",  label: "Master Schedule" },
        { page: "requests",  section: "Consultations", icon: "inbox",     label: "Requests", badge: myAppointments.filter(a => a.status === 'PENDING').length },
        { page: "log",       section: "Consultations", icon: "clipboard", label: "Consultation Log" },
        { page: "status",    section: "Availability",  icon: "activity",  label: "Status & Notices" },
        { page: "hours",     section: "Availability",  icon: "clock",     label: "Consultation Hours" },
        { page: "analytics", section: "Insights",      icon: "chart",     label: "My Analytics" },
        { page: "history", section: "Insights",        icon: "file",      label: "History" },
        { page: "profile",   section: "Account",       icon: "user",      label: "My Profile" },
      ] as { page: Page; section: string; icon: IconName; label: string; badge?: number }[]).map(({ page, ...item }) => ({
        key: page, ...item, active: activePage === page, onClick: () => { setActivePage(page); if (page === 'schedule') fetchData(); }, // reload so edits and imports show on the Master Schedule
      }))}
    >
        {!embedded && <WelcomeHeader name={userName || ''} actions={activePage === 'analytics' ? <ExportBar solid csvPath="/api/analytics/me.csv" fileBase="my-analytics" /> : undefined} />}
        {!embedded && <BroadcastBanner userRole="FACULTY" />}

        {/* ───────────────────────────────────────────────────────────────
            PAGE: MASTER SCHEDULE
        ─────────────────────────────────────────────────────────────── */}
        {activePage === "schedule" && scheduleTab === 'view' && (
          <Box display="flex" flexDirection="column" h="100%" overflowY="auto">
            {scheduleTabBar}
            {/* Toolbar */}
            <div style={{ padding: "12px clamp(12px, 3vw, 24px)", borderBottom: `1px solid ${C.border}`, background: C.surface, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, flexWrap: "wrap", gap: "12px" }}>
              <div>
                {viewMode === "day" ? (
                  <>
                    <button className="touch-target" onClick={() => setViewMode("week")} style={{ ...btnBase, background: "transparent", color: "#2563eb", fontSize: "11px", padding: 0, marginBottom: "2px", display: "flex", alignItems: "center", gap: "4px" }}>‹ Back to Week</button>
                    <h1 style={{ fontSize: "16px", fontWeight: 700, margin: 0, letterSpacing: "-0.015em" }}>
                      {weekDates[focusDay].toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
                    </h1>
                  </>
                ) : (
                  <>
                    <h1 style={{ fontSize: "16px", fontWeight: 700, margin: 0, letterSpacing: "-0.015em" }}>Master Schedule</h1>
                    <p style={{ fontSize: "11px", color: C.textMid, margin: "2px 0 0" }}>{weekLabel}</p>
                  </>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <button className="touch-target" aria-pressed={showWeekend} title={weekendHasClass ? "A weekend column that has classes is always shown" : "Show empty Saturday and Sunday columns (weekends are for notes only)"} onClick={() => setShowWeekend(v => !v)} style={{ ...btnBase, padding: "6px 12px", borderRadius: "6px", border: `1px solid ${C.border}`, background: showWeekend ? "#2563eb" : C.surface, color: showWeekend ? "#fff" : C.textMid, fontSize: "12px" }}>Show weekend</button>
                <div className="toolbar-divider" style={{ width: "1px", height: "24px", background: C.border }} />
                <button className="touch-target" onClick={() => setWeekOffset(0)} style={{ ...btnBase, padding: "6px 12px", borderRadius: "6px", border: `1px solid ${C.border}`, background: C.surface, color: C.textMid, fontSize: "12px" }}>Today</button>
                <div style={{ display: "flex" }}>
                  {(["‹", "›"] as const).map((arrow, i) => (
                    <button key={arrow} className="touch-target" aria-label={i === 0 ? "Previous week" : "Next week"} onClick={() => setWeekOffset(w => w + (i === 0 ? -1 : 1))} style={{ cursor: "pointer", fontFamily: "inherit", width: "30px", height: "30px", borderStyle: "solid", borderColor: C.border, borderWidth: i === 0 ? "1px 0 1px 1px" : "1px", borderRadius: i === 0 ? "6px 0 0 6px" : "0 6px 6px 0", background: C.surface, color: C.textMid, fontSize: "17px", lineHeight: "1", display: "flex", alignItems: "center", justifyContent: "center" }}>{arrow}</button>
                  ))}
                </div>
                <div style={{ display: "flex", border: `1px solid ${C.border}`, borderRadius: "6px", overflow: "hidden" }}>
                  {(["week", "day"] as ViewMode[]).map(v => (
                    <button key={v} className="touch-target" onClick={() => setViewMode(v)} style={{ ...btnBase, padding: "6px 14px", background: viewMode === v ? "#2563eb" : C.surface, color: viewMode === v ? "#fff" : C.textMid, fontSize: "12px", fontWeight: viewMode === v ? 600 : 400, textTransform: "capitalize" }}>{v}</button>
                  ))}
                </div>
              </div>
            </div>

            {/* Schedule Grid */}
            <div style={{ padding: "clamp(12px, 3vw, 20px)", display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div style={{ overflowX: "auto", width: "100%" }}>
              <div style={{ background: C.surface, borderRadius: "10px", border: `1px solid ${C.border}`, overflow: "hidden", minWidth: viewMode === "day" ? "340px" : "620px", maxWidth: viewMode === "day" ? "480px" : "none", margin: viewMode === "day" ? "0 auto" : "0" }}>
                <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, background: C.surfaceAlt }}>
                  <div style={{ width: "58px", flexShrink: 0, borderRight: `1px solid ${C.border}` }} />
                  {visibleDayIndices.map((di, col) => {
                    const date = weekDates[di];
                    const active = isToday(date) && weekOffset === 0;
                    return (
                      <div key={di} onClick={() => { setFocusDay(di); setViewMode("day"); }} style={{ flex: 1, padding: "10px 8px 9px", textAlign: "center", cursor: "pointer", userSelect: "none", borderRight: col < visibleDayIndices.length - 1 ? `1px solid ${C.border}` : "none", background: active ? C.todayHead : "transparent", borderTop: active ? `2px solid ${C.todayBorder}` : "2px solid transparent" }}>
                        <div style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: active ? C.todayBorder : C.textMid, marginBottom: "3px" }}>{DAY_LABELS[di]}</div>
                        <div style={{ fontSize: "19px", fontWeight: active ? 700 : 400, color: active ? C.todayBorder : C.text, lineHeight: 1 }}>{date.getDate()}</div>
                      </div>
                    );
                  })}
                </div>

                <div style={{ display: "flex", height: `${GRID_HEIGHT}px`, position: "relative" }}>
                  <div style={{ width: "58px", flexShrink: 0, borderRight: `1px solid ${C.border}`, position: "relative" }}>
                    {Array.from({ length: TOTAL_SLOTS }).map((_, i) => {
                      const hour = START_HOUR + Math.floor(i / 2);
                      const isHour = i % 2 === 0;
                      return (
                        <div key={i} style={{ position: "absolute", top: `${i * SLOT_PX}px`, height: `${SLOT_PX}px`, width: "100%", borderBottom: `1px solid ${isHour ? C.border : C.borderFaint}`, display: "flex", alignItems: "flex-start", justifyContent: "flex-end", paddingRight: "8px", paddingTop: "4px", boxSizing: "border-box" }}>
                          {isHour && (<span style={{ fontSize: "9px", color: C.textMid, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{formatHour(hour)}</span>)}
                        </div>
                      );
                    })}
                  </div>

                  {visibleDayIndices.map((di, col) => {
                    const date = weekDates[di];
                    const active = isToday(date) && weekOffset === 0;
                    const dayEvts = dynamicEvents.filter(e => e.dayOfWeek === di);
                    const isoDate = toISODate(date);
                    const dayNotes = personalEvents.filter((n: any) => n.date === isoDate);
                    const isLast = col === visibleDayIndices.length - 1;

                    return (
                      <div 
                        key={di} 
                        onClick={(e) => {
                          if (viewMode === "week") {
                            setFocusDay(di);
                            setViewMode("day");
                            return;
                          }
                          // Day view: clicking an empty slot opens the add-note popup
                          const rect = e.currentTarget.getBoundingClientRect();
                          const offsetY = e.clientY - rect.top;
                          const slotIndex = Math.max(0, Math.floor(offsetY / SLOT_PX));
                          const startMin = START_HOUR * 60 + slotIndex * 30;
                          const startTime = minutesToTime(startMin);
                          const endTime = minutesToTime(Math.min(END_HOUR * 60, startMin + 60));
                          if (isSlotBlocked(di, startTime, endTime)) {
                            toast({ title: "That slot is occupied", description: "Notes can't be added on class or consultation hours.", status: "info", duration: 4000 });
                            return;
                          }
                          setNoteModal({ date: isoDate, startTime, endTime, text: '', editingId: null });
                        }}
                        style={{ 
                          flex: 1, position: "relative", borderRight: isLast ? "none" : `1px solid ${C.border}`, background: active ? C.todayBand : "transparent", cursor: viewMode === "week" ? "zoom-in" : "copy", transition: "background 0.2s ease"
                        }}
                        onMouseEnter={(e) => {
                          if (viewMode === "week" && !active) e.currentTarget.style.background = dk ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)";
                        }}
                        onMouseLeave={(e) => {
                          if (viewMode === "week" && !active) e.currentTarget.style.background = "transparent";
                        }}
                      >
                        {Array.from({ length: TOTAL_SLOTS }).map((_, i) => (
                          <div key={i} style={{ position: "absolute", top: `${i * SLOT_PX}px`, width: "100%", height: `${SLOT_PX}px`, borderBottom: `1px solid ${i % 2 === 0 ? C.border : C.borderFaint}`, pointerEvents: "none" }} />
                        ))}
                        
                        {dayEvts.map(event => {
                          const { top, height } = getEventPos(event);
                          const isTeach = event.type === "teaching";
                          const isConsult = event.type === "consultation";
                          const isAppt = event.type === "appointment"; // approved or completed (green): click opens the details panel
                          const accent = isTeach ? C.teach : isConsult ? C.consult : C.appt;
                          const bg = isTeach ? C.teachBg : isConsult ? C.consultBg : C.apptBg;
                          const textCol = isTeach ? C.teachText : isConsult ? C.consultText : C.apptText;

                          return (
                            <div key={event.id} title={`${event.subject} · ${event.section} · ${event.room}${event.completed ? ' · Completed' : ''}${isAppt ? ' · Click for details' : ''}`}
                              {...(isAppt ? { role: "button", tabIndex: 0, "aria-label": `Details of the consultation with ${event.subject}`, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setDetailsId(String(event.id)); } } } : {})}
                              onClick={(e) => { e.stopPropagation(); if (isAppt) setDetailsId(String(event.id)); }} style={{ position: "absolute", left: "3px", right: "3px", top: `${top}px`, height: `${height}px`, background: bg, borderLeft: `3px solid ${accent}`, borderRadius: "4px", padding: "4px 7px", overflow: "hidden", cursor: isAppt ? "pointer" : "default", zIndex: 1, boxSizing: "border-box", opacity: event.completed ? 0.7 : 1 }}>
                              <div style={{ fontSize: "11px", fontWeight: 700, color: textCol, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{event.subject}</div>
                              {height > 44 && (<div style={{ fontSize: "10px", color: textCol, opacity: 0.72, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{event.section}</div>)}
                              {event.completed && height > 44 && (<div style={{ fontSize: "9.5px", fontWeight: 700, color: textCol, opacity: 0.75, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: "1px", fontStyle: "italic" }}>(Completed)</div>)}
                              {!event.completed && height > 62 && (<div style={{ fontSize: "9.5px", color: textCol, opacity: 0.55, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: "1px" }}>{event.room}</div>)}
                            </div>
                          );
                        })}

                        {dayNotes.map((note: any) => {
                          const { top, height } = getEventPos({
                            id: note._id, subject: note.text, section: '', room: '', type: 'note', dayOfWeek: di,
                            startHour: Math.floor(timeToMinutes(note.startTime) / 60), startMinute: timeToMinutes(note.startTime) % 60,
                            endHour: Math.floor(timeToMinutes(note.endTime) / 60), endMinute: timeToMinutes(note.endTime) % 60,
                          });
                          return (
                            <div
                              key={note._id}
                              title={note.text}
                              onClick={(e) => { e.stopPropagation(); setNoteModal({ date: note.date, startTime: note.startTime, endTime: note.endTime, text: note.text, editingId: note._id }); }}
                              style={{ position: "absolute", left: "3px", right: "3px", top: `${top}px`, height: `${height}px`, background: C.noteBg, borderLeft: `3px solid ${C.note}`, borderRadius: "4px", padding: "4px 7px", overflow: "hidden", cursor: "pointer", zIndex: 1, boxSizing: "border-box" }}
                            >
                              <div style={{ fontSize: "11px", fontWeight: 700, color: C.noteText, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>📝 {note.text}</div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
              </div>

              <Flex justifyContent="space-between" alignItems="center" flexWrap="wrap" gap="16px">
                <div style={{ display: "flex", gap: "16px", alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "10px", color: C.textMid, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>Legend</span>
                  {[{ color: C.teach, label: "Teaching Block" }, { color: C.appt, label: "Approved Appointment" }, { color: C.consult, label: "Consultation Hours" }, { color: C.note, label: "Personal Note" }].map(({ color, label }) => (
                    <div key={label} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <div style={{ width: "10px", height: "10px", borderRadius: "3px", background: color }} />
                      <span style={{ fontSize: "11px", color: C.textMid }}>{label}</span>
                    </div>
                  ))}
                </div>

              </Flex>


            </div>
          </Box>
        )}

        {noteModal && (
          <Box
            position="fixed" top="0" left="0" right="0" bottom="0" bg="rgba(0,0,0,0.45)"
            display="flex" alignItems="center" justifyContent="center" zIndex={50}
            onClick={() => setNoteModal(null)}
          >
            <Box
              bg={cardBg} borderRadius="lg" shadow="xl" p={6} w="90%" maxW="380px"
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
            >
              <Heading size="sm" color={textColor} mb={1}>{noteModal.editingId ? 'Edit Note' : 'Add a Note'}</Heading>
              <Text fontSize="xs" color={mutedText} mb={4}>
                {new Date(noteModal.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
              </Text>
              <VStack spacing={3} align="stretch">
                <HStack>
                  <FormControl>
                    <FormLabel fontSize="xs" color={textColor}>Start</FormLabel>
                    <Input type="time" size="sm" value={noteModal.startTime} onChange={e => setNoteModal(m => m && ({ ...m, startTime: e.target.value }))} color={textColor} />
                  </FormControl>
                  <FormControl>
                    <FormLabel fontSize="xs" color={textColor}>End</FormLabel>
                    <Input type="time" size="sm" value={noteModal.endTime} onChange={e => setNoteModal(m => m && ({ ...m, endTime: e.target.value }))} color={textColor} />
                  </FormControl>
                </HStack>
                <FormControl>
                  <FormLabel fontSize="xs" color={textColor}>Note</FormLabel>
                  <Textarea size="sm" placeholder="e.g. Prep for thesis panel, grading deadline..." value={noteModal.text} onChange={e => setNoteModal(m => m && ({ ...m, text: e.target.value }))} color={textColor} rows={3} />
                </FormControl>
                <HStack justify="space-between" pt={1}>
                  {noteModal.editingId ? (
                    <ChakraButton size="sm" variant="ghost" colorScheme="red" onClick={handleDeleteNote} isLoading={isSavingNote}>Delete</ChakraButton>
                  ) : <Box />}
                  <HStack>
                    <ChakraButton size="sm" variant="ghost" onClick={() => setNoteModal(null)}>Cancel</ChakraButton>
                    <ChakraButton size="sm" colorScheme="blue" onClick={handleSaveNote} isLoading={isSavingNote}>Save</ChakraButton>
                  </HStack>
                </HStack>
              </VStack>
            </Box>
          </Box>
        )}

        {cancelTarget && (
          <Box
            position="fixed" top="0" left="0" right="0" bottom="0" bg="rgba(0,0,0,0.45)"
            display="flex" alignItems="center" justifyContent="center" zIndex={60}
            onClick={() => !cancelBusy && setCancelTarget(null)}
          >
            <Box
              bg={cardBg} borderRadius="lg" shadow="xl" p={7} w="90%" maxW="420px"
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
            >
              <Heading size="md" color={textColor} mb={1}>{cancelMode === 'reject' ? 'Reject this request?' : 'Cancel this consultation?'}</Heading>
              <Text color={mutedText} fontSize="sm" mb={4}>
                {cancelTarget.studentName} — {formatDate(cancelTarget.date)} at {formatTime(cancelTarget.time)}. The student will be notified.
              </Text>
              <Box mb={4}>
                <CancelReasonPicker key={cancelTarget._id + cancelMode} options={FACULTY_CANCEL_REASONS} onChange={setCancelReason} />
              </Box>
              <HStack justify="flex-end" spacing={3}>
                <ChakraButton size="sm" variant="ghost" onClick={() => setCancelTarget(null)} isDisabled={cancelBusy}>Keep it</ChakraButton>
                <ChakraButton size="sm" colorScheme="red" onClick={confirmCancel} isLoading={cancelBusy} isDisabled={!cancelReason.trim()}>{cancelMode === 'reject' ? 'Reject request' : 'Cancel consultation'}</ChakraButton>
              </HStack>
            </Box>
          </Box>
        )}

        {missTarget && (
          <Box
            position="fixed" top="0" left="0" right="0" bottom="0" bg="rgba(0,0,0,0.45)"
            display="flex" alignItems="center" justifyContent="center" zIndex={60}
            onClick={() => !missBusy && setMissTarget(null)}
          >
            <Box
              bg={cardBg} borderRadius="lg" shadow="xl" p={7} w="90%" maxW="420px"
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
            >
              <Heading size="md" color={textColor} mb={1}>Mark as Missed by Student?</Heading>
              <Text color={mutedText} fontSize="sm" mb={4}>
                {missTarget.studentName} — {formatDate(missTarget.date)} at {formatTime(missTarget.time)}. The student will be notified and will see your reason.
              </Text>
              <Box mb={4}>
                <CancelReasonPicker key={missTarget._id} options={FACULTY_MISSED_REASONS} onChange={setMissReason} />
              </Box>
              <HStack justify="flex-end" spacing={3}>
                <ChakraButton size="sm" variant="ghost" onClick={() => setMissTarget(null)} isDisabled={missBusy}>Keep it</ChakraButton>
                <ChakraButton size="sm" colorScheme="orange" onClick={confirmMissedByStudent} isLoading={missBusy} isDisabled={!missReason.trim()}>Mark as missed</ChakraButton>
              </HStack>
            </Box>
          </Box>
        )}

        {completionModal && (
          <Box
            position="fixed" top="0" left="0" right="0" bottom="0" bg="rgba(0,0,0,0.45)"
            display="flex" alignItems="center" justifyContent="center" zIndex={60}
            onClick={() => setCompletionModal(null)}
          >
            <Box
              bg={cardBg} borderRadius="lg" shadow="xl" p={8} w="90%" maxW="360px" textAlign="center"
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
            >
              <Box fontSize="40px" mb={2}>✅</Box>
              <Heading size="md" color={textColor} mb={2}>Consultation Completed</Heading>
              <Text color={mutedText} fontSize="sm" mb={6}>
                {completionModal.studentName}{completionModal.studentSection ? ` (${completionModal.studentSection})` : ''} has been saved to your Consultation Log (Saved consultations).
              </Text>
              <ChakraButton colorScheme="green" size="sm" onClick={() => setCompletionModal(null)}>Done</ChakraButton>
            </Box>
          </Box>
        )}

        {activePage === "schedule" && scheduleTab === 'edit' && canImportSchedule && userId && (
          <Box display="flex" flexDirection="column" h="100%" overflowY="auto">
            {scheduleTabBar}
            <Box p={{ base: 4, md: 6 }}>
              <Flex justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={3} mb={4}>
                <Box>
                  <Heading size="md" color={textColor}>Edit Schedule</Heading>
                  <Text fontSize="sm" color={mutedText}>Add, change or delete your classes, or import them from your scanned Faculty Load PDF. Your weekly view updates after you save.</Text>
                </Box>
                <ChakraButton size="sm" variant="outline" onClick={() => setImportOpen(true)} title="Upload your scanned Faculty Load PDF, review it, then confirm to replace your class schedule.">Import Schedule PDF</ChakraButton>
              </Flex>
              <ClassGridEditor facultyId={userId} facultyName={userName || ''} />
              <SchedulePdfImporter mode="faculty" facultyId={userId} facultyName={userName || ''} isOpen={importOpen} onClose={() => setImportOpen(false)} onApplied={fetchData} />
            </Box>
          </Box>
        )}

        {/* ───────────────────────────────────────────────────────────────
            PAGE: MY STATUS (Chakra UI Form)
        ─────────────────────────────────────────────────────────────── */}
        {activePage === "status" && (
          <div style={{ padding: "clamp(16px, 4vw, 32px)", overflowY: "auto" }}>
            <PageTitle>Status & Notices</PageTitle>
            <Box display="flex" gap={6} flexDirection={{ base: 'column', md: 'row' }}>
              
              <Box bg={cardBg} p={6} borderRadius="lg" borderWidth="1px" borderColor={borderColor} shadow="sm" flex="1">
                <Heading size="md" color={textColor} mb={2}>My Status</Heading>
                <Text fontSize="sm" color={mutedText} mb={5}>Your status follows your schedule automatically. Use the options below only to change it for a while, for example a break.</Text>
                <VStack spacing={4} alignItems="flex-start">
                  <FormControl><FormLabel color={textColor}>Current Status</FormLabel>
                    <HStack spacing={3} flexWrap="wrap">
                      <Badge colorScheme={STATUS_COLORS[myCurrent?.status] || 'gray'} fontSize="sm" px={3} py={1} borderRadius="md">
                        {myCurrent ? (STATUS_LABELS[myCurrent.status] || myCurrent.statusLabel) : 'Loading...'}
                      </Badge>
                      <Text fontSize="sm" color={mutedText}>{statusSourceText(myCurrent)}</Text>
                    </HStack>
                    {myCurrent?.statusSource === 'manual' && myCurrent?.statusEntryId && (
                      <ChakraButton mt={3} size="sm" variant="outline" colorScheme="red" onClick={() => setConfirmCfg({
                        title: 'Clear your status?',
                        body: 'Your status goes back to what your schedule says.',
                        confirmLabel: 'Clear status', run: handleClearMyStatus,
                      })}>Clear status</ChakraButton>
                    )}
                  </FormControl>
                  <FormControl><FormLabel color={textColor}>Change my status for a while</FormLabel>
                    <SearchableSelect maxW="280px" searchable={false} clearable={false} ariaLabel="Change my status for a while" placeholder="Choose a status" value={myStatus}
                      onChange={(v: string) => { setMyStatus(v); setMyDuration(''); setMyUntil(''); }}
                      options={MANUAL_STATUS_OPTIONS.map(value => ({ value, label: STATUS_LABELS[value] }))} />
                  </FormControl>
                  {myStatus && (
                    <FormControl><FormLabel color={textColor}>For how long</FormLabel>
                      <SearchableSelect maxW="280px" searchable={false} clearable={false} ariaLabel="For how long" placeholder="Duration" value={myDuration}
                        onChange={setMyDuration}
                        options={(DURATION_CHOICES[myStatus] || []).map(([value, label]) => ({ value, label }))} />
                    </FormControl>
                  )}
                  {myDuration === 'UNTIL' && (
                    <FormControl><FormLabel color={textColor}>Until what time</FormLabel>
                      <SearchableSelect maxW="280px" searchable={false} clearable={false} ariaLabel="Until what time" placeholder="Choose a time" value={myUntil}
                        onChange={setMyUntil} options={untilTimeOptions} />
                    </FormControl>
                  )}
                  <ChakraButton colorScheme="blue" isDisabled={!myStatus || !myDuration || (myDuration === 'UNTIL' && !myUntil)} onClick={() => setConfirmCfg({
                    title: 'Set your status?',
                    body: `Students will see you as "${STATUS_LABELS[myStatus] || myStatus}" ${myDuration === 'UNTIL' ? `until ${formatTime(myUntil)}` : myDuration === 'EOD' ? 'for the rest of today' : `for ${durationLabel()}`}. It ends by itself.`,
                    confirmLabel: 'Set status', run: handleUpdateMyStatus,
                  })} isLoading={isUpdating} w="100%">Set Status</ChakraButton>
                </VStack>
              </Box>

              
              <Box bg={cardBg} p={6} borderRadius="lg" borderWidth="1px" borderColor={borderColor} shadow="sm" flex="1">
                <Heading size="md" color={textColor} mb={2}>Announce a Meeting or Leave</Heading>
                <Text fontSize="sm" color={mutedText} mb={5}>Tell students ahead of time when you will be away. Students cannot book consultations during these times. Bookings you already have stay as they are.</Text>
                <VStack spacing={4} alignItems="flex-start">
                  <FormControl><FormLabel color={textColor}>What are you announcing?</FormLabel>
                    <SearchableSelect maxW="320px" searchable={false} clearable={false} ariaLabel="What are you announcing?" placeholder="Choose one" value={nType}
                      onChange={(v: string) => { setNType(v); setNReason(''); setNReasonOther(''); setNStartDate(''); setNEndDate(''); setNStartTime(''); setNEndTime(''); }}
                      options={[{ value: 'IN_MEETING', label: 'Meeting (a few hours)' }, { value: 'ON_LEAVE', label: 'Leave (whole days)' }]} />
                  </FormControl>
                  {nType && (
                    <FormControl><FormLabel color={textColor}>{nType === 'IN_MEETING' ? 'When is the meeting?' : 'Which days will you be on leave?'}</FormLabel>
                      <NoticeCalendarPicker key={nType} mode={nType as 'IN_MEETING' | 'ON_LEAVE'} today={todayManila} onPick={handlePickWhen}
                        classes={Array.isArray(mySchedule) ? mySchedule : []}
                        consult={[...(Array.isArray(myConsultHours) ? myConsultHours : []), ...(Array.isArray(addedHours) ? addedHours : [])]} />
                    </FormControl>
                  )}
                  {nStartDate && (
                    <Box w="100%" p={3} borderWidth="1px" borderColor={borderColor} borderRadius="md">
                      <Text fontSize="xs" color={mutedText}>Selected</Text>
                      <Text fontSize="sm" fontWeight="600" color={textColor}>{whenText(nType, nStartDate, nEndDate, nStartTime, nEndTime)}</Text>
                      <Text fontSize="xs" color={mutedText} mt={1}>To change it, tap the calendar again.</Text>
                    </Box>
                  )}
                  {nStartDate && (
                    <FormControl><FormLabel color={textColor}>Reason</FormLabel>
                      <SearchableSelect maxW="320px" searchable={false} clearable={false} ariaLabel="Reason" placeholder="Choose a reason" value={nReason}
                        onChange={(v: string) => { setNReason(v); if (v !== 'Other') setNReasonOther(''); }}
                        options={(NOTICE_REASONS[nType] || []).map(value => ({ value, label: value }))} />
                    </FormControl>
                  )}
                  {nReason === 'Other' && (
                    <FormControl><FormLabel color={textColor}>Please specify</FormLabel>
                      <Input maxLength={120} value={nReasonOther} onChange={(e) => setNReasonOther(e.target.value)} color={textColor} />
                    </FormControl>
                  )}
                  {nStartDate && (
                    <FormControl><FormLabel color={textColor}>Message for students (optional)</FormLabel>
                      <Textarea maxLength={300} placeholder="e.g. Make-up class on Friday." value={nMakeUp} onChange={e => setNMakeUp(e.target.value)} rows={3} color={textColor} />
                    </FormControl>
                  )}
                  <ChakraButton colorScheme="blue" variant="outline" w="100%" isDisabled={!noticeReady} isLoading={isPosting} onClick={() => setConfirmCfg({
                    title: 'Announce this to students?',
                    body: `${nType === 'IN_MEETING' ? 'Meeting' : 'Leave'}: ${whenText(nType, nStartDate, nEndDate, nStartTime, nEndTime)}. Students cannot book new consultations in this time. Bookings you already have stay as they are.`,
                    confirmLabel: 'Announce', run: handlePostNotice,
                  })}>Announce to Students</ChakraButton>

                  <Box w="100%" pt={2}>
                    <Heading size="sm" color={textColor} mb={3}>Your announced meetings and leave</Heading>
                    {myNotices.length === 0 ? (
                      <Text fontSize="sm" color={mutedText}>Nothing announced yet.</Text>
                    ) : (
                      <VStack spacing={2} alignItems="stretch">
                        {myNotices.map((n: any) => (
                          <Flex key={n._id} justify="space-between" align="center" gap={3} p={3} borderWidth="1px" borderColor={borderColor} borderRadius="md">
                            <Box>
                              <HStack spacing={2} mb={1}>
                                <Badge colorScheme={STATUS_COLORS[n.type] || 'gray'}>{STATUS_LABELS[n.type] || n.type}</Badge>
                                <Text fontSize="sm" color={textColor}>{noticeReasonText(n)}</Text>
                              </HStack>
                              <Text fontSize="xs" color={mutedText}>{noticeWhen(n)}</Text>
                            </Box>
                            <ChakraButton size="xs" variant="outline" colorScheme="red" onClick={() => setConfirmCfg({
                              title: 'Cancel this announcement?',
                              body: 'Students will be able to book that time again.',
                              confirmLabel: 'Cancel announcement', run: () => handleCancelNotice(n._id),
                            })}>Cancel</ChakraButton>
                          </Flex>
                        ))}
                      </VStack>
                    )}
                  </Box>
                </VStack>
              </Box>
            </Box>
          </div>
        )}

        {/* PAGE: CONSULTATION HOURS (fixed + added weekly hours; moved out of Status & Notices) */}
        {activePage === "hours" && (
          <Box flex="1" minH={0} overflowY="auto" p={PAGE_PAD}>
            <PageTitle>Consultation Hours</PageTitle>
            <Box bg={cardBg} p={6} borderRadius="lg" borderWidth="1px" borderColor={borderColor} shadow="sm" maxW="760px">
              <Heading size="md" color={textColor} mb={2}>Fixed Consultation Hours</Heading>
              <Text fontSize="sm" color={mutedText} mb={4}>{isDean ? 'Between 30 minutes and 4 hours per week, distributed however you like.' : 'Must total exactly 4 hours per week, distributed however you like.'}</Text>
              <VStack spacing={3} align="stretch">
                {consultBlocks.map((block, i) => (
                  <HStack key={i}>
                    <SearchableSelect size="sm" maxW="150px" searchable={false} clearable={false} ariaLabel="Day" placeholder="Day" value={String(block.dayOfWeek)}
                      onChange={(v) => updateBlock(i, 'dayOfWeek', Number(v))}
                      options={CONSULT_DAY_LABELS.map((d, idx) => ({ value: String(idx + 1), label: d }))} />
                    <Input size="sm" type="time" value={block.startTime} onChange={(e) => updateBlock(i, 'startTime', e.target.value)} />
                    <Input size="sm" type="time" value={block.endTime} onChange={(e) => updateBlock(i, 'endTime', e.target.value)} />
                    <ChakraButton size="sm" colorScheme="red" variant="ghost" onClick={() => removeBlock(i)}>✕</ChakraButton>
                  </HStack>
                ))}
                <ChakraButton size="sm" variant="outline" onClick={addBlock} isDisabled={totalMinutes >= 240}>+ Add Block</ChakraButton>
                <Text fontSize="sm" fontWeight="bold" color={isValidTotal ? 'green.500' : 'red.500'}>
                  Total: {totalHours} / 4.0 hours
                </Text>
                <ChakraButton colorScheme="blue" onClick={() => setConfirmCfg({
                  title: 'Save your consultation hours?',
                  body: `You are saving ${totalHours} hours of consultation time. Students will see the updated hours when they book.`,
                  confirmLabel: 'Save hours', run: saveConsultationHours,
                })} isDisabled={!isValidTotal}>Save Consultation Hours</ChakraButton>
              </VStack>

              <Box borderTopWidth="1px" borderColor={borderColor} mt={6} pt={5}>
                <Heading size="sm" color={textColor} mb={1}>Added Consultation Hours</Heading>
                <Text fontSize="sm" color={mutedText} mb={3}>Extra weekly hours in your vacant time, on top of your 4 fixed hours. They repeat every week, and students can book them like any other slot.</Text>
                <HStack mb={3}>
                  <SearchableSelect size="sm" maxW="150px" searchable={false} clearable={false} ariaLabel="Day" placeholder="Day" value={String(addedForm.dayOfWeek)}
                    onChange={(v) => setAddedForm({ ...addedForm, dayOfWeek: Number(v) })}
                    options={CONSULT_DAY_LABELS.map((d, idx) => ({ value: String(idx + 1), label: d }))} />
                  <Input size="sm" type="time" value={addedForm.startTime} onChange={(e) => setAddedForm({ ...addedForm, startTime: e.target.value })} />
                  <Input size="sm" type="time" value={addedForm.endTime} onChange={(e) => setAddedForm({ ...addedForm, endTime: e.target.value })} />
                  <ChakraButton size="sm" colorScheme="blue" onClick={addExtraHours} isDisabled={!addedForm.startTime || !addedForm.endTime}>Add</ChakraButton>
                </HStack>
                <VStack align="stretch" spacing={2}>
                  {addedHours.length === 0 && <Text fontSize="xs" color={mutedText}>No added hours yet.</Text>}
                  {addedHours.map(h => (
                    <HStack key={h._id} justify="space-between">
                      <Text fontSize="sm" color={textColor}>Every {DAY_LABELS[columnOfStoredDay(h.dayOfWeek)]} · {formatTime(h.startTime)} – {formatTime(h.endTime)}</Text>
                      <ChakraButton size="xs" colorScheme="red" variant="ghost" onClick={() => removeExtraHours(h._id)}>Remove</ChakraButton>
                    </HStack>
                  ))}
                </VStack>
              </Box>
            </Box>
          </Box>
        )}

        {/* ───────────────────────────────────────────────────────────────
            PAGE: REQUESTS (Chakra UI Table)
        ─────────────────────────────────────────────────────────────── */}
        {activePage === "requests" && (
          <Box flex="1" minH={0} overflowY="auto" p={PAGE_PAD}>
            {/* This page lists every request, not only the pending ones (the menu badge counts the pending ones). */}
            <PageTitle>Appointment Requests</PageTitle>
            <BulkCancelModal isOpen={bulkOpen} onClose={() => setBulkOpen(false)} role="FACULTY" appointments={myAppointments} onDone={fetchData} />
            <Flex justify="flex-end" mb={3}>
              <ChakraButton size="sm" colorScheme="red" variant="outline" onClick={() => setBulkOpen(true)}>Cancel several…</ChakraButton>
            </Flex>
            <RequestList
              role="FACULTY"
              requests={myAppointments}
              onViewDetails={setDetailsId}
              onCancel={(apt) => { setCancelReason(''); setCancelMode('cancel'); setCancelTarget(apt); }}
              onNoShow={markNoShow}
              answerBar={answerBar}
              onChanged={fetchData}
            />
          </Box>
        )}

        {/* ───────────────────────────────────────────────────────────────
            PAGE: CONSULTATION LOG (Chakra UI Form)
        ─────────────────────────────────────────────────────────────── */}

        {activePage === "profile" && (
          <Box flex="1" minH={0} overflowY="auto" p={PAGE_PAD}>
            <PageTitle>My Profile</PageTitle>
            <ProfilePage />
          </Box>
        )}

        {activePage === "history" && !embedded && <HistoryPage showScheduleAccount />}

        {activePage === "analytics" && (
          <Box flex="1" minH={0} overflowY="auto" p={PAGE_PAD}>
            <FacultyAnalytics />
          </Box>
        )}

        {activePage === "log" && (
          <Box flex="1" minH={0} overflowY="auto" p={PAGE_PAD}>
            <PageTitle>Consultation Log</PageTitle>

            <Flex className="no-print" justify="space-between" align="center" gap={3} flexWrap="wrap" mb={4}>
              <Text color={mutedText} fontSize="sm">
                Enter and update consultation details in the tables below. The official form is prepared only when you print or save as PDF.
              </Text>
              <ChakraButton size="sm" colorScheme="blue" onClick={printConsultationForm}>
                Print / Save as PDF
              </ChakraButton>
            </Flex>

            <FilterPanel
              columns={{ base: 1, sm: 2, lg: 3 }}
              shown={pendingSignOff.length + savedLog.length} total={signOffAll.length + consultLog.length} noun="consultations"
              canClear={logFiltersActive} onClear={clearLogFilters} clearLabel="↻ Refresh"
            >
              <FilterField label="Gender">
                <SearchableSelect placeholder="All genders" value={logGender} onChange={setLogGender} maxW="100%" options={GENDER_OPTIONS} />
              </FilterField>
              <FilterField label="Program">
                <SearchableSelect placeholder="All programs" value={logProgram} onChange={setLogProgram} maxW="100%"
                  options={Object.keys(cohortConfig).map(p => ({ value: p, label: p }))} />
              </FilterField>
              <FilterField label="Year">
                <SearchableSelect placeholder="All years" value={logYear} onChange={setLogYear} maxW="100%"
                  options={[...new Set(Object.values(cohortConfig).flatMap(p => Object.keys(p)))].sort().map(y => ({ value: y, label: 'Year ' + y }))} />
              </FilterField>
              <FilterField label="Section">
                <SearchableSelect placeholder="All sections" value={logSection} onChange={setLogSection} maxW="100%"
                  options={[...new Set(Object.values(cohortConfig).flatMap(p => Object.values(p).flat()))].sort().map(sec => ({ value: sec, label: 'Section ' + sec }))} />
              </FilterField>
              <FilterField label="Sort by day">
                <SearchableSelect placeholder="Newest day first" searchable={false} clearable={false} value={logSort} onChange={(v) => setLogSort(v === 'asc' ? 'asc' : 'desc')} maxW="100%"
                  options={[{ value: 'desc', label: 'Newest day first' }, { value: 'asc', label: 'Oldest day first' }]} />
              </FilterField>
              <FilterField label="Search">
                <Input placeholder="Student or case..." value={logSearch} onChange={(e) => setLogSearch(e.target.value)} color={textColor} borderColor={borderColor} bg={cardBg} />
              </FilterField>
            </FilterPanel>

            <Tabs variant="soft-rounded" size="sm" colorScheme="blue" isLazy={false} className="no-print">
              <TabList mb={4} flexWrap="wrap" gap={1}>
                <Tab>Pending consultations ({pendingSignOff.length})</Tab>
                <Tab>Saved consultations ({savedLog.length})</Tab>
              </TabList>
              <TabPanels>
                <TabPanel px={0} pt={0}>
            <Box className="no-print" bg={cardBg} p={5} borderRadius="lg" borderWidth="1px" borderColor={borderColor} shadow="sm">
              <Heading size="md" color={textColor} mb={1}>Pending consultations</Heading>
              <Text color={mutedText} fontSize="sm" mb={4}>
                Complete the consultation details in the row, then save it. It moves to Saved consultations.
              </Text>
              <Box overflowX="auto">
                <Table size="sm" minW="1120px" variant="simple">
                  <Thead>
                    <Tr>
                      <Th color={mutedText}>Student / Advisee</Th>
                      <Th color={mutedText}>Gender</Th>
                      <Th color={mutedText}>Course and Year</Th>
                      <Th color={mutedText}>Date</Th>
                      <Th color={mutedText}>Case Presented</Th>
                      <Th color={mutedText}>Intervention / Action Taken</Th>
                      <Th color={mutedText}>Action</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {pendingSignOff.length === 0 ? (
                      <Tr><Td colSpan={7} color={mutedText} py={5} textAlign="center">No pending consultations.</Td></Tr>
                    ) : signOffGroups.map(g => (
                      <React.Fragment key={g.day || 'older'}>
                      {dayRow(g.day, 'Requested', 'Earlier requests')}
                      {g.rows.map(apt => (
                        <Tr key={apt._id}>
                          <Td minW="190px" color={textColor}>
                            <PersonCell name={apt.studentName} />
                          </Td>
                          <Td minW="95px"><GenderBadge gender={apt.studentId?.gender} /></Td>
                          <Td color={textColor} minW="130px">{apt.studentSection || '—'}</Td>
                          <Td color={textColor} minW="110px">
                            {formatDate(apt.date)}
                            <Text fontSize="xs" color={mutedText}>{formatTime(apt.time)}</Text>
                            {!hasStarted(apt.date, apt.time) && <Badge mt={1} colorScheme="blue">Upcoming</Badge>}
                          </Td>
                          <Td minW="210px">
                            {/* Read-only: it is the student's Purpose of Meeting, so choosing an intervention never touches it. */}
                            <Text fontSize="sm" color={textColor} whiteSpace="pre-wrap" overflowWrap="anywhere">{apt.reason || '—'}</Text>
                          </Td>
                          <Td minW="240px">
                            <SearchableSelect
                              size="sm" portal searchable={false}
                              ariaLabel={`Intervention or action taken for ${apt.studentName}`}
                              placeholder="Select an intervention"
                              value={interventionChoice(logForm[apt._id]?.interventionTaken || '')}
                              onChange={v => setLogForm(prev => ({
                                ...prev,
                                [apt._id]: { ...(prev[apt._id] || { casePresented: '', interventionTaken: '' }), interventionTaken: v },
                              }))}
                              options={[...INTERVENTION_OPTIONS.map(option => ({ value: option, label: option })), { value: 'Others', label: 'Others' }]}
                            />
                            {interventionChoice(logForm[apt._id]?.interventionTaken || '') === 'Others' && (
                              <Input
                                mt={2}
                                size="sm"
                                aria-label={`Other intervention for ${apt.studentName}`}
                                placeholder="Specify the intervention"
                                value={interventionOtherText(logForm[apt._id]?.interventionTaken || '')}
                                onChange={e => setLogForm(prev => ({
                                  ...prev,
                                  [apt._id]: { ...(prev[apt._id] || { casePresented: '', interventionTaken: '' }), interventionTaken: e.target.value },
                                }))}
                              />
                            )}
                          </Td>
                          <Td minW="125px">
                            <ChakraButton size="sm" colorScheme="green" isDisabled={!hasStarted(apt.date, apt.time)} title={hasStarted(apt.date, apt.time) ? undefined : `Available from ${formatTime(apt.time)} on ${formatDate(apt.date)}`} onClick={() => {
                              // Ask only when the entry is complete; otherwise submitLogEntry shows what is missing.
                              const chosen = (logForm[apt._id]?.interventionTaken || '').trim();
                              if (!chosen || chosen === 'Others') { submitLogEntry(apt._id); return; }
                              setConfirmCfg({
                                title: 'Complete and save this consultation?',
                                body: `${apt.studentName}'s consultation on ${formatDate(apt.date)} will be saved to your Saved consultations. Afterwards only the intervention can be edited.`,
                                confirmLabel: 'Complete & save', run: () => submitLogEntry(apt._id),
                              });
                            }}>
                              Complete &amp; Save
                            </ChakraButton>
                          </Td>
                        </Tr>
                      ))}
                      </React.Fragment>
                    ))}
                  </Tbody>
                </Table>
              </Box>
            </Box>
                </TabPanel>
                <TabPanel px={0} pt={0}>
            <Box className="no-print" bg={cardBg} p={5} borderRadius="lg" borderWidth="1px" borderColor={borderColor} shadow="sm">
              <Heading size="md" color={textColor} mb={1}>Saved consultations</Heading>
              <Text color={mutedText} fontSize="sm" mb={4}>
                You can edit the case and action fields, then select Save Changes on the same row.
              </Text>
              <Box overflowX="auto">
                <Table size="sm" minW="1120px" variant="simple">
                  <Thead>
                    <Tr>
                      <Th color={mutedText}>Student / Advisee</Th>
                      <Th color={mutedText}>Gender</Th>
                      <Th color={mutedText}>Course and Year</Th>
                      <Th color={mutedText}>Date</Th>
                      <Th color={mutedText}>Case Presented</Th>
                      <Th color={mutedText}>Intervention / Action Taken</Th>
                      <Th color={mutedText}>Action</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {savedLog.length === 0 ? (
                      <Tr><Td colSpan={7} color={mutedText} py={5} textAlign="center">No saved consultations yet.</Td></Tr>
                    ) : savedGroups.map(g => (
                      <React.Fragment key={g.day || 'older'}>
                      {dayRow(g.day, 'Saved', 'Earlier records')}
                      {g.rows.map(apt => (
                      <Tr key={apt._id}>
                        <Td minW="190px" color={textColor}><PersonCell name={apt.studentName} /></Td>
                        <Td minW="95px"><GenderBadge gender={apt.studentId?.gender} /></Td>
                        <Td minW="130px" color={textColor}>{apt.studentSection || '—'}</Td>
                        <Td minW="110px" color={textColor}>{formatDate(apt.date)}</Td>
                        <Td minW="210px">
                          <Text fontSize="sm" color={textColor} whiteSpace="pre-wrap" overflowWrap="anywhere">{apt.casePresented || apt.reason || '—'}</Text>
                        </Td>
                        <Td minW="240px">
                          <SearchableSelect
                            size="sm" portal searchable={false}
                            ariaLabel={`Edit intervention or action taken for ${apt.studentName}`}
                            placeholder="Select an intervention"
                            value={interventionChoice(apt.interventionTaken || '')}
                            onChange={v => updateSavedLogField(apt._id, 'interventionTaken', v)}
                            options={[...INTERVENTION_OPTIONS.map(option => ({ value: option, label: option })), { value: 'Others', label: 'Others' }]}
                          />
                          {interventionChoice(apt.interventionTaken || '') === 'Others' && (
                            <Input
                              mt={2}
                              size="sm"
                              aria-label={`Other intervention for ${apt.studentName}`}
                              placeholder="Specify the intervention"
                              value={interventionOtherText(apt.interventionTaken || '')}
                              onChange={e => updateSavedLogField(apt._id, 'interventionTaken', e.target.value)}
                            />
                          )}
                        </Td>
                        <Td minW="125px">
                          <ChakraButton size="sm" colorScheme="blue" onClick={() => setConfirmCfg({
                            title: 'Save changes to this record?',
                            body: `The intervention for ${apt.studentName} (${formatDate(apt.date)}) will be updated in your consultation records.`,
                            confirmLabel: 'Save changes', run: () => saveConsultLogChanges(apt),
                          })} isLoading={savingLogId === apt._id}>
                            Save Changes
                          </ChakraButton>
                        </Td>
                      </Tr>
                    ))}
                      </React.Fragment>
                    ))}
                  </Tbody>
                </Table>
              </Box>
            </Box>
                </TabPanel>
              </TabPanels>
            </Tabs>

            <ConsultationPrintForm facultyName={userName || ''} entries={consultLog} />
          </Box>
        )}
    </Frame>
    <ConfirmAction config={confirmCfg} onClose={() => setConfirmCfg(null)} />
    <AppointmentDetailsDrawer aptId={credentialReviewRequired ? null : detailsId ?? (embedded ? null : aptId)} onClose={() => { setDetailsId(null); closeApt(); }} />
    </>
  );
}
