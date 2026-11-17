const test = require('node:test');
const assert = require('node:assert');
const { groupStatusInputs, bookingRunning, toLegacyStatus } = require('./facultyStatusInputs');
const { resolveFacultyStatus } = require('./facultyStatus');

test('rows are grouped per faculty and unlisted faculty get empty input', () => {
  const m = groupStatusInputs(['a', 'b'], {
    classes: [{ facultyId: 'a', startTime: '09:00', endTime: '10:00' }],
    official: [{ facultyId: 'a', startTime: '13:00', endTime: '14:00' }],
    added: [{ facultyId: 'a', startTime: '15:00', endTime: '16:00' }],
  }, 600);
  assert.equal(m.get('a').classBlocks.length, 1);
  assert.equal(m.get('a').consultBlocks.length, 2);
  assert.deepEqual(m.get('b').entries, []);
  assert.equal(m.get('b').hasBooking, false);
});
test('booking running: inside the duration only', () => {
  const a = [{ time: '14:00', duration: 30 }];
  assert.equal(bookingRunning(a, 14 * 60 + 15), true);
  assert.equal(bookingRunning(a, 14 * 60 + 30), false);
  assert.equal(bookingRunning([{ time: '14:00' }], 14 * 60 + 59), true); // default 60 min
});
test('legacy mapping', () => {
  assert.equal(toLegacyStatus('VACANT'), 'AVAILABLE');
  assert.equal(toLegacyStatus('CONSULTATION_HOURS'), 'IN_CONSULTATION');
  assert.equal(toLegacyStatus('ON_LEAVE'), 'ON_LEAVE');
});
test('manual entry id is returned by the resolver', () => {
  const now = new Date('2026-11-17T09:00:00+08:00');
  const r = resolveFacultyStatus({ entries: [{ _id: 'x1', type: 'ON_BREAK', startAt: new Date('2026-11-17T08:50:00+08:00'), endAt: new Date('2026-11-17T09:10:00+08:00') }] }, now);
  assert.equal(r.entryId, 'x1');
});
