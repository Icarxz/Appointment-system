// What a schedule calendar may show of a faculty member's bookings: only ACCEPTED (APPROVED) and finished
// (COMPLETED) consultations. Pending requests, rejected, cancelled and missed ones are never shown, and no
// student name or reason is ever included, so a student looking at a professor's calendar learns nothing private.

const SHOWN = ['APPROVED', 'COMPLETED'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 62;

const dayNumber = (iso) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86400000);

// Validates ?from=&to= (inclusive). Returns { from, to } or { error }.
function parseRange(from, to) {
  if (!ISO.test(String(from || '')) || !ISO.test(String(to || ''))) return { error: 'from and to must be YYYY-MM-DD.' };
  if (Number.isNaN(dayNumber(from)) || Number.isNaN(dayNumber(to))) return { error: 'from and to must be real dates.' };
  if (to < from) return { error: 'to must not be before from.' };
  if (dayNumber(to) - dayNumber(from) > MAX_DAYS) return { error: `Ask for at most ${MAX_DAYS} days at a time.` };
  return { from, to };
}

// Appointment documents -> the few fields a calendar block needs.
function toBookingBlocks(appointments) {
  return (appointments || [])
    .filter(a => SHOWN.includes(a.status))
    .map(a => ({ date: a.date, time: a.time, duration: a.duration || 60, status: a.status }));
}

module.exports = { SHOWN, parseRange, toBookingBlocks };
