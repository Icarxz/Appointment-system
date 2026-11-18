const test = require('node:test');
const assert = require('node:assert/strict');
const { weekBounds, checkWeeklyLimit } = require('./weeklyLimit');

test('weeks run Monday to Sunday', () => {
  assert.deepEqual(weekBounds('2026-11-18'), { start: '2026-11-16', end: '2026-11-22' }); // Wednesday
  assert.deepEqual(weekBounds('2026-11-16'), { start: '2026-11-16', end: '2026-11-22' }); // Monday
  assert.deepEqual(weekBounds('2026-11-22'), { start: '2026-11-16', end: '2026-11-22' }); // Sunday
  assert.deepEqual(weekBounds('2026-11-23'), { start: '2026-11-23', end: '2026-11-29' }); // next Monday
});
test('week bounds cross month and year ends', () => {
  assert.deepEqual(weekBounds('2026-12-31'), { start: '2026-12-28', end: '2027-01-03' });
});
const mk = (date, status = 'PENDING') => ({ date, status });
test('allows requests until the limit is reached', () => {
  const four = ['16', '17', '18', '19'].map((d) => mk(`2026-11-${d}`));
  const r = checkWeeklyLimit(four, '2026-11-20', 5);
  assert.equal(r.ok, true); assert.equal(r.used, 4); assert.equal(r.remaining, 1);
  const five = [...four, mk('2026-11-20', 'APPROVED')];
  assert.equal(checkWeeklyLimit(five, '2026-11-21', 5).ok, false);
});
test('only counts the requested week, by consultation date', () => {
  const lots = Array.from({ length: 5 }, () => mk('2026-11-23'));
  assert.equal(checkWeeklyLimit(lots, '2026-11-18', 5).ok, true); // other week
  assert.equal(checkWeeklyLimit(lots, '2026-11-24', 5).ok, false); // same week
});
test('declined, expired and cancelled-by-student requests do not count; completed does', () => {
  const rows = [mk('2026-11-16', 'REJECTED'), mk('2026-11-17', 'CANCELLED BY STUDENT'), mk('2026-11-18', 'COMPLETED'), mk('2026-11-19', 'MISSED (FACULTY)')];
  assert.equal(checkWeeklyLimit(rows, '2026-11-20', 5).used, 1);
});
test('no limit when unset, zero or invalid', () => {
  const lots = Array.from({ length: 50 }, () => mk('2026-11-18'));
  for (const l of [undefined, null, 0, -1, 'x', 2.5]) assert.equal(checkWeeklyLimit(lots, '2026-11-18', l).ok, true);
});
