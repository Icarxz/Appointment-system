const test = require('node:test');
const assert = require('node:assert');
const { resolveFacultyStatus, validateEntry, blocksBooking } = require('./facultyStatus');

// Tue 2026-11-17, Manila time -> UTC is 8 h earlier
const at = (hhmm) => new Date(`2026-11-17T${hhmm}:00+08:00`);
const cls = [{ startTime: '09:00', endTime: '10:30', room: 'IICT 306' }];
const consult = [{ startTime: '13:00', endTime: '15:00' }];
const entry = (type, s, e, extra = {}) => ({ type, startAt: at(s), endAt: at(e), ...extra });

test('vacant with nothing scheduled', () => {
  assert.equal(resolveFacultyStatus({}, at('08:00')).status, 'VACANT');
});
test('in class, with an until time', () => {
  const r = resolveFacultyStatus({ classBlocks: cls }, at('09:30'));
  assert.equal(r.status, 'IN_CLASS');
  assert.equal(r.until.getTime(), at('10:30').getTime());
  assert.equal(r.source, 'scheduled');
});
test('class end time is exclusive', () => {
  assert.equal(resolveFacultyStatus({ classBlocks: cls }, at('10:30')).status, 'VACANT');
});
test('consultation hours', () => {
  assert.equal(resolveFacultyStatus({ consultBlocks: consult }, at('13:30')).status, 'CONSULTATION_HOURS');
});
test('a running booking makes it In Consultation, above In Class', () => {
  const r = resolveFacultyStatus({ classBlocks: cls, hasBooking: true }, at('09:30'));
  assert.equal(r.status, 'IN_CONSULTATION');
});
test('manual status beats the schedule', () => {
  const r = resolveFacultyStatus({ classBlocks: cls, entries: [entry('IN_MEETING', '09:00', '11:00')] }, at('09:30'));
  assert.equal(r.status, 'IN_MEETING');
  assert.equal(r.source, 'manual');
});
test('expired manual status falls back to scheduled', () => {
  const r = resolveFacultyStatus({ classBlocks: cls, entries: [entry('ON_BREAK', '09:00', '09:15')] }, at('09:30'));
  assert.equal(r.status, 'IN_CLASS');
});
test('a future notice does not apply yet', () => {
  assert.equal(resolveFacultyStatus({ entries: [entry('ON_LEAVE', '12:00', '23:00')] }, at('09:00')).status, 'VACANT');
});
test('overlapping manual: the one ending last wins', () => {
  const r = resolveFacultyStatus({ entries: [entry('ON_BREAK', '09:00', '09:30'), entry('ON_LEAVE', '08:00', '18:00')] }, at('09:10'));
  assert.equal(r.status, 'ON_LEAVE');
});

test('validate: leave needs a reason', () => {
  const now = at('08:00');
  assert.equal(validateEntry(entry('ON_LEAVE', '09:00', '10:00'), [], now).ok, false);
  assert.equal(validateEntry(entry('ON_LEAVE', '09:00', '10:00', { reason: 'Sick leave' }), [], now).ok, true);
});
test('validate: "Other" needs text', () => {
  const now = at('08:00');
  assert.equal(validateEntry(entry('IN_MEETING', '09:00', '10:00', { reason: 'Other' }), [], now).ok, false);
  assert.equal(validateEntry(entry('IN_MEETING', '09:00', '10:00', { reason: 'Other', reasonOther: 'Accreditation' }), [], now).ok, true);
});
test('validate: break needs no reason, end must be after start and in the future', () => {
  const now = at('08:00');
  assert.equal(validateEntry(entry('ON_BREAK', '09:00', '09:15'), [], now).ok, true);
  assert.equal(validateEntry(entry('ON_BREAK', '09:15', '09:00'), [], now).ok, false);
  assert.equal(validateEntry(entry('ON_BREAK', '06:00', '07:00'), [], now).ok, false);
});
test('validate: overlap rejected, back-to-back allowed', () => {
  const now = at('08:00');
  const ex = [entry('ON_BREAK', '09:00', '09:30')];
  assert.equal(validateEntry(entry('ON_BREAK', '09:15', '09:45'), ex, now).ok, false);
  assert.equal(validateEntry(entry('ON_BREAK', '09:30', '10:00'), ex, now).ok, true);
});
test('booking block: meeting and leave block, break does not', () => {
  const e = [entry('IN_MEETING', '14:00', '16:00'), entry('ON_BREAK', '10:00', '11:00')];
  assert.ok(blocksBooking(e, at('14:30'), at('15:00')));
  assert.equal(blocksBooking(e, at('10:15'), at('10:45')), null);
  assert.equal(blocksBooking(e, at('16:00'), at('16:30')), null);
});
