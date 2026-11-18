// Weekly request limit per student, per consultable person (project decision: the Dean gets 5 a week to keep his
// inbox manageable and cut missed requests; faculty have no limit, so `weeklyRequestLimit` is empty for them).
// Weeks run Monday to Sunday and are counted by the CONSULTATION date, not the date the request was made, so a
// student cannot book five for this week and five for next week in one sitting.
// Dates are Manila "YYYY-MM-DD" strings. Pure functions, no database.

// What uses up a place: open requests and consultations that happened or are going to.
// Declined, expired and cancelled-by-student requests never happened, so they do not count.
const COUNTED_STATUSES = ['PENDING', 'APPROVED', 'COMPLETED'];

const addDays = (dateStr, n) => {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// Monday..Sunday week containing dateStr.
function weekBounds(dateStr) {
  const dow = new Date(`${dateStr}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  const sinceMonday = (dow + 6) % 7;
  const start = addDays(dateStr, -sinceMonday);
  return { start, end: addDays(start, 6) };
}

// null / undefined / 0 / negative = no limit.
const limitOf = (v) => (Number.isInteger(v) && v > 0 ? v : null);

/**
 * @param existing  the student's appointments with this person ({ date, status })
 * @param date      the date being requested
 * @param limit     weeklyRequestLimit of the person being asked
 * @returns { ok, used, limit, remaining, week }
 */
function checkWeeklyLimit(existing, date, limit) {
  const week = weekBounds(date);
  const max = limitOf(limit);
  const used = existing.filter((a) => COUNTED_STATUSES.includes(a.status) && a.date >= week.start && a.date <= week.end).length;
  if (max === null) return { ok: true, used, limit: null, remaining: null, week };
  return { ok: used < max, used, limit: max, remaining: Math.max(0, max - used), week };
}

const limitMessage = (name, limit) =>
  `You have already used your ${limit} consultation requests with ${name || 'this person'} for that week. Please choose a date in another week.`;

module.exports = { COUNTED_STATUSES, weekBounds, limitOf, checkWeeklyLimit, limitMessage };
