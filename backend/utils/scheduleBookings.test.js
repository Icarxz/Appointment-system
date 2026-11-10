const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRange, toBookingBlocks, SHOWN } = require('./scheduleBookings');

test('only APPROVED and COMPLETED are shown', () => {
  assert.deepEqual(SHOWN, ['APPROVED', 'COMPLETED']);
  const out = toBookingBlocks([
    { status: 'PENDING', date: '2026-11-12', time: '09:00' },
    { status: 'APPROVED', date: '2026-11-12', time: '10:00', duration: 30 },
    { status: 'COMPLETED', date: '2026-11-10', time: '09:00' },
    { status: 'REJECTED', date: '2026-11-11', time: '09:00' },
    { status: 'CANCELLED BY STUDENT', date: '2026-11-11', time: '10:00' },
    { status: 'MISSED (STUDENT)', date: '2026-11-11', time: '11:00' },
  ]);
  assert.deepEqual(out, [
    { date: '2026-11-12', time: '10:00', duration: 30, status: 'APPROVED' },
    { date: '2026-11-10', time: '09:00', duration: 60, status: 'COMPLETED' },
  ]);
});

test('no student name or reason leaks into a block', () => {
  const [b] = toBookingBlocks([{ status: 'APPROVED', date: '2026-11-12', time: '10:00', studentName: 'Secret', reason: 'Private', studentId: 'x' }]);
  assert.deepEqual(Object.keys(b).sort(), ['date', 'duration', 'status', 'time']);
});

test('parseRange accepts a normal week and rejects bad input', () => {
  assert.deepEqual(parseRange('2026-11-09', '2026-11-14'), { from: '2026-11-09', to: '2026-11-14' });
  assert.ok(parseRange('', '2026-11-14').error);
  assert.ok(parseRange('2026-11-09', 'soon').error);
  assert.ok(parseRange('2026-02-31x', '2026-03-01').error);
  assert.ok(parseRange('2026-11-14', '2026-11-09').error);
  assert.ok(parseRange('2026-01-01', '2026-12-31').error);
});
