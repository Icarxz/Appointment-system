// Which days of the week the schedule screens show and allow. Mirrors backend/utils/daySettings.js: change both together.
// Days use the JavaScript / database convention: Sunday = 0 ... Saturday = 6.

export const DEFAULT_VISIBLE_DAYS = [1, 2, 3, 4, 5] as const;        // the columns every schedule view shows
export const CLASS_DAYS = [0, 1, 2, 3, 4, 5, 6] as const;            // a class may be on any day
export const CONSULTATION_DAYS = [1, 2, 3, 4, 5] as const;           // consultation hours and student requests: Monday to Friday only

export const DAY_SHORT: Record<number, string> = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 0: 'Sun' };
export const DAY_LONG: Record<number, string> = { 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday', 0: 'Sunday' };

// Monday-first column (0 = Monday ... 6 = Sunday) of a stored day, and the stored day of a column.
export const columnOfDay = (d: number): number => (d + 6) % 7;
export const dayAtColumn = (c: number): number => (c + 1) % 7;

export const isConsultationDay = (d: number): boolean => (CONSULTATION_DAYS as readonly number[]).includes(d);

// Weekend columns are for staff only: students never see Saturday or Sunday.
export const canSeeWeekend = (role: string | null | undefined): boolean => role === 'FACULTY' || role === 'DEAN' || role === 'ADMIN';

/**
 * The stored days to show as columns, Monday first: Monday to Friday always, then Saturday (6) and/or Sunday (0).
 * A weekend day is added when `allowWeekend` is true AND (the faculty has a class that day OR `showWeekend` is on).
 * So a weekend column that holds a class can never be hidden, and an empty one appears only on request.
 */
export function visibleDays({ classDays, showWeekend = false, allowWeekend = true }: {
  classDays: number[]; showWeekend?: boolean; allowWeekend?: boolean;
}): number[] {
  const days: number[] = [...DEFAULT_VISIBLE_DAYS];
  if (allowWeekend) {
    if (showWeekend || classDays.includes(6)) days.push(6);
    if (showWeekend || classDays.includes(0)) days.push(0);
  }
  return days;
}
