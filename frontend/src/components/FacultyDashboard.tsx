"use client";

import React, { useEffect, useState, useRef, useMemo } from 'react';
import { formatDate } from './dateUtils';
import BroadcastBanner from './BroadcastBanner';
import {
  Box, Heading, Table, Thead, Tbody, Tr, Th, Td, Badge, Text, 
  Button as ChakraButton, Select, Input, HStack, useToast, FormControl, 
  FormLabel, Flex, VStack, Textarea
} from '@chakra-ui/react';
import { authFetch } from './authFetch';
import ProfileGate from './ProfileGate';
import { hasStarted } from './appointmentStatus';
import type { AvailableWindow, RequestRow } from './appointmentStatus';
import AppointmentDetailsDrawer from './AppointmentDetailsDrawer';
import { useDeepLink } from '../utils/useDeepLink';
import CancelReasonPicker, { FACULTY_CANCEL_REASONS } from './CancelReasonPicker';
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
import ExportBar from './ExportBar';
import SearchableSelect from './SearchableSelect';
import { cohortConfig } from '../data/cohortConfig';
import { dayHeading, groupByDay, manilaDay } from '../utils/logDays';
import { GENDER_OPTIONS, matchesGender, parseCohort, GenderBadge, PersonCell, FilterField, FilterPanel } from './PeopleUi';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

type Page      = "status" | "schedule" | "requests" | "log" | "analytics" | "profile" | "hours";
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

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
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
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

function formatWeekLabel(dates: Date[]): string {
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const s = dates[0];
  const e = dates[5];
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

export default function FacultyDashboard() {
  const toast = useToast();
  const palette = useNavPalette();
  
  const userId = localStorage.getItem('userId');
  const userName = localStorage.getItem('userName');

  // ── UI State ─────────────────────────────────────────────────────────────────
  const [activePage, setActivePage] = useState<Page>("schedule");
  // Notification links: ?page= switches page, ?apt= opens that appointment's details
  const { aptId, closeApt } = useDeepLink<Page>(["status", "schedule", "requests", "log", "analytics", "profile"], setActivePage);
  const [weekOffset, setWeekOffset] = useState(0);
  // Phones open on one day at a time; the 6-column week grid needs a wider screen.
  const [viewMode,   setViewMode]   = useState<ViewMode>(() => (typeof window !== "undefined" && window.innerWidth < 768 ? "day" : "week"));
  const [focusDay,   setFocusDay]   = useState(0);       
  
  // ── Data State ───────────────────────────────────────────────────────────────
  const [myStatus, setMyStatus] = useState('');
  const [myLocation, setMyLocation] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [mySchedule, setMySchedule] = useState<any[]>([]);
  const [myConsultHours, setMyConsultHours] = useState<any[]>([]);
  const [myAppointments, setMyAppointments] = useState<any[]>([]);
  const hasSyncedRef = useRef(false);
  const [notice, setNotice] = useState('');
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
  const isValidTotal = totalMinutes === 240;

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
    if (!response.ok) throw new Error(data.error);
    fetchLog();
    setCompletionModal({ studentName: apt?.studentName || 'Student', studentSection: apt?.studentSection || '' });
    fetchData();
  } catch (error: any) {
    toast({ title: 'Failed', description: error.message, status: 'error' });
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
    if (!response.ok) throw new Error(data.error || 'Could not update this consultation log.');
    setConsultLog(prev => prev.map(row => row._id === apt._id ? data.appointment : row));
    toast({ title: 'Consultation log updated', status: 'success', duration: 2500 });
  } catch (error: any) {
    toast({ title: 'Could not save changes', description: error.message, status: 'error' });
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
      if (!response.ok) throw new Error(data.error);
      toast({ title: 'Added hours saved', status: 'success' });
      setAddedForm({ dayOfWeek: addedForm.dayOfWeek, startTime: '', endTime: '' });
      loadAddedHours();
    } catch (error: any) {
      toast({ title: 'Could not add hours', description: error.message, status: 'error', position: 'top' });
    }
  };
  const removeExtraHours = async (id: string) => {
    try {
      const response = await authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/added-hours/${id}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      loadAddedHours();
    } catch (error: any) {
      toast({ title: 'Could not remove', description: error.message, status: 'error', position: 'top' });
    }
  };

const saveConsultationHours = async () => {
  if (!isValidTotal) {
    return toast({ title: 'Invalid Total', description: `Must total exactly 4 hours. Currently ${totalHours} hours.`, status: 'warning' });
  }
  try {
    const response = await authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/consultation-hours`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ facultyId: userId, hours: consultBlocks })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    toast({ title: 'Saved', description: data.message, status: 'success' });
  } catch (error: any) {
    toast({ title: 'Failed', description: error.message, status: 'error' });
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
  const [logDay, setLogDay] = useState(''); // one chosen day ("YYYY-MM-DD"): the day requested for sign-off rows, the day saved for saved rows
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
  // Ready for sign-off is grouped by the day the student REQUESTED; saved records by the day they were SAVED (signed off).
  const requestedDayOf = (a: any) => manilaDay(a.createdAt);
  const savedDayOf = (a: any) => manilaDay(a.completedAt);
  const signOffAll = myAppointments.filter(a => a.status === 'APPROVED' || a.status === 'MISSED (FACULTY)');
  const pendingSignOff = signOffAll.filter(a => matchesLogFilters(a) && (!logDay || requestedDayOf(a) === logDay));
  const savedLog = consultLog.filter(a => matchesLogFilters(a) && (!logDay || savedDayOf(a) === logDay));
  const signOffGroups = groupByDay(pendingSignOff, requestedDayOf, a => a.createdAt || '', logSort);
  const savedGroups = groupByDay(savedLog, savedDayOf, a => a.completedAt || '', logSort);
  const dayRow = (day: string, verb: string, none: string) => (
    <Tr><Td colSpan={7} py={2} fontWeight="700" fontSize="sm" bg="blackAlpha.50" _dark={{ bg: 'whiteAlpha.100' }} color={textColor}>{day ? `${verb} ${dayHeading(day)}` : none}</Td></Tr>
  );

  const weekDates = useMemo(() => getWeekDates(weekOffset), [weekOffset]);
  const weekLabel = useMemo(() => formatWeekLabel(weekDates), [weekDates]);
  const visibleDayIndices = viewMode === "week" ? [0, 1, 2, 3, 4, 5] : [focusDay];

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
        if (userId && data.length > 0 && !hasSyncedRef.current) {
          const me = data.find((f: any) => f._id === userId);
          if (me) { 
            setMyStatus(me.currentStatus);
            setMyLocation(me.currentLocation || me.room || '');
            setNotice(me.noticeMessage || '');
            hasSyncedRef.current = true;
          }
        }
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
    AVAILABLE: 'Available', IN_CLASS: 'In Class', IN_CONSULTATION: 'Consultation Hours', IN_MEETING: 'In a Meeting',
    ON_BREAK: 'On Break', OUT_OF_OFFICE: 'Out of Office', ON_LEAVE: 'On Leave', ABSENT: 'Absent',
  };

  const handleUpdateMyStatus = async () => {
    setIsUpdating(true);
    try {
      const response = await authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/update-status/${userId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentStatus: myStatus, currentLocation: myLocation })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Failed to update status (${response.status})`);
      }
      toast({ title: 'Status updated!', status: 'success', duration: 2000 });
      fetchData();
    } catch (error: any) {
      toast({ title: 'Could not update status', description: error.message, status: 'error' });
    }
    setIsUpdating(false);
  };

  const handlePostNotice = async () => {
    try {
      await authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/notice/${userId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notice })
      });
      toast({ title: 'Notice Broadcasted!', status: 'success' });
    } catch (error) {}
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
        throw new Error(err.error || 'Failed to save note');
      }
      toast({ title: editingId ? 'Note updated' : 'Note added', status: 'success' });
      setNoteModal(null);
      fetchData();
    } catch (error: any) {
      toast({ title: 'Could not save note', description: error.message, status: 'error' });
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
      if (!response.ok) throw new Error(data.error || 'Failed to process appointment.');

      toast({ title: newStatus === 'APPROVED' && chosenTime !== targetApt.time ? `Approved for ${formatTime(chosenTime)}` : `Appointment ${newStatus}`, status: 'success' });
      fetchData(); 
    } catch (error: any) {
      toast({
        title: "Scheduling Conflict Blocked", description: error.message,
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
      if (!response.ok) throw new Error(data.error || 'Could not cancel the consultation.');
      toast({ title: cancelMode === 'reject' ? 'Request declined' : 'Consultation cancelled', description: 'The student has been notified.', status: 'success' });
      setCancelTarget(null);
      fetchData();
    } catch (error: any) {
      toast({ title: 'Could not cancel', description: error.message, status: 'error' });
    } finally { setCancelBusy(false); }
  };

  // The student did not turn up to an approved consultation
  const markNoShow = async (apt: any) => {
    if (!window.confirm(`Mark ${apt.studentName} as a no-show for this consultation?`)) return;
    try {
      const response = await authFetch(`${import.meta.env.VITE_API_URL}/api/faculty/appointment/${apt._id}/no-show`, { method: 'PATCH' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not mark the no-show.');
      toast({ title: 'Marked as student no-show', status: 'info' });
      fetchData();
    } catch (error: any) {
      toast({ title: 'Could not update', description: error.message, status: 'error' });
    }
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
        dayOfWeek: block.dayOfWeek - 1,
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
        dayOfWeek: sched.dayOfWeek - 1, 
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
              <Select size="xs" w="110px" title="Start time" aria-label="Start time" value={startChoice(apt)}
                onChange={(e) => setApproveStart({ ...approveStart, [apt._id]: e.target.value })}>
                {startOptions(w).map(t => <option key={t} value={t}>{formatTime(t)}</option>)}
              </Select>
              <Select size="xs" w="110px" title="Consultation length" aria-label="Consultation length" value={lengthChoice(apt)}
                onChange={(e) => setApproveDuration({ ...approveDuration, [apt._id]: Number(e.target.value) })}>
                {lengthOptions(apt).map(m => <option key={m} value={m}>{lengthText(m)}</option>)}
              </Select>
              <ChakraButton size="xs" colorScheme="green" onClick={() => updateAppointmentStatus(apt, 'APPROVED')}>Approve</ChakraButton>
            </>
          )}
          <ChakraButton size="xs" colorScheme="red" onClick={() => { setCancelReason(''); setCancelMode('reject'); setCancelTarget(apt); }}>Reject</ChakraButton>
        </HStack>
      </HStack>
    );
  };

  return (
    <>
    <DashboardShell
      portalLabel="Faculty Portal"
      userName={userName || ''}
      extras={<ProfileGate role="FACULTY" />}
      nav={([
        { page: "schedule",  section: "Consultations", icon: "calendar",  label: "Master Schedule" },
        { page: "requests",  section: "Consultations", icon: "inbox",     label: "Requests", badge: myAppointments.filter(a => a.status === 'PENDING').length },
        { page: "log",       section: "Consultations", icon: "clipboard", label: "Consultation Log" },
        { page: "status",    section: "Availability",  icon: "activity",  label: "Status & Notices" },
        { page: "hours",     section: "Availability",  icon: "clock",     label: "Consultation Hours" },
        { page: "analytics", section: "Insights",      icon: "chart",     label: "My Analytics" },
        { page: "profile",   section: "Account",       icon: "user",      label: "My Profile" },
      ] as { page: Page; section: string; icon: IconName; label: string; badge?: number }[]).map(({ page, ...item }) => ({
        key: page, ...item, active: activePage === page, onClick: () => setActivePage(page),
      }))}
    >
        <WelcomeHeader name={userName || ''} actions={activePage === 'analytics' ? <ExportBar solid csvPath="/api/analytics/me.csv" fileBase="my-analytics" /> : undefined} />
        <BroadcastBanner userRole="FACULTY" />

        {/* ───────────────────────────────────────────────────────────────
            PAGE: MASTER SCHEDULE
        ─────────────────────────────────────────────────────────────── */}
        {activePage === "schedule" && (
          <Box display="flex" flexDirection="column" h="100%" overflowY="auto">
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
              <div style={{ background: C.surface, borderRadius: "10px", border: `1px solid ${C.border}`, overflow: "hidden", minWidth: viewMode === "day" ? "340px" : "520px", maxWidth: viewMode === "day" ? "480px" : "none", margin: viewMode === "day" ? "0 auto" : "0" }}>
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
                {completionModal.studentName}{completionModal.studentSection ? ` (${completionModal.studentSection})` : ''} has been signed off and added to your Consultation Log.
              </Text>
              <ChakraButton colorScheme="green" size="sm" onClick={() => setCompletionModal(null)}>Done</ChakraButton>
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
                <Heading size="md" color={textColor} mb={6}>Update Live Status</Heading>
                <VStack spacing={4} alignItems="flex-start">
                  <FormControl><FormLabel color={textColor}>Current Status</FormLabel>
                    <Select value={myStatus} onChange={(e) => setMyStatus(e.target.value)} color={textColor}>
                      <option value="AVAILABLE">Available</option><option value="IN_CLASS">In Class</option><option value="IN_CONSULTATION">Consultation Hours</option>
                      <option value="IN_MEETING">In a Meeting</option><option value="ON_BREAK">On Break</option>
                      <option value="OUT_OF_OFFICE">Out of Office</option><option value="ON_LEAVE">On Leave</option><option value="ABSENT">Absent</option>
                    </Select>
                  </FormControl>
                  <FormControl><FormLabel color={textColor}>Location</FormLabel><Input value={myLocation} onChange={(e) => setMyLocation(e.target.value)} color={textColor} /></FormControl>
                  <ChakraButton colorScheme="blue" onClick={() => setConfirmCfg({
                    title: 'Update your live status?',
                    body: `Students will see you as "${STATUS_LABELS[myStatus] || myStatus}"${myLocation.trim() ? ` at "${myLocation.trim()}"` : ''}.`,
                    confirmLabel: 'Update status', run: handleUpdateMyStatus,
                  })} isLoading={isUpdating} w="100%">Update Live Status</ChakraButton>
                </VStack>
              </Box>

              
              <Box bg={cardBg} p={6} borderRadius="lg" borderWidth="1px" borderColor={borderColor} shadow="sm" flex="1">
                <Heading size="md" color={textColor} mb={6}>Post a Notice (Students)</Heading>
                <form onSubmit={(e) => {
                  e.preventDefault();
                  setConfirmCfg({ title: 'Post this notice to students?', body: 'Students will be able to see it. You can post a new one later to replace it.', confirmLabel: 'Post notice', run: handlePostNotice });
                }}>
                  <VStack spacing={4}>
                    <FormControl><FormLabel color={textColor}>Reason for absence / Make-up info</FormLabel>
                      <Textarea placeholder="e.g. Attending a seminar today. Make up class on Friday." value={notice} onChange={e => setNotice(e.target.value)} rows={4} color={textColor} />
                    </FormControl>
                    <ChakraButton type="submit" colorScheme="blue" variant="outline" w="100%">Post Notice</ChakraButton>
                  </VStack>
                </form>
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
              <Text fontSize="sm" color={mutedText} mb={4}>Must total exactly 4 hours per week, distributed however you like.</Text>
              <VStack spacing={3} align="stretch">
                {consultBlocks.map((block, i) => (
                  <HStack key={i}>
                    <Select size="sm" value={block.dayOfWeek} onChange={(e) => updateBlock(i, 'dayOfWeek', Number(e.target.value))}>
                      {DAY_LABELS.map((d, idx) => <option key={idx} value={idx + 1}>{d}</option>)}
                    </Select>
                    <Input size="sm" type="time" value={block.startTime} onChange={(e) => updateBlock(i, 'startTime', e.target.value)} />
                    <Input size="sm" type="time" value={block.endTime} onChange={(e) => updateBlock(i, 'endTime', e.target.value)} />
                    <ChakraButton size="sm" colorScheme="red" variant="ghost" onClick={() => removeBlock(i)}>✕</ChakraButton>
                  </HStack>
                ))}
                <ChakraButton size="sm" variant="outline" onClick={addBlock} isDisabled={isValidTotal}>+ Add Block</ChakraButton>
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
                  <Select size="sm" value={addedForm.dayOfWeek} onChange={(e) => setAddedForm({ ...addedForm, dayOfWeek: Number(e.target.value) })}>
                    {DAY_LABELS.map((d, idx) => <option key={idx} value={idx + 1}>{d}</option>)}
                  </Select>
                  <Input size="sm" type="time" value={addedForm.startTime} onChange={(e) => setAddedForm({ ...addedForm, startTime: e.target.value })} />
                  <Input size="sm" type="time" value={addedForm.endTime} onChange={(e) => setAddedForm({ ...addedForm, endTime: e.target.value })} />
                  <ChakraButton size="sm" colorScheme="blue" onClick={addExtraHours} isDisabled={!addedForm.startTime || !addedForm.endTime}>Add</ChakraButton>
                </HStack>
                <VStack align="stretch" spacing={2}>
                  {addedHours.length === 0 && <Text fontSize="xs" color={mutedText}>No added hours yet.</Text>}
                  {addedHours.map(h => (
                    <HStack key={h._id} justify="space-between">
                      <Text fontSize="sm" color={textColor}>Every {DAY_LABELS[h.dayOfWeek - 1]} · {formatTime(h.startTime)} – {formatTime(h.endTime)}</Text>
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

            <Box className="no-print" bg={cardBg} p={5} borderRadius="lg" borderWidth="1px" borderColor={borderColor} shadow="sm" mb={5}>
              <Heading size="md" color={textColor} mb={1}>Ready for sign-off</Heading>
              <Text color={mutedText} fontSize="sm" mb={4}>
                Complete the consultation details in the row, then save it to add the entry to your records.
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
                      <Tr><Td colSpan={7} color={mutedText} py={5} textAlign="center">No consultations are waiting for sign-off.</Td></Tr>
                    ) : signOffGroups.map(g => (
                      <React.Fragment key={g.day || 'older'}>
                      {dayRow(g.day, 'Requested', 'Earlier requests')}
                      {g.rows.map(apt => (
                        <Tr key={apt._id}>
                          <Td minW="190px" color={textColor}>
                            <PersonCell name={apt.studentName} />
                            {apt.status === 'MISSED (FACULTY)' && <Badge mt={1} colorScheme="orange">Late sign-off</Badge>}
                          </Td>
                          <Td minW="95px"><GenderBadge gender={apt.studentId?.gender} /></Td>
                          <Td color={textColor} minW="130px">{apt.studentSection || '—'}</Td>
                          <Td color={textColor} minW="110px">{formatDate(apt.date)}</Td>
                          <Td minW="210px">
                            {/* Read-only: it is the student's Purpose of Meeting, so choosing an intervention never touches it. */}
                            <Text fontSize="sm" color={textColor} whiteSpace="pre-wrap" overflowWrap="anywhere">{apt.reason || '—'}</Text>
                          </Td>
                          <Td minW="240px">
                            <Select
                              size="sm"
                              aria-label={`Intervention or action taken for ${apt.studentName}`}
                              placeholder="Select an intervention"
                              value={interventionChoice(logForm[apt._id]?.interventionTaken || '')}
                              onChange={e => setLogForm(prev => ({
                                ...prev,
                                [apt._id]: { ...(prev[apt._id] || { casePresented: '', interventionTaken: '' }), interventionTaken: e.target.value },
                              }))}
                            >
                              {INTERVENTION_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
                              <option value="Others">Others</option>
                            </Select>
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
                            <ChakraButton size="sm" colorScheme="green" onClick={() => {
                              // Ask only when the entry is complete; otherwise submitLogEntry shows what is missing.
                              const chosen = (logForm[apt._id]?.interventionTaken || '').trim();
                              if (!chosen || chosen === 'Others') { submitLogEntry(apt._id); return; }
                              setConfirmCfg({
                                title: 'Complete and save this consultation?',
                                body: `${apt.studentName}'s consultation on ${formatDate(apt.date)} will be signed off and added to your records. Afterwards only the intervention can be edited.`,
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

            <Box className="no-print" bg={cardBg} p={5} borderRadius="lg" borderWidth="1px" borderColor={borderColor} shadow="sm">
              <Heading size="md" color={textColor} mb={1}>Saved consultation records</Heading>
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
                      <Tr><Td colSpan={7} color={mutedText} py={5} textAlign="center">No saved consultation records yet.</Td></Tr>
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
                          <Select
                            size="sm"
                            aria-label={`Edit intervention or action taken for ${apt.studentName}`}
                            placeholder="Select an intervention"
                            value={interventionChoice(apt.interventionTaken || '')}
                            onChange={e => updateSavedLogField(apt._id, 'interventionTaken', e.target.value)}
                          >
                            {INTERVENTION_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
                            <option value="Others">Others</option>
                          </Select>
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

            <ConsultationPrintForm facultyName={userName || ''} entries={consultLog} />
          </Box>
        )}
    </DashboardShell>
    <ConfirmAction config={confirmCfg} onClose={() => setConfirmCfg(null)} />
    <AppointmentDetailsDrawer aptId={detailsId ?? aptId} onClose={() => { setDetailsId(null); closeApt(); }} />
    </>
  );
}
