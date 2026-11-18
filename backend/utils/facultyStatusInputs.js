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
// NONE ("--") has no old equivalent that means "no scheduled status", so it maps to NOT_UPDATED (shown as a plain badge).
const toLegacyStatus = (s) => (s === 'VACANT' ? 'AVAILABLE' : s === 'CONSULTATION_HOURS' ? 'IN_CONSULTATION' : s === 'NONE' ? 'NOT_UPDATED' : s);

// What students may see: posted meetings and leave that have not ended, soonest first.
// The "Other" reason shows the faculty's own words. Nothing else about the entry is exposed.
function publicNotices(entries, now = new Date(), limit = 3) {
  return (entries || [])
    .filter((e) => e.isNotice && new Date(e.endAt) > now)
    .sort((a, b) => new Date(a.startAt) - new Date(b.startAt))
    .slice(0, limit)
    .map((e) => ({
      _id: String(e._id), type: e.type,
      reason: e.reason === 'Other' && e.reasonOther ? e.reasonOther : e.reason,
      startAt: e.startAt, endAt: e.endAt, makeUpInfo: e.makeUpInfo || '',
    }));
}

module.exports = { groupStatusInputs, bookingRunning, toLegacyStatus, publicNotices };
