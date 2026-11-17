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

test('public notices: only posted notices that have not ended, soonest first, Other shows own words', () => {
  const { publicNotices } = require('./facultyStatusInputs');
  const now = new Date('2026-11-17T09:00:00+08:00');
  const d = (s) => new Date(`${s}+08:00`);
  const out = publicNotices([
    { _id: 1, isNotice: true, type: 'ON_LEAVE', reason: 'Sick leave', startAt: d('2026-11-25T00:00:00'), endAt: d('2026-11-26T00:00:00') },
    { _id: 2, isNotice: true, type: 'IN_MEETING', reason: 'Other', reasonOther: 'Accreditation visit', startAt: d('2026-11-20T13:00:00'), endAt: d('2026-11-20T15:00:00'), makeUpInfo: 'Friday' },
    { _id: 3, isNotice: true, type: 'IN_MEETING', reason: 'Faculty meeting', startAt: d('2026-11-10T13:00:00'), endAt: d('2026-11-10T15:00:00') },
    { _id: 4, isNotice: false, type: 'ON_BREAK', startAt: d('2026-11-17T08:50:00'), endAt: d('2026-11-17T09:10:00') },
  ], now);
  assert.deepEqual(out.map((n) => n._id), ['2', '1']);
  assert.equal(out[0].reason, 'Accreditation visit');
  assert.equal(out[0].makeUpInfo, 'Friday');
  assert.equal(Object.keys(out[0]).includes('facultyId'), false);
});
