const test = require('node:test');
const assert = require('node:assert');
const { decideFinish, isAutoMissedDue, endMoment, missedFrom, autoMissedAt, manilaClock } = require('./consultationEnd');

// 2026-11-10 09:00 to 10:00 Manila (01:00Z to 02:00Z)
const apt = (extra = {}) => ({ status: 'APPROVED', date: '2026-11-10', time: '09:00', duration: 60, ...extra });
const at = (hhmm) => new Date(`2026-11-10T${hhmm}:00+08:00`).getTime();

test('end, missed and automatic moments come from the start and the length', () => {
  assert.strictEqual(endMoment(apt()).getTime(), at('10:00'));
  assert.strictEqual(endMoment(apt({ duration: 90 })).getTime(), at('10:30'));
  assert.strictEqual(endMoment(apt({ duration: undefined })).getTime(), at('10:00'));
  assert.strictEqual(missedFrom(apt()).getTime(), at('11:00'));
  assert.strictEqual(autoMissedAt(apt()).getTime(), at('12:00'));
});

test('Completed is refused before the end time, for both roles, and accepted at the end time', () => {
  for (const role of ['STUDENT', 'FACULTY']) {
    const early = decideFinish(apt(), 'COMPLETE', role, at('09:59'));
    assert.strictEqual(early.ok, false);
    assert.strictEqual(early.status, 400);
    assert.match(early.error, /not ended yet.*10:00 AM/);
    assert.deepStrictEqual(decideFinish(apt(), 'COMPLETE', role, at('10:00')), { ok: true, change: true });
    assert.deepStrictEqual(decideFinish(apt(), 'COMPLETE', role, at('15:00')), { ok: true, change: true });
  }
});

test('a request that has not even started cannot be completed', () => {
  assert.strictEqual(decideFinish(apt(), 'COMPLETE', 'FACULTY', at('08:00')).ok, false);
});

test('only APPROVED can be completed or marked missed; others get a clear error', () => {
  for (const status of ['PENDING', 'REJECTED', 'CANCELLED BY STUDENT', 'CANCELLED BY FACULTY']) {
    assert.strictEqual(decideFinish(apt({ status }), 'COMPLETE', 'FACULTY', at('11:00')).status, 400);
    assert.strictEqual(decideFinish(apt({ status }), 'MISSED', 'FACULTY', at('11:00')).status, 400);
  }
});

test('completing twice is accepted and changes nothing (double click, or the second party)', () => {
  const r = decideFinish(apt({ status: 'COMPLETED', completedBy: 'FACULTY' }), 'COMPLETE', 'STUDENT', at('10:30'));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.change, false);
  assert.match(r.reason, /faculty member/);
});

test('Missed is refused before start + 2 hours and accepted from then', () => {
  for (const role of ['STUDENT', 'FACULTY']) {
    const early = decideFinish(apt(), 'MISSED', role, at('10:59'));
    assert.strictEqual(early.ok, false);
    assert.match(early.error, /from 11:00 AM/);
    assert.deepStrictEqual(decideFinish(apt(), 'MISSED', role, at('11:00')), { ok: true, change: true });
  }
});

test('the first confirmation wins: the opposite click is refused and names who was first', () => {
  const missedByFaculty = apt({ status: 'MISSED (STUDENT)', missedBy: 'FACULTY' });
  const c = decideFinish(missedByFaculty, 'COMPLETE', 'STUDENT', at('12:00'));
  assert.strictEqual(c.ok, false);
  assert.strictEqual(c.status, 409);
  assert.match(c.error, /missed by the faculty member/);

  const completedByStudent = apt({ status: 'COMPLETED', completedBy: 'STUDENT' });
  const m = decideFinish(completedByStudent, 'MISSED', 'FACULTY', at('12:00'));
  assert.strictEqual(m.ok, false);
  assert.strictEqual(m.status, 409);
  assert.match(m.error, /completed by the student/);
});

test('marking missed twice the same way is accepted and changes nothing', () => {
  const r = decideFinish(apt({ status: 'MISSED (FACULTY)', missedBy: 'STUDENT' }), 'MISSED', 'STUDENT', at('12:00'));
  assert.deepStrictEqual([r.ok, r.change], [true, false]);
});

test('the system Missed (faculty) can still become a late sign-off by the faculty member only', () => {
  const auto = apt({ status: 'MISSED (FACULTY)' }); // no missedBy: set by the system
  assert.deepStrictEqual(decideFinish(auto, 'COMPLETE', 'FACULTY', at('15:00')), { ok: true, change: true });
  assert.strictEqual(decideFinish(auto, 'COMPLETE', 'STUDENT', at('15:00')).status, 409);
  const byStudent = apt({ status: 'MISSED (FACULTY)', missedBy: 'STUDENT' }); // a person decided: not overwritten
  assert.strictEqual(decideFinish(byStudent, 'COMPLETE', 'FACULTY', at('15:00')).status, 409);
});

test('automatic Missed is due 3 hours after the start, for approved consultations only', () => {
  assert.strictEqual(isAutoMissedDue(apt(), at('11:59')), false);
  assert.strictEqual(isAutoMissedDue(apt(), at('12:00')), true);
  assert.strictEqual(isAutoMissedDue(apt({ status: 'COMPLETED' }), at('13:00')), false);
  assert.strictEqual(isAutoMissedDue(apt({ status: 'MISSED (STUDENT)' }), at('13:00')), false);
});

test('clock text is Manila time, 12-hour', () => {
  assert.strictEqual(manilaClock(new Date(at('13:05'))), '1:05 PM');
  assert.strictEqual(manilaClock(new Date(at('00:00'))), '12:00 AM');
  assert.strictEqual(manilaClock(new Date(at('12:00'))), '12:00 PM');
});
