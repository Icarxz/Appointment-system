// Logic for the student's "My Requests" list: filters, date groups and pages. No imports, so it can be checked on its own.

export interface ListItem {
  _id: string;
  status: string;
  date: string;      // "YYYY-MM-DD" (Manila)
  time: string;      // "HH:MM"
  createdAt?: string; // when the request was submitted (ISO string from the server)
  reason: string;
  facultyId?: { _id?: string; name: string } | null;
  studentName?: string;
  studentSection?: string;
  appeal?: { status?: string } | null;
}

/** What the student can do next with a request. */
export type NextAction = 'CAN_CANCEL' | 'CAN_APPEAL' | 'HAS_ACCOMPLISHMENT' | 'NEEDS_ANSWER' | 'CAN_MARK_NO_SHOW' | 'CAN_COMPLETE';
export const NEXT_ACTION_LABELS: Record<NextAction, string> = {
  CAN_CANCEL: 'Can cancel',
  CAN_APPEAL: 'Can add a reason',
  HAS_ACCOMPLISHMENT: 'Has accomplishment',
  NEEDS_ANSWER: 'Needs my answer',
  CAN_MARK_NO_SHOW: 'Can mark missed',
  CAN_COMPLETE: 'Can mark completed',
};

// Statuses a student may appeal (the same list AppealControls and the server use).
const STUDENT_APPEALABLE = ['MISSED (STUDENT)', 'CANCELLED BY STUDENT'];

export function nextActions(apt: ListItem, canCancelNow: (a: ListItem) => boolean): NextAction[] {
  const out: NextAction[] = [];
  if ((apt.status === 'PENDING' || apt.status === 'APPROVED') && canCancelNow(apt)) out.push('CAN_CANCEL');
  if (STUDENT_APPEALABLE.includes(apt.status) && !(apt.appeal && apt.appeal.status)) out.push('CAN_APPEAL');
  if (apt.status === 'APPROVED') out.push('CAN_COMPLETE', 'CAN_MARK_NO_SHOW'); // enabled or disabled by the time rules in the menu
  if (apt.status === 'COMPLETED') out.push('HAS_ACCOMPLISHMENT');
  return out;
}

// Statuses a faculty member may appeal (the same list AppealControls and the server use).
const FACULTY_APPEALABLE = ['MISSED (FACULTY)', 'CANCELLED BY FACULTY'];

/** What the faculty member can do next with a request. `started`: the requested time has already begun. */
export function facultyNextActions(apt: ListItem, o: { canCancel: boolean; started: boolean }): NextAction[] {
  const out: NextAction[] = [];
  if (apt.status === 'PENDING' && !o.started) out.push('NEEDS_ANSWER');
  if (apt.status === 'APPROVED' && o.canCancel) out.push('CAN_CANCEL');
  if (apt.status === 'APPROVED' && o.started) out.push('CAN_COMPLETE', 'CAN_MARK_NO_SHOW'); // enabled or disabled by the time rules in the menu
  if (FACULTY_APPEALABLE.includes(apt.status) && !(apt.appeal && apt.appeal.status)) out.push('CAN_APPEAL');
  return out;
}

export interface Filters { professor: string; reason: string; status: string; action: '' | NextAction }
export const NO_FILTERS: Filters = { professor: '', reason: '', status: '', action: '' };

/** The person filter (`professor` in Filters) uses the professor's id when there is one, otherwise the name. */
export const professorKey = (a: ListItem): string => (a.facultyId ? (a.facultyId._id || a.facultyId.name) : 'unknown');
/** For the faculty view: the student's name and section. */
export const studentKey = (a: ListItem): string => `${a.studentName || 'unknown'} (${a.studentSection || ''})`;

export function applyFilters<T extends ListItem>(
  items: T[], f: Filters, actionsOf: (a: ListItem) => NextAction[], personKey: (a: ListItem) => string = professorKey,
): T[] {
  return items.filter(a =>
    (!f.professor || personKey(a) === f.professor) &&
    (!f.reason || a.reason === f.reason) &&
    (!f.status || a.status === f.status) &&
    (!f.action || actionsOf(a).includes(f.action)));
}

/** The day a request was submitted, in Manila time ("YYYY-MM-DD"). '' for old records without createdAt. */
export const requestedDay = (a: ListItem): string =>
  a.createdAt ? new Date(a.createdAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }) : '';

/**
 * Newest REQUEST day first (the day the student pressed Request, not the day of the consultation).
 * Requests submitted on the SAME day stay in submission order (first requested on top), never sorted by time.
 */
export function sortNewestFirst<T extends ListItem>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const dayA = requestedDay(a), dayB = requestedDay(b);
    if (dayA !== dayB) return dayB.localeCompare(dayA);
    const byCreated = (a.createdAt || '').localeCompare(b.createdAt || '');
    // _id (Mongo ObjectId) also sorts by creation time, so it is the fallback.
    return byCreated !== 0 ? byCreated : a._id.localeCompare(b._id);
  });
}

export function paginate<T>(items: T[], page: number, size: number): { rows: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const p = Math.min(Math.max(1, page), pages);
  return { rows: items.slice((p - 1) * size, p * size), page: p, pages };
}

/** Consecutive items with the same date become one group (the input must already be sorted by date). */
export function groupByDate<T extends ListItem>(items: T[]): { date: string; items: T[] }[] {
  const groups: { date: string; items: T[] }[] = [];
  for (const it of items) {
    const last = groups[groups.length - 1];
    if (last && last.date === it.date) last.items.push(it); else groups.push({ date: it.date, items: [it] });
  }
  return groups;
}

/** Consecutive items submitted on the same day become one group (the input must already be sorted). day is '' for old records. */
export function groupByRequestedDay<T extends ListItem>(items: T[]): { day: string; items: T[] }[] {
  const groups: { day: string; items: T[] }[] = [];
  for (const it of items) {
    const day = requestedDay(it);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(it); else groups.push({ day, items: [it] });
  }
  return groups;
}

/** Distinct values for a filter dropdown, in a stable order. */
export const distinct = (values: string[]): string[] => Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
