const test = require('node:test');
const assert = require('node:assert');
const { resolveFacultyStatus, validateEntry, blocksBooking } = require('./facultyStatus');

// Tue 2026-11-17, Manila time -> UTC is 8 h earlier
const at = (hhmm) => new Date(`2026-11-17T${hhmm}:00+08:00`);
const cls = [{ startTime: '09:00', endTime: '10:30', room: 'IICT 306' }];
const consult = [{ startTime: '13:00', endTime: '15:00' }];
const entry = (type, s, e, extra = {}) => ({ type, startAt: at(s), endAt: at(e), ...extra });

test('a day with no blocks shows -- (not Vacant)', () => {
  const r = resolveFacultyStatus({}, at('08:00'));
  assert.equal(r.status, 'NONE');
  assert.equal(r.label, '--');
});
test('in class, with an until time', () => {
  const r = resolveFacultyStatus({ classBlocks: cls }, at('09:30'));
  assert.equal(r.status, 'IN_CLASS');
  assert.equal(r.until.getTime(), at('10:30').getTime());
  assert.equal(r.source, 'scheduled');
});
test('class end time is exclusive; with a later block the gap is Vacant', () => {
  assert.equal(resolveFacultyStatus({ classBlocks: cls, consultBlocks: consult }, at('10:30')).status, 'VACANT');
  assert.equal(resolveFacultyStatus({ classBlocks: cls }, at('10:30')).status, 'NONE'); // it was the last block of the day
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
  assert.equal(resolveFacultyStatus({ classBlocks: cls, consultBlocks: consult, entries: [entry('ON_LEAVE', '12:00', '23:00')] }, at('10:45')).status, 'VACANT');
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

test('validate: reason can be waived for quick My Status entries', () => {
  const now = at('08:00');
  assert.equal(validateEntry(entry('ON_LEAVE', '09:00', '10:00'), [], now, { requireReason: false }).ok, true);
});

// ---- Vacant window: 7:00 AM until the end of the day's last class or consultation-hours block ----
const busy = { classBlocks: [{ startTime: '09:00', endTime: '10:30', room: 'IICT 306' }], consultBlocks: [{ startTime: '13:00', endTime: '15:00' }] };
const st = (input, hhmm) => resolveFacultyStatus(input, at(hhmm)).status;

test('window: -- before 7:00, Vacant from 7:00 (inclusive)', () => {
  assert.equal(st(busy, '06:59'), 'NONE');
  assert.equal(st(busy, '00:00'), 'NONE');
  assert.equal(st(busy, '07:00'), 'VACANT');
  assert.equal(st(busy, '08:59'), 'VACANT');
});
test('window: Vacant in the gaps between blocks', () => {
  assert.equal(st(busy, '11:00'), 'VACANT');
  assert.equal(st(busy, '12:59'), 'VACANT');
});
test('window: consultation hours ending later than the last class define the end of the day', () => {
  assert.equal(st(busy, '14:59'), 'CONSULTATION_HOURS');
  assert.equal(st(busy, '15:00'), 'NONE'); // exact end of the final block
  assert.equal(st(busy, '17:00'), 'NONE');
});
test('window: class ending later than consultation hours defines the end of the day', () => {
  const input = { classBlocks: [{ startTime: '16:00', endTime: '18:00' }], consultBlocks: [{ startTime: '09:00', endTime: '10:00' }] };
  assert.equal(st(input, '12:00'), 'VACANT');
  assert.equal(st(input, '17:59'), 'IN_CLASS');
  assert.equal(st(input, '18:00'), 'NONE');
});
test('window: class-only day and consultation-only day', () => {
  const classOnly = { classBlocks: [{ startTime: '09:00', endTime: '10:30' }] };
  assert.equal(st(classOnly, '08:00'), 'VACANT');
  assert.equal(st(classOnly, '09:00'), 'IN_CLASS');
  assert.equal(st(classOnly, '10:30'), 'NONE');
  const consultOnly = { consultBlocks: [{ startTime: '13:00', endTime: '15:00' }] };
  assert.equal(st(consultOnly, '07:30'), 'VACANT');
  assert.equal(st(consultOnly, '13:00'), 'CONSULTATION_HOURS');
  assert.equal(st(consultOnly, '15:00'), 'NONE');
});
test('window: an active manual status still shows outside 7:00 AM to the last block, and on an unscheduled day', () => {
  assert.equal(st({ ...busy, entries: [entry('IN_MEETING', '05:00', '06:00')] }, '05:30'), 'IN_MEETING');
  assert.equal(st({ ...busy, entries: [entry('ON_BREAK', '15:00', '16:00')] }, '15:30'), 'ON_BREAK');
  assert.equal(st({ ...busy, entries: [entry('OUT_OF_OFFICE', '19:00', '21:00')] }, '20:30'), 'OUT_OF_OFFICE');
  assert.equal(st({ entries: [entry('ON_LEAVE', '00:00', '23:59')] }, '03:00'), 'ON_LEAVE');
  assert.equal(st({ ...busy, entries: [entry('ON_BREAK', '15:00', '15:30')] }, '15:30'), 'NONE'); // expired -> back to --
});
test('window: a running accepted consultation still shows In Consultation outside the window', () => {
  assert.equal(st({ ...busy, hasBooking: true }, '16:00'), 'IN_CONSULTATION');
});
test('no Location is ever returned from the status', () => {
  const r = resolveFacultyStatus({ classBlocks: cls, entries: [entry('ON_BREAK', '09:00', '09:15', { location: 'Library' })] }, at('09:05'));
  assert.equal('location' in r, false);
  assert.equal('location' in resolveFacultyStatus({ classBlocks: cls }, at('09:30')), false);
});
