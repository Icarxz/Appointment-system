// One place for how appointment statuses are named and coloured on every dashboard.
const LABELS: Record<string, string> = {
  PENDING: 'Waiting for Faculty Approval',
  'CANCELLED BY STUDENT': 'Cancelled by Student',
  'CANCELLED BY FACULTY': 'Cancelled by Faculty',
  'CANCELLED (FACULTY ON LEAVE)': 'Cancelled (Faculty on Leave)',
  'MISSED (STUDENT)': 'Student No-Show',
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
  AVAILABLE: 'Available',
  IN_CLASS: 'In Class',
  IN_CONSULTATION: 'Consultation Hours',
  IN_MEETING: 'In a Meeting',
  ON_BREAK: 'On Break',
  OUT_OF_OFFICE: 'Out of Office',
  ON_LEAVE: 'On Leave',
  ABSENT: 'Absent',
  NOT_UPDATED: 'No Update',
};

// Shared by Admin, Dean and Student views so live-status wording and colors never drift.
export const facultyStatusLabel = (status: string): string =>
  FACULTY_STATUS_LABELS[status] ?? status;

export const facultyStatusColor = (status: string): string => {
  switch (status) {
    case 'AVAILABLE': return 'green';
    case 'IN_CLASS': return 'blue';
    case 'IN_CONSULTATION': return 'teal';
    case 'IN_MEETING': return 'yellow';
    case 'ON_BREAK': return 'orange';
    case 'OUT_OF_OFFICE': return 'gray';
    case 'ON_LEAVE': return 'purple';
    case 'ABSENT': return 'red';
    default: return 'gray';
  }
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
  /** Only on a pending request that has not started yet. */
  availableWindow?: AvailableWindow;
  /** Set when the professor approved a different start than the student asked for. */
  requestedTime?: string;
  studentName?: string;
  studentSection?: string;
  /** The student view gets the professor as an object; older records may have none. */
  facultyId?: { name: string } | null;
}

/** Reason the system gives when an unanswered request's hour went to another student (copy of backend/utils/appointmentTime.js). */
export const REASON_TIME_TAKEN = "Another student's request for this time was accepted.";
