// The rules behind the Post a Notice calendar: how taps become a meeting time or a leave range, and how
// the confirmation text reads. Pure functions (no React, no clock), so they are easy to test.
// Dates are Manila "YYYY-MM-DD" strings. The server checks everything again (backend/utils/noticeWindow.js).

export const CAL_START_HOUR = 7;   // the calendar shows 7:00 AM ...
export const CAL_END_HOUR = 17;    // ... to 5:00 PM

// ---- date and time text ----
export const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const mondayOf = (iso: string): string => {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return addDays(iso, dow === 0 ? -6 : 1 - dow);
};
export const dayText = (iso: string): string =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
export const hhmm = (hour: number): string => `${String(hour).padStart(2, '0')}:00`;
const meridiem = (h: number) => (h >= 12 ? 'PM' : 'AM');
const h12 = (h: number) => (h % 12 === 0 ? 12 : h % 12);
export const hourText = (h: number): string => `${h12(h)}:00 ${meridiem(h)}`;

// ---- meeting: tap a start hour, then an end hour on the same day ----
export interface MeetingPick { date: string; startHour: number; endHour: number | null }
export interface PickResult<T> { sel: T | null; error?: string; done?: boolean }

export function pickMeeting(cur: MeetingPick | null, date: string, hour: number): PickResult<MeetingPick> {
  // Nothing picked yet, or the last range is finished: this tap starts a new one.
  if (!cur || cur.endHour !== null) {
    if (hour >= CAL_END_HOUR) return { sel: cur, error: 'Pick a start hour before 5:00 PM.' };
    return { sel: { date, startHour: hour, endHour: null } };
  }
  if (date !== cur.date) return { sel: cur, error: 'Pick the end hour on the same day as the start.' };
  if (hour <= cur.startHour) return { sel: cur, error: 'The end must be after the start.' }; // never silently reversed
  if (hour > CAL_END_HOUR) return { sel: cur, error: 'A meeting must end by 5:00 PM.' };
  return { sel: { ...cur, endHour: hour }, done: true };
}

export const meetingTimes = (m: MeetingPick) => ({ date: m.date, startTime: hhmm(m.startHour), endTime: hhmm(m.endHour ?? m.startHour) });

// "Meeting on Fri, Nov 20, 1:00 to 3:00 PM?"  (the AM/PM is said once when both times share it)
export function meetingQuestion(m: MeetingPick): string {
  const end = m.endHour ?? m.startHour;
  const startText = meridiem(m.startHour) === meridiem(end) ? `${h12(m.startHour)}:00` : hourText(m.startHour);
  return `Meeting on ${dayText(m.date)}, ${startText} to ${hourText(end)}?`;
}

// ---- leave: tap the first day, then the last day (whole day, or the morning / afternoon half) ----
export type DayPart = 'FULL' | 'AM' | 'PM';
export interface LeavePickPoint { date: string; part: DayPart }
export interface LeavePick { start: LeavePickPoint | null; end: LeavePickPoint | null }

// A leave that starts on a morning tap still starts at the beginning of that day, and one that ends on an
// afternoon tap still ends at the end of that day. So only "afternoon first day" and "morning last day" are half days.
const startPart = (p: LeavePickPoint): 'FULL' | 'PM' => (p.part === 'PM' ? 'PM' : 'FULL');
const endPart = (p: LeavePickPoint): 'FULL' | 'AM' => (p.part === 'AM' ? 'AM' : 'FULL');

export function pickLeave(cur: LeavePick, point: LeavePickPoint): PickResult<LeavePick> {
  if (!cur.start || cur.end) return { sel: { start: point, end: null } }; // a new range starts here
  if (point.date < cur.start.date) return { sel: cur, error: 'The last day cannot be before the first day.' };
  if (point.date === cur.start.date && startPart(cur.start) === 'PM' && endPart(point) === 'AM') {
    return { sel: cur, error: 'The leave would end before it starts.' };
  }
  return { sel: { start: cur.start, end: point }, done: true };
}

export function leavePayload(l: LeavePick) {
  const s = l.start as LeavePickPoint, e = (l.end || l.start) as LeavePickPoint;
  return { startDate: s.date, endDate: e.date, startPart: startPart(s), endPart: endPart(e) };
}

// Which halves of a day are inside the leave (to colour the calendar). Only the first day while the last is not picked.
export function leaveCoverage(l: LeavePick, date: string): { am: boolean; pm: boolean } {
  if (!l.start) return { am: false, pm: false };
  const p = leavePayload(l.end ? l : { start: l.start, end: l.start });
  if (date < p.startDate || date > p.endDate) return { am: false, pm: false };
  return { am: date === p.startDate ? p.startPart !== 'PM' : true, pm: date === p.endDate ? p.endPart !== 'AM' : true };
}

// "Leave from Fri, Nov 20 (half day) to Mon, Nov 23 (whole day)?"  Half-day wording appears only when a half day was picked.
export function leaveQuestion(l: LeavePick): string {
  const p = leavePayload(l);
  const first = p.startPart === 'PM' ? 'half day, afternoon' : 'whole day';
  const last = p.endPart === 'AM' ? 'half day, morning' : 'whole day';
  if (p.startDate === p.endDate) {
    const only = p.startPart === 'PM' ? 'half day, afternoon' : p.endPart === 'AM' ? 'half day, morning' : 'whole day';
    return `Leave on ${dayText(p.startDate)} (${only})?`;
  }
  return `Leave from ${dayText(p.startDate)} (${first}) to ${dayText(p.endDate)} (${last})?`;
}
