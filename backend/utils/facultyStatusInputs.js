// Groups the day's database rows by faculty so resolveFacultyStatus can be called once per person.
const { timeToMinutes } = require('./timeMath');

const bookingRunning = (appts, nowMin) =>
  appts.some((a) => {
    const s = timeToMinutes(a.time);
    return s <= nowMin && nowMin < s + (Number(a.duration) || 60);
  });

// rows: { classes, official, added, entries, bookings }, each an array of lean docs for ALL listed faculty.
// Only today's classes/hours and today's APPROVED bookings should be passed in.
function groupStatusInputs(facultyIds, rows, nowMin) {
  const by = (arr) => {
    const m = new Map();
    for (const r of arr || []) {
      const k = String(r.facultyId);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    return m;
  };
  const classes = by(rows.classes), official = by(rows.official), added = by(rows.added);
  const entries = by(rows.entries), bookings = by(rows.bookings);
  const out = new Map();
  for (const id of facultyIds) {
    const k = String(id);
    out.set(k, {
      classBlocks: classes.get(k) || [],
      consultBlocks: [...(official.get(k) || []), ...(added.get(k) || [])],
      entries: entries.get(k) || [],
      hasBooking: bookingRunning(bookings.get(k) || [], nowMin),
    });
  }
  return out;
}

// Old screens still read currentStatus; keep them working until they use the new fields.
const toLegacyStatus = (s) => (s === 'VACANT' ? 'AVAILABLE' : s === 'CONSULTATION_HOURS' ? 'IN_CONSULTATION' : s);

module.exports = { groupStatusInputs, bookingRunning, toLegacyStatus };
