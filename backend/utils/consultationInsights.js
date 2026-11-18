// Pure helpers for the Reports & Analytics "missed consultations" and
// "idle consultation hours" sections. No database access, so they can be tested alone.
// Dates are plain "YYYY-MM-DD" Philippine calendar dates; times are "HH:MM".

const pad = (n) => String(n).padStart(2, '0');
const toIso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };

// Appointment status names used across the system
const STATUS = {
  CANCELLED_STUDENT: 'CANCELLED BY STUDENT',
  CANCELLED_FACULTY: 'CANCELLED BY FACULTY',
  CANCELLED_LEAVE: 'CANCELLED (FACULTY ON LEAVE)',
  MISSED_STUDENT: 'MISSED (STUDENT)',
  MISSED_FACULTY: 'MISSED (FACULTY)',
};

// rows: [{ _id: '<raw status>', count }]  ->  full breakdown of what happened to appointments
function summarizeOutcomes(rows) {
  const o = {
    total: 0, pending: 0, approved: 0, completed: 0, rejected: 0, other: 0,
    cancelled: { total: 0, byStudent: 0, byFaculty: 0, onLeave: 0 },
    missed: { total: 0, student: 0, faculty: 0 },
  };
  rows.forEach(({ _id: s, count: n }) => {
    o.total += n;
    if (s === 'PENDING') o.pending += n;
    else if (s === 'APPROVED') o.approved += n;
    else if (s === 'COMPLETED') o.completed += n;
    else if (s === 'REJECTED') o.rejected += n;
    else if (s === STATUS.CANCELLED_STUDENT) { o.cancelled.byStudent += n; o.cancelled.total += n; }
    else if (s === STATUS.CANCELLED_FACULTY) { o.cancelled.byFaculty += n; o.cancelled.total += n; }
    else if (typeof s === 'string' && s.startsWith('CANCELLED')) { o.cancelled.onLeave += n; o.cancelled.total += n; } // leave + any older variant
    else if (s === STATUS.MISSED_STUDENT) { o.missed.student += n; o.missed.total += n; }
    else if (s === STATUS.MISSED_FACULTY) { o.missed.faculty += n; o.missed.total += n; }
    else o.other += n;
  });
  return o;
}

// rows: [{ _id: { f: facultyId, s: status }, count }], faculty: [{ _id, name }]
// -> one line per active faculty member, worst "problem count" first
function buildFacultyOutcomes(rows, faculty) {
  const by = new Map(faculty.map((f) => [String(f._id), {
    facultyId: String(f._id), name: f.name, total: 0, completed: 0, rejected: 0,
    cancelledByFaculty: 0, studentNoShows: 0, missedByFaculty: 0,
  }]));
  rows.forEach(({ _id, count }) => {
    const line = by.get(String(_id.f));
    if (!line) return;
    line.total += count;
    if (_id.s === 'COMPLETED') line.completed += count;
    else if (_id.s === 'REJECTED') line.rejected += count;
    else if (_id.s === STATUS.CANCELLED_FACULTY) line.cancelledByFaculty += count;
    else if (_id.s === STATUS.MISSED_STUDENT) line.studentNoShows += count;
    else if (_id.s === STATUS.MISSED_FACULTY) line.missedByFaculty += count;
  });
  return [...by.values()].sort((a, b) =>
    (b.missedByFaculty + b.cancelledByFaculty) - (a.missedByFaculty + a.cancelledByFaculty) ||
    b.total - a.total || a.name.localeCompare(b.name));
}

// rows: [{ _id: { s: studentKey, st: status }, name, section, count }]
// -> one line per student who has at least one completed / rejected / cancelled / missed by student,
//    most completed consultations first
function buildStudentOutcomes(rows) {
  const by = new Map();
  rows.forEach(({ _id, name, section, count }) => {
    const key = String(_id.s);
    if (!by.has(key)) by.set(key, { studentKey: key, name: name || 'Unknown', section: section || '', completed: 0, rejected: 0, cancelledByStudent: 0, noShows: 0 });
    const line = by.get(key);
    if (_id.st === 'COMPLETED') line.completed += count;
    else if (_id.st === 'REJECTED') line.rejected += count;
    else if (_id.st === STATUS.CANCELLED_STUDENT) line.cancelledByStudent += count;
    else if (_id.st === STATUS.MISSED_STUDENT) line.noShows += count;
  });
  return [...by.values()]
    .filter((l) => l.completed + l.rejected + l.cancelledByStudent + l.noShows > 0)
    .sort((a, b) => b.completed - a.completed || a.name.localeCompare(b.name));
}

function mondayOfIso(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return toIso(d);
}

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return toIso(d);
}

// For one Monday–Sunday week: every consultation-hour block of every faculty member, and
// whether anyone requested an appointment inside it. ANY status counts as a request
// (pending, approved, rejected, cancelled, missed, completed) because this measures demand.
//   hours:        [{ facultyId, dayOfWeek, startTime, endTime }]
//   appointments: [{ facultyId, date, time }]   (only that week's)
function buildIdleHours({ faculty, hours, appointments, weekStart, today, nowHHMM }) {
  const weekEnd = addDays(weekStart, 6);
  const nowMin = toMin(nowHHMM);
  const summary = { blocks: 0, withRequests: 0, idle: 0, upcoming: 0 };
  const noHours = [];

  const rows = faculty.map((f) => {
    const id = String(f._id);
    const mine = hours.filter((h) => String(h.facultyId) === id);
    if (!mine.length) noHours.push(f.name);
    const apts = appointments.filter((a) => String(a.facultyId) === id);

    const slots = mine.map((h) => {
      const date = addDays(weekStart, h.dayOfWeek === 0 ? 6 : h.dayOfWeek - 1);
      const s = toMin(h.startTime), e = toMin(h.endTime);
      const requests = apts.filter((a) => a.date === date && toMin(a.time) >= s && toMin(a.time) < e).length;
      const ended = date < today || (date === today && nowMin >= e);
      const state = requests > 0 ? 'REQUESTED' : ended ? 'IDLE' : 'UPCOMING';
      return { date, dayOfWeek: h.dayOfWeek, start: h.startTime, end: h.endTime, requests, state };
    }).sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));

    const line = {
      facultyId: id, name: f.name, blocks: slots.length,
      withRequests: slots.filter((x) => x.state === 'REQUESTED').length,
      idle: slots.filter((x) => x.state === 'IDLE').length,
      upcoming: slots.filter((x) => x.state === 'UPCOMING').length,
      slots,
    };
    summary.blocks += line.blocks; summary.withRequests += line.withRequests;
    summary.idle += line.idle; summary.upcoming += line.upcoming;
    return line;
  }).sort((a, b) => b.idle - a.idle || a.name.localeCompare(b.name));

  return { weekStart, weekEnd, today, summary, faculty: rows, facultyWithoutHours: noHours };
}

module.exports = { STATUS, summarizeOutcomes, buildFacultyOutcomes, buildStudentOutcomes, mondayOfIso, addDays, buildIdleHours };
