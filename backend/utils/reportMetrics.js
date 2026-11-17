// Pure metric builders for the Reports & Analytics pages (Admin/Dean shared report and the
// faculty "My Analytics"). No database access, so every rule can be unit-tested.
// Dates are Manila "YYYY-MM-DD" strings, times are "HH:MM".
//
// Rules agreed for the project (see the analytics plan):
//  - PENDING requests are never counted in `requests` or any rate; they are reported beside them as `pending`.
//  - Appeals never reduce a miss count; they are reported beside it.
//  - Missed rate = missed / (completed + missed).
const { collapsePurposes, weekRange, bucketWeekly, shiftIso } = require('./analyticsHelpers');
const { isProfileComplete } = require('./signInPolicy');

// Must match STUDENT_APPEAL_REASONS in frontend/src/components/CancelReasonPicker.tsx.
const STUDENT_APPEAL_REASONS = [
  'Medical / Health Emergency',
  'Family Emergency',
  'Academic Conflict',
  'Transportation / Weather Issues',
  'Connectivity / Technical Problem',
];

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const COHORT_RE = /^(.+?)\s+(\d)([A-Za-z])$/; // "BS INFO 4D" -> program, year, section

const isCounted = (a) => a.status !== 'PENDING';
const isMissedStudent = (s) => s === 'MISSED (STUDENT)';
const isMissedFaculty = (s) => s === 'MISSED (FACULTY)';
const isMissed = (s) => isMissedStudent(s) || isMissedFaculty(s);
const isCancelledStudent = (s) => s === 'CANCELLED BY STUDENT';
const isCancelledFaculty = (s) => s === 'CANCELLED BY FACULTY' || s === 'CANCELLED (FACULTY ON LEAVE)';

const pct = (num, den) => (den ? Math.round((num / den) * 1000) / 10 : null);
const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
const dayOfWeek = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0 = Sunday
const hourLabel = (h) => `${((h + 11) % 12) + 1} ${h >= 12 ? 'PM' : 'AM'}`;

// "BS INFO 4D" -> { program: 'BS INFO', year: '4', section: 'D' }; anything else -> Unspecified
function parseCohort(text) {
  const m = COHORT_RE.exec(String(text || '').trim());
  return m ? { program: m[1], year: m[2], section: m[3].toUpperCase() } : { program: 'Unspecified', year: '', section: '' };
}

// Every non-pending status the outcome buckets below understand.
const KNOWN_STATUS = (a) => a.status === 'COMPLETED' || a.status === 'APPROVED' || a.status === 'REJECTED'
  || isMissed(a.status) || isCancelledStudent(a.status) || isCancelledFaculty(a.status);

// All the headline counts for a set of appointments.
function outcomeCounts(appointments) {
  const by = (pred) => appointments.filter((a) => pred(a.status)).length;
  const completed = by((s) => s === 'COMPLETED');
  const missedStudent = by(isMissedStudent);
  const missedFaculty = by(isMissedFaculty);
  const missed = missedStudent + missedFaculty;
  return {
    requests: appointments.filter(isCounted).length,
    // Pending is reported beside the counted outcomes, never inside them. submitted = pending + requests.
    pending: appointments.filter((a) => a.status === 'PENDING').length,
    submitted: appointments.length,
    completed,
    upcoming: by((s) => s === 'APPROVED'),
    // A request the system rejected because nobody answered it is "expired", not a faculty decision.
    declined: appointments.filter((a) => a.status === 'REJECTED' && !a.autoRejected).length,
    expired: appointments.filter((a) => a.status === 'REJECTED' && a.autoRejected).length,
    missedStudent,
    missedFaculty,
    missed,
    cancelledStudent: by(isCancelledStudent),
    cancelledFaculty: by(isCancelledFaculty),
    // A status this code does not know (an older or misspelled value) is kept in the totals and shown, not dropped.
    other: appointments.filter((a) => isCounted(a) && !KNOWN_STATUS(a)).length,
    completionRate: pct(completed, completed + missed),
    missedRate: pct(missed, completed + missed),
  };
}

// total, last 4 weeks and the 4 weeks before that, for one kind of appointment.
function windowCounts(appointments, todayIso, pred) {
  const start4 = shiftIso(todayIso, -27);
  const startPrev = shiftIso(todayIso, -55);
  const endPrev = shiftIso(todayIso, -28);
  const rows = appointments.filter(pred);
  return {
    total: rows.length,
    last4: rows.filter((a) => a.date >= start4 && a.date <= todayIso).length,
    prev4: rows.filter((a) => a.date >= startPrev && a.date <= endPrev).length,
  };
}

// [{ name, count }] sorted by count then name
function actorList(appointments, keyFn, nameFn) {
  const m = new Map();
  appointments.forEach((a) => {
    const key = keyFn(a);
    if (!key) return;
    const cur = m.get(key) || { name: nameFn(a, key), count: 0 };
    cur.count += 1;
    m.set(key, cur);
  });
  return [...m.values()].sort((x, y) => y.count - x.count || String(x.name).localeCompare(String(y.name)));
}

const studentKey = (a) => String(a.studentId || a.studentName || '');
const studentName = (a) => a.studentName || 'Unknown student';

// Busiest day × hour. The hour window is the real consultation-hour window (earliest start to
// latest end across the given hours), widened if appointments fall outside it. Rows are hours.
function buildHeatmap(appointments, hoursRows = []) {
  const counted = appointments.filter((a) => isCounted(a) && a.date && a.time && dayOfWeek(a.date) >= 1);
  const hourOf = (a) => Math.floor(toMin(a.time) / 60);

  let lo = null;
  let hi = null;
  const widen = (a, b) => { lo = lo === null ? a : Math.min(lo, a); hi = hi === null ? b : Math.max(hi, b); };
  hoursRows.forEach((h) => { if (h.startTime && h.endTime) widen(Math.floor(toMin(h.startTime) / 60), Math.ceil(toMin(h.endTime) / 60) - 1); });
  counted.forEach((a) => widen(hourOf(a), hourOf(a)));
  if (lo === null) { lo = 8; hi = 16; } // nothing to go on yet: 8 AM to 5 PM

  const hours = [];
  for (let h = lo; h <= hi; h++) hours.push({ hour: h, label: hourLabel(h) });
  const cells = hours.map(() => DAY_LABELS.map(() => 0));
  counted.forEach((a) => {
    const r = hourOf(a) - lo;
    const c = dayOfWeek(a.date) - 1;
    if (cells[r] && c >= 0 && c < 6) cells[r][c] += 1;
  });
  return { days: DAY_LABELS, hours, cells, max: Math.max(0, ...cells.flat()) };
}

// Students' appeals (record only, no review), grouped for the filterable table.
function buildAppealRows(appointments) {
  const m = new Map();
  appointments.forEach((a) => {
    const ap = a.appeal;
    if (!ap || ap.by !== 'STUDENT') return;
    const c = parseCohort(a.studentSection);
    const reason = STUDENT_APPEAL_REASONS.includes(ap.reason) ? ap.reason : 'Other';
    const key = [c.program, c.year, c.section, reason].join('|');
    const row = m.get(key) || { program: c.program, year: c.year, section: c.section, reason, count: 0 };
    row.count += 1;
    m.set(key, row);
  });
  return [...m.values()];
}

function buildAppealSummary(appointments) {
  const studentAppeals = appointments.filter((a) => a.appeal && a.appeal.by === 'STUDENT');
  const facultyAppeals = appointments.filter((a) => a.appeal && a.appeal.by === 'FACULTY');
  const missedStudent = appointments.filter((a) => isMissedStudent(a.status));
  const appealedMisses = missedStudent.filter((a) => a.appeal && a.appeal.by === 'STUDENT').length;
  return {
    appealRate: pct(appealedMisses, missedStudent.length),
    total: studentAppeals.length,
    faculty: { made: facultyAppeals.length },
  };
}

// Registered students by program / year / section, from their profile ("BS INFO 4D").
function buildCohortRows(users) {
  const m = new Map();
  users.filter((u) => u.role === 'STUDENT' && u.accountStatus === 'ACTIVE').forEach((u) => {
    const c = parseCohort(u.programPosition);
    const key = [c.program, c.year, c.section].join('|');
    const row = m.get(key) || { ...c, count: 0 };
    row.count += 1;
    m.set(key, row);
  });
  return [...m.values()];
}

function purposeRows(appointments) {
  const m = new Map();
  appointments.filter(isCounted).forEach((a) => {
    const p = String(a.reason || '').trim().toLowerCase();
    if (p) m.set(p, (m.get(p) || 0) + 1);
  });
  return [...m.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(([purpose, count]) => ({ purpose, count }));
}

function weeklySeries(appointments, todayIso, pred = isCounted, weeks = 8) {
  const range = weekRange(todayIso, weeks);
  const perDate = new Map();
  appointments.filter(pred).forEach((a) => perDate.set(a.date, (perDate.get(a.date) || 0) + 1));
  return bucketWeekly(range, [...perDate.entries()].map(([_id, count]) => ({ _id, count })));
}

// A timestamp (Date or ISO string) as a Manila calendar date "YYYY-MM-DD"; '' when missing or invalid.
function manilaDateOf(value) {
  const t = value ? new Date(value).getTime() : NaN;
  return Number.isNaN(t) ? '' : new Date(t + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

// Requests per week by the day the student SUBMITTED them (createdAt, Manila time), pending included.
// weeklySeries above groups by the scheduled consultation date instead; the two answer different questions.
function weeklyCreatedSeries(appointments, todayIso, weeks = 8) {
  const range = weekRange(todayIso, weeks);
  const perDate = new Map();
  appointments.forEach((a) => {
    const d = manilaDateOf(a.createdAt);
    if (d) perDate.set(d, (perDate.get(d) || 0) + 1);
  });
  return bucketWeekly(range, [...perDate.entries()].map(([_id, count]) => ({ _id, count })));
}

// Last N calendar months ending with the current one: [{ label: "Oct '26", value }]
function monthlySeries(appointments, todayIso, months = 6) {
  const [y, mo] = todayIso.split('-').map(Number);
  const keys = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, mo - 1 - i, 1));
    keys.push({ key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`, label: `${MONTHS[d.getUTCMonth()]} '${String(d.getUTCFullYear()).slice(2)}` });
  }
  const counts = new Map(keys.map((k) => [k.key, 0]));
  appointments.filter(isCounted).forEach((a) => {
    const key = String(a.date || '').slice(0, 7);
    if (counts.has(key)) counts.set(key, counts.get(key) + 1);
  });
  return keys.map((k) => ({ label: k.label, value: counts.get(k.key) }));
}

// One line per active faculty member (also those with no appointments yet).
function buildFacultyOutcomeRows(appointments, faculty) {
  return faculty.map((f) => {
    const c = outcomeCounts(appointments.filter((a) => String(a.facultyId) === String(f._id)));
    return {
      facultyId: String(f._id), name: f.name, programPosition: f.programPosition || '',
      requests: c.requests, completed: c.completed, declined: c.declined, expired: c.expired,
      cancelledByFaculty: c.cancelledFaculty, missedByFaculty: c.missedFaculty, studentNoShows: c.missedStudent,
    };
  }).sort((a, b) => b.completed - a.completed || b.requests - a.requests || a.name.localeCompare(b.name));
}

// One line per student who has at least one result (pending alone is not counted).
function buildStudentOutcomeRows(appointments) {
  const by = new Map();
  appointments.filter(isCounted).forEach((a) => {
    const key = studentKey(a);
    if (!key) return;
    const line = by.get(key) || { studentKey: key, name: studentName(a), section: a.studentSection || '', completed: 0, declined: 0, cancelledByStudent: 0, noShows: 0 };
    if (a.status === 'COMPLETED') line.completed += 1;
    else if (a.status === 'REJECTED' && !a.autoRejected) line.declined += 1;
    else if (isCancelledStudent(a.status)) line.cancelledByStudent += 1;
    else if (isMissedStudent(a.status)) line.noShows += 1;
    by.set(key, line);
  });
  return [...by.values()]
    .filter((l) => l.completed + l.declined + l.cancelledByStudent + l.noShows > 0)
    .sort((a, b) => b.completed - a.completed || a.name.localeCompare(b.name));
}

// Gender comes from the profile; older accounts have none and count as "Not provided".
function buildGender(users) {
  const tally = (role) => {
    const m = new Map();
    users.filter((u) => u.role === role && u.accountStatus === 'ACTIVE').forEach((u) => {
      const g = ['Male', 'Female', 'Prefer not to say'].includes(u.gender) ? u.gender : 'Not provided';
      m.set(g, (m.get(g) || 0) + 1);
    });
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([label, value]) => ({ label, value }));
  };
  return { students: tally('STUDENT'), faculty: tally('FACULTY') };
}

// Admin only: who has (not) finished their profile, and users per role.
function buildAccountHealth(users) {
  const active = users.filter((u) => u.accountStatus === 'ACTIVE');
  const roles = ['STUDENT', 'FACULTY', 'DEAN', 'ADMIN'];
  const byRole = roles.map((role) => ({ label: role, value: active.filter((u) => u.role === role).length }));
  const profile = roles.map((role) => {
    const list = active.filter((u) => u.role === role);
    const incomplete = list.filter((u) => !isProfileComplete(u));
    return {
      role,
      complete: list.length - incomplete.length,
      incomplete: incomplete.length,
      incompleteList: incomplete.map((u) => ({ name: u.name, email: u.email })).sort((a, b) => String(a.name).localeCompare(String(b.name))),
    };
  });
  return { byRole, profile };
}

// Everything the shared Admin/Dean report needs.
function buildSharedReport({ appointments, users, hoursRows = [], todayIso, includeAccountHealth = false }) {
  const faculty = users.filter((u) => u.role === 'FACULTY' && u.accountStatus === 'ACTIVE');
  const facultyName = new Map(faculty.map((f) => [String(f._id), f.name]));
  const nameOfFaculty = (a, key) => facultyName.get(key) || 'Unknown faculty';
  const facultyKey = (a) => String(a.facultyId || '');
  const counts = outcomeCounts(appointments);

  const facultyLoad = faculty.map((f) => {
    const mine = appointments.filter((a) => String(a.facultyId) === String(f._id));
    const c = outcomeCounts(mine);
    return { id: String(f._id), name: f.name, requests: c.requests, completed: c.completed };
  }).sort((a, b) => b.requests - a.requests || b.completed - a.completed || a.name.localeCompare(b.name));

  const on = (pred) => appointments.filter((a) => pred(a.status));
  const report = {
    kpis: {
      requests: windowCounts(appointments, todayIso, isCounted),
      completed: windowCounts(appointments, todayIso, (a) => a.status === 'COMPLETED'),
      missed: { ...windowCounts(appointments, todayIso, (a) => isMissed(a.status)), student: counts.missedStudent, faculty: counts.missedFaculty },
      completionRate: counts.completionRate,
      missedRate: counts.missedRate,
      activeFaculty: faculty.length,
    },
    outcomes: counts,
    weekly: weeklySeries(appointments, todayIso),
    weeklyCreated: weeklyCreatedSeries(appointments, todayIso),
    weeklyMissed: weeklySeries(appointments, todayIso, (a) => isMissed(a.status)),
    facultyLoad,
    purposes: collapsePurposes(purposeRows(appointments), 6),
    heatmap: buildHeatmap(appointments, hoursRows),
    cohortStudents: buildCohortRows(users),
    gender: buildGender(users),
    facultyOutcomes: buildFacultyOutcomeRows(appointments, faculty),
    studentOutcomes: buildStudentOutcomeRows(appointments),
    appeals: {
      summary: buildAppealSummary(appointments),
      rows: buildAppealRows(appointments),
      reasons: [...STUDENT_APPEAL_REASONS, 'Other'],
    },
    // Clickable tiles: who is behind each number. Missed and cancelled split by who caused it.
    drilldown: {
      requests: { students: actorList(appointments.filter(isCounted), studentKey, studentName), faculty: actorList(appointments.filter(isCounted), facultyKey, nameOfFaculty) },
      completed: { students: actorList(on((s) => s === 'COMPLETED'), studentKey, studentName), faculty: actorList(on((s) => s === 'COMPLETED'), facultyKey, nameOfFaculty) },
      missed: { students: actorList(on(isMissedStudent), studentKey, studentName), faculty: actorList(on(isMissedFaculty), facultyKey, nameOfFaculty) },
      cancelled: { students: actorList(on(isCancelledStudent), studentKey, studentName), faculty: actorList(on(isCancelledFaculty), facultyKey, nameOfFaculty) },
    },
  };
  if (includeAccountHealth) report.accountHealth = buildAccountHealth(users);
  return report;
}

module.exports = {
  isCounted, isMissed, isMissedStudent, isMissedFaculty, isCancelledStudent, isCancelledFaculty, studentKey, studentName,
  STUDENT_APPEAL_REASONS, parseCohort, outcomeCounts, windowCounts, actorList, buildHeatmap,
  buildAppealRows, buildAppealSummary, buildCohortRows, purposeRows, weeklySeries, weeklyCreatedSeries, manilaDateOf, monthlySeries,
  buildFacultyOutcomeRows, buildStudentOutcomeRows, buildGender, buildAccountHealth, buildSharedReport,
};
