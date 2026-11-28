export interface CalendarInterval {
  id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export const CALENDAR_START_MINUTES = 7 * 60;
export const CALENDAR_END_MINUTES = 19 * 60;
export const CALENDAR_STEP_MINUTES = 30;
export const CALENDAR_SLOT_COUNT = (CALENDAR_END_MINUTES - CALENDAR_START_MINUTES) / CALENDAR_STEP_MINUTES;

export function timeToMinutes(time: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function calendarTimeAtSlot(slot: number): string | null {
  if (!Number.isInteger(slot) || slot < 0 || slot >= CALENDAR_SLOT_COUNT) return null;
  const minutes = CALENDAR_START_MINUTES + slot * CALENDAR_STEP_MINUTES;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function intervalsOverlap(a: CalendarInterval, b: CalendarInterval): boolean {
  const aStart = timeToMinutes(a.startTime);
  const aEnd = timeToMinutes(a.endTime);
  const bStart = timeToMinutes(b.startTime);
  const bEnd = timeToMinutes(b.endTime);
  return Number.isInteger(a.dayOfWeek) && a.dayOfWeek >= 0 && a.dayOfWeek <= 6
    && a.dayOfWeek === b.dayOfWeek
    && aStart !== null && aEnd !== null && bStart !== null && bEnd !== null
    && aEnd > aStart && bEnd > bStart
    && aStart < bEnd && bStart < aEnd;
}

export function findOverlappingIds<T extends CalendarInterval>(events: readonly T[]): string[] {
  const overlapping = new Set<string>();
  events.forEach((event, index) => {
    events.slice(index + 1).forEach(other => {
      if (intervalsOverlap(event, other)) {
        overlapping.add(event.id);
        overlapping.add(other.id);
      }
    });
  });
  return [...overlapping];
}

export function calendarEventPosition(
  startTime: string,
  endTime: string,
  slotHeight: number,
): { top: number; height: number } | null {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  if (start === null || end === null || end <= start || !Number.isFinite(slotHeight) || slotHeight <= 0) return null;

  const visibleHeight = Math.max(14, slotHeight - 2);
  if (end <= CALENDAR_START_MINUTES) return { top: 0, height: visibleHeight };
  if (start >= CALENDAR_END_MINUTES) {
    return {
      top: ((CALENDAR_END_MINUTES - CALENDAR_START_MINUTES) / CALENDAR_STEP_MINUTES - 1) * slotHeight,
      height: visibleHeight,
    };
  }

  const clippedStart = Math.max(start, CALENDAR_START_MINUTES);
  const clippedEnd = Math.min(end, CALENDAR_END_MINUTES);
  if (clippedEnd <= clippedStart) return null;

  return {
    top: ((clippedStart - CALENDAR_START_MINUTES) / CALENDAR_STEP_MINUTES) * slotHeight,
    height: Math.max(14, ((clippedEnd - clippedStart) / CALENDAR_STEP_MINUTES) * slotHeight - 2),
  };
}
