const test = require('node:test');
const assert = require('node:assert');
const { parseCohort, buildCohortRows, buildAccountHealth, buildSharedReport, buildAppealRows, buildAppealSummary, buildStudentOutcomeRows, buildFacultyOutcomeRows, buildGender } = require('./reportMetrics');

const today = '2026-10-26';
const apt = (o) => ({ status: 'COMPLETED', date: '2026-10-20', time: '09:00', studentSection: 'BS INFO 4D', reason: 'Advising', studentId: 's1', studentName: 'Ana', facultyId: 'f1', ...o });
const users = [
  { _id: 'f1', role: 'FACULTY', accountStatus: 'ACTIVE', name: 'Prof One', email: 'p1@x', programPosition: 'Instructor' },
  { _id: 'f2', role: 'FACULTY', accountStatus: 'ACTIVE', name: 'Prof Two', email: 'p2@x', programPosition: 'Instructor' },
  { _id: 's1', role: 'STUDENT', accountStatus: 'ACTIVE', name: 'Ana', email: 'a@x', programPosition: 'BS INFO 4D', schoolId: '2025-S00001' },
  { _id: 's2', role: 'STUDENT', accountStatus: 'ACTIVE', name: 'Ben', email: 'b@x', programPosition: 'BS INFO 4D' }, // no school ID = incomplete
  { _id: 's3', role: 'STUDENT', accountStatus: 'ACTIVE', name: 'Cy', email: 'c@x', programPosition: 'BLIS 2A', schoolId: '2025-S00003' },
  { _id: 'a1', role: 'ADMIN', accountStatus: 'ACTIVE', name: 'Admin', email: 'ad@x' },
];

test('parseCohort splits program, year and section', () => {
  assert.deepStrictEqual(parseCohort('BS INFO 4D'), { program: 'BS INFO', year: '4', section: 'D' });
  assert.deepStrictEqual(parseCohort('nonsense'), { program: 'Unspecified', year: '', section: '' });
});
test('cohort rows count registered active students', () => {
  const rows = buildCohortRows(users);
  assert.deepStrictEqual(rows.find(r => r.program === 'BS INFO'), { program: 'BS INFO', year: '4', section: 'D', count: 2 });
  assert.strictEqual(rows.reduce((s, r) => s + r.count, 0), 3);
});
test('account health: users per role and incomplete profiles', () => {
  const h = buildAccountHealth(users);
  assert.strictEqual(h.byRole.find(r => r.label === 'STUDENT').value, 3);
  const st = h.profile.find(p => p.role === 'STUDENT');
  assert.strictEqual(st.complete, 2);
  assert.deepStrictEqual(st.incompleteList, [{ name: 'Ben', email: 'b@x' }]);
});
test('appeal table counts every student appeal (any status); unknown reasons become Other', () => {
  const rows = buildAppealRows([
    apt({ status: 'MISSED (STUDENT)', appeal: { by: 'STUDENT', status: 'SUBMITTED', reason: 'Family Emergency' } }),
    apt({ status: 'MISSED (STUDENT)', appeal: { by: 'STUDENT', status: 'SUBMITTED', reason: 'Overslept' } }),
    apt({ status: 'MISSED (STUDENT)', appeal: { by: 'STUDENT', status: 'PENDING', reason: 'Family Emergency' } }),
    apt({ status: 'MISSED (FACULTY)', appeal: { by: 'FACULTY', status: 'SUBMITTED', reason: 'Official University Duties' } }),
  ]);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows.find(r => r.reason === 'Other').count, 1);
  assert.strictEqual(rows.find(r => r.reason === 'Family Emergency').count, 2);
});
test('appeal summary: rate, totals, faculty appeals', () => {
  const s = buildAppealSummary([
    apt({ status: 'MISSED (STUDENT)', appeal: { by: 'STUDENT', status: 'SUBMITTED', reason: 'x' } }),
    apt({ status: 'MISSED (STUDENT)' }),
    apt({ status: 'MISSED (STUDENT)', appeal: { by: 'STUDENT', status: 'SUBMITTED', reason: 'x' } }),
    apt({ status: 'MISSED (STUDENT)' }),
    apt({ status: 'MISSED (FACULTY)', appeal: { by: 'FACULTY', status: 'SUBMITTED', reason: 'y' } }),
  ]);
  assert.strictEqual(s.appealRate, 50);
  assert.strictEqual(s.total, 2);
  assert.strictEqual(s.faculty.made, 1);
});
test('shared report: kpis, drilldown split, no pending, admin-only health', () => {
  const appointments = [
    apt({}), apt({ studentId: 's3', studentName: 'Cy', facultyId: 'f2' }),
    apt({ status: 'MISSED (STUDENT)' }), apt({ status: 'MISSED (FACULTY)', facultyId: 'f2' }),
    apt({ status: 'PENDING' }),
  ];
  const r = buildSharedReport({ appointments, users, todayIso: today });
  assert.strictEqual(r.kpis.requests.total, 4);       // pending left out
  assert.strictEqual(r.kpis.missed.total, 2);
  assert.strictEqual(r.kpis.completionRate, 50);       // 2 / (2 + 2)
  assert.deepStrictEqual(r.drilldown.missed.students, [{ name: 'Ana', count: 1 }]);
  assert.deepStrictEqual(r.drilldown.missed.faculty, [{ name: 'Prof Two', count: 1 }]);
  assert.strictEqual(r.kpis.activeFaculty, 2);
  assert.strictEqual(r.accountHealth, undefined);
  assert.ok(buildSharedReport({ appointments, users, todayIso: today, includeAccountHealth: true }).accountHealth);
});
test('shared report works with no data', () => {
  const r = buildSharedReport({ appointments: [], users: [], todayIso: today });
  assert.strictEqual(r.kpis.requests.total, 0);
  assert.strictEqual(r.kpis.completionRate, null);
  assert.strictEqual(r.weekly.length, 8);
});
test('outcome tables: faculty includes zero rows, students skip pending-only', () => {
  const list = [apt({}), apt({ status: 'MISSED (STUDENT)' }), apt({ status: 'PENDING', studentId: 's9', studentName: 'Zed' })];
  const fac = buildFacultyOutcomeRows(list, users.filter(u => u.role === 'FACULTY'));
  assert.deepStrictEqual(fac.map(f => [f.name, f.completed, f.studentNoShows]), [['Prof One', 1, 1], ['Prof Two', 0, 0]]);
  const stu = buildStudentOutcomeRows(list);
  assert.deepStrictEqual(stu.map(x => [x.name, x.completed, x.noShows]), [['Ana', 1, 1]]);
});
test('gender counts older accounts as Not provided', () => {
  const g = buildGender([{ role: 'STUDENT', accountStatus: 'ACTIVE', gender: 'Female' }, { role: 'STUDENT', accountStatus: 'ACTIVE' }]);
  assert.deepStrictEqual(g.students, [{ label: 'Female', value: 1 }, { label: 'Not provided', value: 1 }]);
});
test('expired requests are counted separately from declined, for the faculty table and the student table', () => {
  const { outcomeCounts, buildStudentOutcomeRows } = require('./reportMetrics');
  const list = [apt({ status: 'REJECTED' }), apt({ status: 'REJECTED', autoRejected: true })];
  const c = outcomeCounts(list);
  assert.strictEqual(c.declined, 1);
  assert.strictEqual(c.expired, 1);
  assert.strictEqual(buildStudentOutcomeRows(list)[0].declined, 1);
});

// ---- Analytics improvements: totals reconcile, pending shown beside the counts, request-date trend ----
test('outcomeCounts: pending and unknown statuses are visible, and every counted request lands in exactly one bucket', () => {
  const { outcomeCounts } = require('./reportMetrics');
  const rows = [
    { status: 'PENDING' }, { status: 'PENDING' },
    { status: 'COMPLETED' }, { status: 'APPROVED' }, { status: 'REJECTED' }, { status: 'REJECTED', autoRejected: true },
    { status: 'MISSED (STUDENT)' }, { status: 'MISSED (FACULTY)' },
    { status: 'CANCELLED BY STUDENT' }, { status: 'CANCELLED BY FACULTY' }, { status: 'CANCELLED (FACULTY ON LEAVE)' },
    { status: 'LEGACY-ODD' },
  ];
  const c = outcomeCounts(rows);
  assert.equal(c.submitted, 12);
  assert.equal(c.pending, 2);
  assert.equal(c.requests, 10);          // unchanged meaning: everything that left PENDING
  assert.equal(c.other, 1);
  const buckets = c.completed + c.upcoming + c.declined + c.expired + c.missed + c.cancelledStudent + c.cancelledFaculty + c.other;
  assert.equal(buckets, c.requests);     // nothing is silently left out of the chart
  assert.equal(c.pending + c.requests, c.submitted);
});

test('weeklyCreatedSeries groups by the day the request was submitted in Manila time, not the consultation date', () => {
  const { weeklyCreatedSeries, weeklySeries, manilaDateOf } = require('./reportMetrics');
  // 2026-11-09 is a Monday. 23:30 UTC on Sunday Nov 8 is already Monday Nov 9 in Manila.
  assert.equal(manilaDateOf('2026-11-08T23:30:00Z'), '2026-11-09');
  assert.equal(manilaDateOf(undefined), '');
  assert.equal(manilaDateOf('not a date'), '');
  const rows = [
    { status: 'PENDING', createdAt: '2026-11-08T23:30:00Z', date: '2026-11-18' },   // submitted week of Nov 9, consult week of Nov 16
    { status: 'COMPLETED', createdAt: '2026-11-10T02:00:00Z', date: '2026-11-11' },
    { status: 'APPROVED' },                                                         // no createdAt: ignored, not NaN
  ];
  const created = weeklyCreatedSeries(rows, '2026-11-12');
  const thisWeek = created[created.length - 1];
  assert.equal(thisWeek.value, 2);
  assert.ok(created.every((w) => Number.isFinite(w.value)));
  const scheduled = weeklySeries(rows, '2026-11-12');
  assert.equal(scheduled[scheduled.length - 1].value, 1);   // only the completed one is dated this week and counted
});
