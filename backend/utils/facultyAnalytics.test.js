const test = require('node:test');
const assert = require('node:assert');
const { buildFacultyAnalytics } = require('./facultyAnalytics');

const apt = (o) => ({ status: 'COMPLETED', date: '2026-10-20', time: '09:00', duration: 60, studentSection: 'BS INFO 4D', reason: 'Capstone / Thesis Consultation', studentId: 's1', ...o });
const today = '2026-10-26';

test('pending requests are not counted as requests, but are reported beside them', () => {
  const r = buildFacultyAnalytics({ todayIso: today, appointments: [apt({}), apt({ status: 'PENDING' })] });
  assert.strictEqual(r.outcomes.requests, 1);
  assert.strictEqual(r.outcomes.pending, 1);   // shown separately (analytics plan 5.1); never inside requests or any rate
  assert.strictEqual(r.outcomes.completionRate, 100);
  assert.strictEqual(r.hours, undefined); // consultation-hour use is no longer reported
});
test('counts outcomes, completion, missed and approval rates', () => {
  const r = buildFacultyAnalytics({ todayIso: today, appointments: [
    apt({}), apt({}), apt({ status: 'MISSED (STUDENT)' }), apt({ status: 'CANCELLED BY FACULTY' }),
    apt({ status: 'REJECTED' }), apt({ status: 'CANCELLED BY STUDENT' }), apt({ status: 'APPROVED' }),
  ] });
  assert.strictEqual(r.outcomes.completed, 2);
  assert.strictEqual(r.outcomes.studentNoShows, 1);
  assert.strictEqual(r.outcomes.completionRate, 66.7); // 2 / (2 completed + 1 missed)
  assert.strictEqual(r.outcomes.missedRate, 33.3);
  assert.strictEqual(r.outcomes.approvalRate, 83.3);   // 5 approved-or-later, 1 declined
});
test('rates are null when nothing has happened yet', () => {
  const r = buildFacultyAnalytics({ todayIso: today, appointments: [apt({ status: 'PENDING' })] });
  assert.strictEqual(r.outcomes.completionRate, null);
  assert.strictEqual(r.outcomes.approvalRate, null);
});
test('an appeal does not reduce the miss count', () => {
  const missed = apt({ status: 'MISSED (STUDENT)', appeal: { by: 'STUDENT', status: 'SUBMITTED', reason: 'Family Emergency' } });
  const r = buildFacultyAnalytics({ todayIso: today, appointments: [apt({}), missed] });
  assert.strictEqual(r.outcomes.studentNoShows, 1);
  assert.strictEqual(r.appeals.summary.total, 1);
  assert.deepStrictEqual(r.appeals.rows, [{ program: 'BS INFO', year: '4', section: 'D', reason: 'Family Emergency', count: 1 }]);
});
test('heatmap window follows the consultation hours', () => {
  const r = buildFacultyAnalytics({
    todayIso: today,
    official: [{ dayOfWeek: 2, startTime: '09:00', endTime: '11:00' }],
    added: [{ dayOfWeek: 4, startTime: '13:00', endTime: '14:00' }],
    appointments: [apt({}), apt({})], // 2026-10-20 is a Tuesday, 9 AM
  });
  assert.deepStrictEqual(r.heatmap.hours.map(h => h.hour), [9, 10, 11, 12, 13]);
  assert.strictEqual(r.heatmap.cells[0][1], 2); // 9 AM row, Tue column
  assert.strictEqual(r.heatmap.max, 2);
});
test('students split by program and year; purposes grouped case-insensitively', () => {
  const r = buildFacultyAnalytics({ todayIso: today, appointments: [
    apt({}), apt({ reason: ' capstone / thesis consultation ' }), apt({ studentSection: 'BLIS 2A', studentId: 's2', reason: 'Exam / Quiz Result Review' }), apt({ studentSection: 'weird' }),
  ] });
  assert.deepStrictEqual(r.students.byProgram.map(x => x.label), ['BS INFO', 'BLIS', 'Unspecified']);
  assert.strictEqual(r.students.purposes.items[0].count, 3);
  assert.strictEqual(r.students.uniqueStudents, 2);
});
test('monthly trend covers six months ending now', () => {
  const r = buildFacultyAnalytics({ todayIso: today, appointments: [apt({})] });
  assert.strictEqual(r.monthly.length, 6);
  assert.deepStrictEqual(r.monthly[5], { label: "Oct '26", value: 1 });
});
test('no data yields zeros and nulls, not NaN', () => {
  const r = buildFacultyAnalytics({ todayIso: today, appointments: [] });
  assert.strictEqual(r.outcomes.requests, 0);
  assert.deepStrictEqual(r.students.purposes, { total: 0, items: [] });
  assert.strictEqual(r.heatmap.max, 0);
});

test('faculty tiles match the shared report: windows, missed/cancelled split, student-only drilldown', () => {
  const mk = (status, date, name) => ({ status, date, time: '09:00', studentName: name, studentId: name, studentSection: 'BS INFO 3A', reason: 'Advising' });
  const out = buildFacultyAnalytics({
    appointments: [mk('COMPLETED', '2026-10-20', 'Ana'), mk('COMPLETED', '2026-10-21', 'Ana'), mk('MISSED (STUDENT)', '2026-10-22', 'Ben'), mk('CANCELLED BY FACULTY', '2026-10-23', 'Cy'), mk('PENDING', '2026-10-24', 'Di')],
    todayIso: '2026-10-28',
  });
  assert.strictEqual(out.kpis.requests.total, 4); // pending is not counted
  assert.strictEqual(out.kpis.completed.last4, 2);
  assert.strictEqual(out.kpis.missed.student, 1);
  assert.strictEqual(out.kpis.cancelled.faculty, 1);
  assert.deepStrictEqual(out.drilldown.completed.students, [{ name: 'Ana', count: 2 }]);
  assert.deepStrictEqual(out.drilldown.completed.faculty, []);
});

test('approved tile and the missed/cancelled lists split by who caused them', () => {
  const mk = (status, name) => ({ status, date: '2026-10-20', time: '09:00', studentName: name, studentId: name, studentSection: 'BS INFO 3A', reason: 'Advising' });
  const out = buildFacultyAnalytics({
    appointments: [mk('COMPLETED', 'Ana'), mk('MISSED (STUDENT)', 'Ben'), mk('MISSED (FACULTY)', 'Cy'), mk('CANCELLED BY STUDENT', 'Di'), mk('CANCELLED BY FACULTY', 'Eli'), mk('REJECTED', 'Fay')],
    todayIso: '2026-10-28',
  });
  assert.strictEqual(out.kpis.approved.total, 4); // completed + both misses + cancelled by faculty
  assert.strictEqual(out.kpis.approved.declined, 1);
  assert.deepStrictEqual(out.drilldown.missed.students, [{ name: 'Ben', count: 1 }]);
  assert.deepStrictEqual(out.drilldown.missed.faculty, [{ name: 'Cy', count: 1 }]);
  assert.deepStrictEqual(out.drilldown.cancelled.faculty, [{ name: 'Eli', count: 1 }]);
});

test('students table: distinct students by program, year and section', () => {
  const mk = (id, section, status = 'COMPLETED') => ({ status, date: '2026-10-20', time: '09:00', studentId: id, studentName: id, studentSection: section, reason: 'x' });
  const r = buildFacultyAnalytics({ todayIso: '2026-10-28', appointments: [mk('a', 'BS INFO 3A'), mk('a', 'BS INFO 3A'), mk('b', 'BS INFO 3A'), mk('c', 'BLIS 1B'), mk('d', 'BLIS 1B', 'PENDING')] });
  const find = (p, y) => r.students.cohorts.find(c => c.program === p && c.year === y);
  assert.strictEqual(find('BS INFO', '3').count, 2); // a counted once, even with two requests
  assert.strictEqual(find('BLIS', '1').count, 1);   // pending request is not counted
});

test('expired (auto-rejected) requests are not faculty declines and do not lower the approval rate', () => {
  const mk = (status, extra = {}) => ({ status, date: '2026-10-20', time: '09:00', studentId: status + Math.random(), studentName: 'x', studentSection: 'BS INFO 3A', reason: 'x', ...extra });
  const r = buildFacultyAnalytics({ todayIso: '2026-10-28', appointments: [mk('COMPLETED'), mk('REJECTED'), mk('REJECTED', { autoRejected: true }), mk('REJECTED', { autoRejected: true })] });
  assert.strictEqual(r.outcomes.declined, 1);
  assert.strictEqual(r.outcomes.expired, 2);
  assert.strictEqual(r.outcomes.approvalRate, 50); // 1 approved-or-later vs 1 declined; expired ignored
  assert.strictEqual(r.kpis.approved.expired, 2);
});
