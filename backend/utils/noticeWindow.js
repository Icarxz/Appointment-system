// Turns the Post a Notice form into a start and end time (Manila time).
//   Meeting: one date + start time + end time.   Leave: first date to last date, all day.
const { manilaNow, manilaDate } = require('./manilaTime');

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_MS = 24 * 3600000;
const MAX_LEAVE_DAYS = 60;
const MAX_AHEAD_DAYS = 365;

function windowFromNotice(b = {}, now = new Date()) {
  const today = manilaNow(now).dateStr;
  const dayStart = (d) => manilaDate(d, '00:00');
  const validDate = (d) => DATE.test(String(d || '')) && !isNaN(dayStart(d));

  if (b.type !== 'IN_MEETING' && b.type !== 'ON_LEAVE') return { ok: false, error: 'Choose Meeting or Leave.' };
  if (!validDate(b.startDate)) return { ok: false, error: 'Pick a date.' };
  if (b.startDate < today) return { ok: false, error: 'Pick today or a later date.' };
  if (dayStart(b.startDate) - dayStart(today) > MAX_AHEAD_DAYS * DAY_MS) return { ok: false, error: 'That date is too far ahead.' };

  if (b.type === 'IN_MEETING') {
    if (!HHMM.test(String(b.startTime || '')) || !HHMM.test(String(b.endTime || ''))) return { ok: false, error: 'Choose a start and end time.' };
    if (b.endTime <= b.startTime) return { ok: false, error: 'The end time must be after the start time.' };
    return { ok: true, startAt: manilaDate(b.startDate, b.startTime), endAt: manilaDate(b.startDate, b.endTime) };
  }

  const endDate = b.endDate || b.startDate;
  if (!validDate(endDate)) return { ok: false, error: 'Pick the last day of your leave.' };
  if (endDate < b.startDate) return { ok: false, error: 'The last day cannot be before the first day.' };
  const days = Math.round((dayStart(endDate) - dayStart(b.startDate)) / DAY_MS) + 1;
  if (days > MAX_LEAVE_DAYS) return { ok: false, error: `Leave can be at most ${MAX_LEAVE_DAYS} days at a time.` };
  return { ok: true, startAt: dayStart(b.startDate), endAt: new Date(dayStart(endDate).getTime() + DAY_MS) };
}

module.exports = { windowFromNotice, MAX_LEAVE_DAYS };
