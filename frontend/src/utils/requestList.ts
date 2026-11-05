// Logic for the student's "My Requests" list: filters, date groups and pages. No imports, so it can be checked on its own.

export interface ListItem {
  _id: string;
  status: string;
  date: string;      // "YYYY-MM-DD" (Manila)
  time: string;      // "HH:MM"
  reason: string;
  facultyId?: { _id?: string; name: string } | null;
  appeal?: { status?: string } | null;
}

/** What the student can do next with a request. */
export type NextAction = 'CAN_CANCEL' | 'CAN_APPEAL' | 'HAS_ACCOMPLISHMENT';
export const NEXT_ACTION_LABELS: Record<NextAction, string> = {
  CAN_CANCEL: 'Can cancel',
  CAN_APPEAL: 'Can appeal',
  HAS_ACCOMPLISHMENT: 'Has accomplishment',
};

// Statuses a student may appeal (the same list AppealControls and the server use).
const STUDENT_APPEALABLE = ['MISSED (STUDENT)', 'CANCELLED BY STUDENT'];

export function nextActions(apt: ListItem, canCancelNow: (a: ListItem) => boolean): NextAction[] {
  const out: NextAction[] = [];
  if ((apt.status === 'PENDING' || apt.status === 'APPROVED') && canCancelNow(apt)) out.push('CAN_CANCEL');
  if (STUDENT_APPEALABLE.includes(apt.status) && !(apt.appeal && apt.appeal.status)) out.push('CAN_APPEAL');
  if (apt.status === 'COMPLETED') out.push('HAS_ACCOMPLISHMENT');
  return out;
}

export interface Filters { professor: string; reason: string; status: string; action: '' | NextAction }
export const NO_FILTERS: Filters = { professor: '', reason: '', status: '', action: '' };

/** The professor filter uses the professor's id when there is one, otherwise the name. */
export const professorKey = (a: ListItem): string => (a.facultyId ? (a.facultyId._id || a.facultyId.name) : 'unknown');

export function applyFilters<T extends ListItem>(items: T[], f: Filters, canCancelNow: (a: ListItem) => boolean): T[] {
  return items.filter(a =>
    (!f.professor || professorKey(a) === f.professor) &&
    (!f.reason || a.reason === f.reason) &&
    (!f.status || a.status === f.status) &&
    (!f.action || nextActions(a, canCancelNow).includes(f.action)));
}

/** Newest first: by date, then by time within the day. */
export function sortNewestFirst<T extends ListItem>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.date === b.date ? b.time.localeCompare(a.time) : b.date.localeCompare(a.date)));
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

/** Distinct values for a filter dropdown, in a stable order. */
export const distinct = (values: string[]): string[] => Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
