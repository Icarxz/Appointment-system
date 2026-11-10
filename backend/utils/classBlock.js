// Validation for one class block (a row of the Schedule model) that an admin adds or edits. Pure: no database access.
// Rules (the 30-minute class grid in Admin > Provision Account and Class Schedules uses the same ones):
//   - subject and room are required (short text); day is 0 (Sunday) to 6 (Saturday), the JavaScript convention;
//   - start and end are "HH:MM" on the 30-minute grid, between 07:00 and 19:00, and the end is after the start;
//   - a class may not overlap another class of the same faculty on the same day;
//   - a class may not cover an APPROVED future consultation (the student would show up while the professor teaches).
// Consultation hours that overlap a class are allowed: the booking calendar already hides those hours.

const { timeToMinutes } = require('./timeMath');

const FIRST_MINUTE = 7 * 60;   // 7:00 AM
const LAST_MINUTE = 19 * 60;   // 7:00 PM
const STEP = 30;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const dayOfWeekOf = (dateStr) => new Date(`${dateStr}T00:00:00Z`).getUTCDay();
const fmt12 = (t) => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };
const text = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

// siblings: the faculty's other classes [{ dayOfWeek, startTime, endTime, subject }] (leave the block being edited out).
// approved: APPROVED appointments dated today or later [{ date, time, duration }].
function validateClassBlock(raw, siblings = [], approved = []) {
  const subject = text(raw && raw.subject, 100);
  const room = text(raw && raw.room, 60);
  // 0 is a real day now (Sunday), so null, '' and false must not slip through Number() as 0.
  const rawDay = raw && raw.dayOfWeek;
  const dayOfWeek = typeof rawDay === 'number' || (typeof rawDay === 'string' && rawDay.trim() !== '') ? Number(rawDay) : NaN;
  const startTime = raw && raw.startTime;
  const endTime = raw && raw.endTime;

  if (!subject) return { ok: false, error: 'Subject is required.' };
  if (!room) return { ok: false, error: 'Room is required.' };
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) return { ok: false, error: 'Day must be Sunday to Saturday.' };
  if (typeof startTime !== 'string' || typeof endTime !== 'string' || !TIME_RE.test(startTime) || !TIME_RE.test(endTime)) {
    return { ok: false, error: 'Start and end must be times like 09:30.' };
  }
  const s = timeToMinutes(startTime), e = timeToMinutes(endTime);
  if (s % STEP || e % STEP) return { ok: false, error: 'Times must be on the hour or half hour.' };
  if (s < FIRST_MINUTE || e > LAST_MINUTE) return { ok: false, error: 'Classes must fall between 7:00 AM and 7:00 PM.' };
  if (e <= s) return { ok: false, error: 'The end time must be after the start time.' };

  const clash = siblings.find(c => Number(c.dayOfWeek) === dayOfWeek && s < timeToMinutes(c.endTime) && timeToMinutes(c.startTime) < e);
  if (clash) {
    return { ok: false, error: `Overlaps ${clash.subject || 'another class'} (${fmt12(clash.startTime)} - ${fmt12(clash.endTime)}) on ${DAY_NAMES[dayOfWeek]}.` };
  }

  const booked = approved.find(a => {
    if (!a || dayOfWeekOf(a.date) !== dayOfWeek) return false;
    const as = timeToMinutes(a.time);
    return s < as + (Number(a.duration) || 60) && as < e;
  });
  if (booked) return { ok: false, error: `An approved consultation on ${booked.date} at ${fmt12(booked.time)} falls in this time. Cancel or move it first.` };

  return { ok: true, value: { subject, room, dayOfWeek, startTime, endTime } };
}

module.exports = { validateClassBlock, FIRST_MINUTE, LAST_MINUTE, STEP };
