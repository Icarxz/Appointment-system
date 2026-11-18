const test = require('node:test');
const assert = require('node:assert');
const { reportDecision } = require('./reportFacultyMissed');

const apt = { _id: 'a1', status: 'APPROVED', date: '2026-11-03', time: '10:00', studentId: 'u1', studentName: 'Ana' };
const at = (hhmm) => new Date(`2026-11-03T${hhmm}:00+08:00`).getTime();
const base = { apt, userId: 'u1', userName: 'Ana', reason: 'Instructor was not there' };

test('allowed 30 minutes after the start, with a reason', () => {
  const d = reportDecision({ ...base, nowMs: at('10:30') });
  assert.deepStrictEqual(d, { ok: true, reason: 'Instructor was not there' });
});

test('not during the 30-minute grace period', () => {
  const d = reportDecision({ ...base, nowMs: at('10:29') });
  assert.strictEqual(d.ok, false);
  assert.strictEqual(d.status, 400);
  assert.ok(d.opensAt instanceof Date);
});

test('a reason is required', () => {
  assert.strictEqual(reportDecision({ ...base, reason: '  ', nowMs: at('11:00') }).error, 'Please select or enter a reason.');
});

test('only the student of that appointment, and only while approved', () => {
  assert.strictEqual(reportDecision({ ...base, userId: 'u2', nowMs: at('11:00') }).status, 403);
  assert.strictEqual(reportDecision({ ...base, apt: { ...apt, status: 'COMPLETED' }, nowMs: at('11:00') }).status, 400);
  assert.strictEqual(reportDecision({ ...base, apt: null, nowMs: at('11:00') }).status, 404);
});

test('an older appointment without studentId is matched by name', () => {
  const old = { ...apt, studentId: undefined };
  assert.strictEqual(reportDecision({ ...base, apt: old, nowMs: at('11:00') }).ok, true);
  assert.strictEqual(reportDecision({ ...base, apt: old, userName: 'Ben', nowMs: at('11:00') }).status, 403);
});
