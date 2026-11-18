// One place for how appointment statuses are named and coloured on every dashboard.
const LABELS: Record<string, string> = {
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  COMPLETED: 'Completed',
  PENDING: 'Waiting for Faculty Approval',
  'CANCELLED BY STUDENT': 'Cancelled by Student',
  'CANCELLED BY FACULTY': 'Cancelled by Faculty',
  'CANCELLED (FACULTY ON LEAVE)': 'Cancelled (Faculty on Leave)',
  'MISSED (STUDENT)': 'Missed by Student',
  'MISSED (FACULTY)': 'Missed by Faculty',
};

export const statusLabel = (status: string): string => LABELS[status] ?? status;

export const statusColor = (status: string): string => {
  if (status === 'APPROVED') return 'green';
  if (status === 'REJECTED') return 'red';
  if (status === 'PENDING') return 'yellow';
  if (status === 'COMPLETED') return 'blue';
  if (status.startsWith('MISSED')) return 'orange';
  return 'gray'; // all CANCELLED variants
};

const FACULTY_STATUS_LABELS: Record<string, string> = {
  VACANT: 'Vacant',
  OFF_SCHEDULE: '--', // outside 7 AM to the end of the last class: nothing to show
  AVAILABLE: 'Available', // older records only
  IN_CLASS: 'In Class',
  IN_CONSULTATION: 'In Consultation',
  CONSULTATION_HOURS: 'Consultation Hours',
  IN_MEETING: 'In a Meeting',
  ON_BREAK: 'On Break',
  OUT_OF_OFFICE: 'Out of Office',
  ON_LEAVE: 'On Leave',
  ABSENT: 'Absent',
  NOT_UPDATED: 'Not Published',
};

// Shared by Admin, Dean and Student views so status wording and colors never drift.
export const facultyStatusLabel = (status: string): string =>
  FACULTY_STATUS_LABELS[status] ?? status;

export const facultyStatusColor = (status: string): string => {
  switch (status) {
    case 'VACANT':
    case 'AVAILABLE': return 'green';
    case 'IN_CLASS': return 'blue';
    case 'IN_CONSULTATION': return 'cyan';
    case 'CONSULTATION_HOURS': return 'teal';
    case 'IN_MEETING': return 'yellow';
    case 'ON_BREAK': return 'orange';
    case 'OUT_OF_OFFICE': return 'gray';
    case 'ON_LEAVE': return 'purple';
    case 'ABSENT': return 'red';
    default: return 'gray';
  }
};

// The server works out each faculty member's status (schedule + anything they set). Use `status`;
// `currentStatus` is only the older field, kept so a cached response still shows something.
export const facultyStatusOf = (f: any): string => f?.status || f?.currentStatus || '';

const manilaTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' });
const manilaDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', timeZone: 'Asia/Manila' });

// "until 3:00 PM", or '' when the status has no end (Vacant).
export const facultyStatusUntil = (f: any): string => (f?.statusUntil ? `until ${manilaTime(f.statusUntil)}` : '');

// When a posted meeting or leave happens: "Nov 20, 1:00 PM to 3:00 PM" or "Nov 25 to Nov 27".
export const noticeWhenText = (n: any): string => {
  if (n.type === 'IN_MEETING') return `${manilaDay(n.startAt)}, ${manilaTime(n.startAt)} to ${manilaTime(n.endAt)}`;
  const first = manilaDay(n.startAt);
  const last = manilaDay(new Date(new Date(n.endAt).getTime() - 1).toISOString());
  return first === last ? first : `${first} to ${last}`;
};

// Time limits (must match the backend, utils/appointmentTime.js): students may request, and
// students and faculty may cancel, up to 1 hour before the start. A pending request can be
// answered by the faculty member until its start time, then the system rejects it automatically.
export const BOOKING_LEAD_HOURS = 1;
export const CANCEL_CUTOFF_HOURS = 1;

export const hoursUntil = (date: string, time: string): number =>
  (new Date(`${date}T${time}:00+08:00`).getTime() - Date.now()) / 36e5;

// True while there is still at least 1 hour before the appointment: the window in which a
// student or faculty member can cancel.
export const isBeforeCutoff = (date: string, time: string): boolean =>
  hoursUntil(date, time) >= CANCEL_CUTOFF_HOURS;

// True once the appointment's start time has passed (appointment date/time are Philippine time).
export const hasStarted = (date: string, time: string): boolean =>
  Date.now() >= new Date(`${date}T${time}:00+08:00`).getTime();

// Nobody can mark a consultation as missed (Missed by Student or Missed by Faculty) until 30 minutes after its start
// (must match MISS_GRACE_MINUTES in backend/utils/appointmentTime.js).
export const MISS_GRACE_MINUTES = 30;

/** True once the grace period after the start has passed: from here a miss can be marked. */
export const canMarkMissedNow = (date: string, time: string): boolean =>
  Date.now() >= new Date(`${date}T${time}:00+08:00`).getTime() + MISS_GRACE_MINUTES * 60000;

/** The fields the request lists (table rows and phone cards) read from an appointment. The API sends more. */
/** The free time still left for a pending request (the server sends it with the faculty request list). */
export interface AvailableWindow { start: string; end: string; minutes: number; maxMinutes: number; label: string }

export interface RequestRow {
  _id: string;
  status: string;
  date: string;
  time: string;
  duration?: number;
  reason: string;
  cancelReason?: string;
  /** Why it was marked missed (given by whoever marked it, or the system text), and who marked it. */
  missReason?: string;
  missedBy?: 'FACULTY' | 'STUDENT' | 'SYSTEM';
  /** Only on a pending request that has not started yet. */
  availableWindow?: AvailableWindow;
  /** Set when the professor approved a different start than the student asked for. */
  requestedTime?: string;
  studentName?: string;
  studentSection?: string;
  /** The student view gets the professor as an object; older records may have none. */
  facultyId?: { name: string } | null;
}

/**
 * The one reason line a person sees under a status: why it was rejected, cancelled or marked missed, and from whom.
 * Returns '' when there is nothing to show to this viewer. `role` is the viewer: students and faculty see the
 * other side's reason; a reason the system wrote is shown to both.
 */
export const reasonLine = (apt: { status: string; cancelReason?: string; missReason?: string; missedBy?: string }, role: string): string => {
  const s = apt.status;
  if (role === 'STUDENT' && apt.cancelReason && (s === 'REJECTED' || s === 'CANCELLED BY FACULTY' || s === 'CANCELLED (FACULTY ON LEAVE)')) return `Reason from professor: ${apt.cancelReason}`;
  if (role === 'FACULTY' && apt.cancelReason && s === 'CANCELLED BY STUDENT') return `Reason from student: ${apt.cancelReason}`;
  if (apt.missReason && s === 'MISSED (STUDENT)' && role === 'STUDENT') return `Reason from professor: ${apt.missReason}`;
  if (apt.missReason && s === 'MISSED (FACULTY)') {
    if (apt.missedBy === 'SYSTEM') return `Reason: ${apt.missReason}`;
    if (role === 'FACULTY') return `Reason from student: ${apt.missReason}`;
  }
  return '';
};

/** Reason the system gives when an unanswered request's hour went to another student (copy of backend/utils/appointmentTime.js). */
export const REASON_TIME_TAKEN = "Another student's request for this time was accepted.";
