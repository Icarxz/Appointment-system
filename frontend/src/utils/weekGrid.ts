// Turns the server's slots + busy times into the cells of the student's weekly calendar (Monday to Friday x hour).
// Pure functions with no imports, so the logic is easy to check on its own.
//
// One cell is one clock hour of one day. What a cell shows:
//   CONSULT  green      a bookable consultation hour (official or added)
//   VACANT   dashed     a bookable free hour (no label, by design)
//   FULL     red        bookable hour that already has the maximum pending requests
//   CLASS    grey       the professor teaches (not clickable)
//   BOOKED   red        already approved for someone else (not clickable)
//   PAST     faint grey the hour has already started
//   SOON     faint grey inside the lead time (requests close 1 hour before the start)
//   NONE     faint grey nothing to book (leave day, or outside the 4-week window)

export interface Slot { date: string; start: string; end: string; duration: number; kind: 'OFFICIAL' | 'ADDED' | 'VACANT'; pending: number; full: boolean }
export interface Busy { date: string; start: string; end: string; type: 'CLASS' | 'BOOKED' }
export type PartState = 'CONSULT' | 'VACANT' | 'FULL' | 'CLASS' | 'BOOKED' | 'PAST' | 'SOON' | 'NONE';
export interface Part { state: PartState; slot?: Slot }
export interface Cell { date: string; hour: number; parts: Part[] }
export interface WeekGrid { dates: string[]; hours: number[]; cells: Record<string, Cell> }

export const cellKey = (date: string, hour: number): string => `${date}|${hour}`;

const toMin = (hhmm: string): number => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

const addDaysIso = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const dowOf = (iso: string): number => new Date(`${iso}T00:00:00Z`).getUTCDay();

/**
 * @param weekStart  the Monday of the week to show ("YYYY-MM-DD", Manila)
 * @param nowMs      the current time (epoch ms)
 * @param leadHours  how long before the start requests close (the server sends it; 1)
 */
export function buildWeekGrid({ slots, busy, weekStart, nowMs, leadHours }: {
  slots: Slot[]; busy: Busy[]; weekStart: string; nowMs: number; leadHours: number;
}): WeekGrid {
  const weekDates = Array.from({ length: 7 }, (_, i) => addDaysIso(weekStart, i));
  const inWeek = slots.filter(s => weekDates.includes(s.date));

  // Monday to Friday always; Saturday only when a professor has bookable hours that day.
  const dates = weekDates.filter(d => { const w = dowOf(d); return (w >= 1 && w <= 5) || (w === 6 && inWeek.some(s => s.date === d)); });

  // 8 AM to 5 PM rows, plus any earlier row a consultation slot needs (e.g. a 7:30 AM start).
  const startHours = inWeek.map(s => Math.floor(toMin(s.start) / 60));
  const firstHour = Math.min(8, ...startHours);
  const lastHour = Math.max(16, ...startHours);
  const hours = Array.from({ length: lastHour - firstHour + 1 }, (_, i) => firstHour + i);

  const cells: Record<string, Cell> = {};
  for (const date of dates) {
    for (const hour of hours) {
      const here = inWeek
        .filter(s => s.date === date && Math.floor(toMin(s.start) / 60) === hour)
        .sort((a, b) => a.start.localeCompare(b.start));
      let parts: Part[];
      if (here.length) {
        parts = here.map(slot => ({ state: slot.full ? 'FULL' : slot.kind === 'VACANT' ? 'VACANT' : 'CONSULT', slot }));
      } else {
        const hit = busy.filter(b => b.date === date && toMin(b.start) < (hour + 1) * 60 && hour * 60 < toMin(b.end));
        const startMs = new Date(`${date}T${String(hour).padStart(2, '0')}:00:00+08:00`).getTime();
        let state: PartState;
        if (hit.some(b => b.type === 'CLASS')) state = 'CLASS';
        else if (hit.some(b => b.type === 'BOOKED')) state = 'BOOKED';
        else if (startMs < nowMs) state = 'PAST';
        else if (startMs - nowMs < leadHours * 36e5) state = 'SOON';
        else state = 'NONE';
        parts = [{ state }];
      }
      cells[cellKey(date, hour)] = { date, hour, parts };
    }
  }
  return { dates, hours, cells };
}
