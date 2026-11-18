const test = require('node:test');
const assert = require('node:assert');
const { windowFromNotice } = require('./noticeWindow');
const { dropBlockedSlots } = require('./facultyStatus');
const now = new Date('2026-11-17T09:00:00+08:00');
const t = (s) => new Date(`${s}+08:00`).getTime();

test('meeting: date plus time range', () => {
  const r = windowFromNotice({ type: 'IN_MEETING', startDate: '2026-11-20', startTime: '13:00', endTime: '15:00' }, now);
  assert.equal(r.startAt.getTime(), t('2026-11-20T13:00:00'));
  assert.equal(r.endAt.getTime(), t('2026-11-20T15:00:00'));
});
test('meeting: bad or reversed times rejected', () => {
  assert.equal(windowFromNotice({ type: 'IN_MEETING', startDate: '2026-11-20', startTime: '15:00', endTime: '13:00' }, now).ok, false);
  assert.equal(windowFromNotice({ type: 'IN_MEETING', startDate: '2026-11-20', startTime: '', endTime: '13:00' }, now).ok, false);
});
test('leave: whole days, end date included', () => {
  const r = windowFromNotice({ type: 'ON_LEAVE', startDate: '2026-11-23', endDate: '2026-11-25' }, now);
  assert.equal(r.startAt.getTime(), t('2026-11-23T00:00:00'));
  assert.equal(r.endAt.getTime(), t('2026-11-26T00:00:00'));
});
test('leave: one day when no end date is given', () => {
  const r = windowFromNotice({ type: 'ON_LEAVE', startDate: '2026-11-23' }, now);
  assert.equal(r.endAt.getTime(), t('2026-11-24T00:00:00'));
});
test('dates: past, impossible, reversed, too long, too far', () => {
  assert.equal(windowFromNotice({ type: 'ON_LEAVE', startDate: '2026-11-16' }, now).ok, false);
  assert.equal(windowFromNotice({ type: 'ON_LEAVE', startDate: '2026-02-30' }, now).ok, false);
  assert.equal(windowFromNotice({ type: 'ON_LEAVE', startDate: '2026-11-25', endDate: '2026-11-24' }, now).ok, false);
  assert.equal(windowFromNotice({ type: 'ON_LEAVE', startDate: '2026-11-20', endDate: '2027-03-01' }, now).ok, false);
  assert.equal(windowFromNotice({ type: 'ON_LEAVE', startDate: '2028-01-01' }, now).ok, false);
});
test("today's date is allowed; other types are not", () => {
  assert.equal(windowFromNotice({ type: 'ON_LEAVE', startDate: '2026-11-17' }, now).ok, true);
  assert.equal(windowFromNotice({ type: 'ON_BREAK', startDate: '2026-11-20' }, now).ok, false);
});

test('slots inside a meeting or leave are removed, others kept', () => {
  const slots = [
    { date: '2026-11-20', start: '13:00', end: '14:00' },
    { date: '2026-11-20', start: '15:00', end: '16:00' },
    { date: '2026-11-21', start: '09:00', end: '10:00' },
  ];
  const entries = [
    { type: 'IN_MEETING', startAt: new Date(t('2026-11-20T13:30:00')), endAt: new Date(t('2026-11-20T15:00:00')) },
    { type: 'ON_LEAVE', startAt: new Date(t('2026-11-21T00:00:00')), endAt: new Date(t('2026-11-22T00:00:00')) },
    { type: 'ON_BREAK', startAt: new Date(t('2026-11-20T15:00:00')), endAt: new Date(t('2026-11-20T16:00:00')) },
  ];
  const left = dropBlockedSlots(slots, entries);
  assert.deepEqual(left.map((s) => s.start + s.date), ['15:002026-11-20']);
});

test('meeting: must stay inside the calendar (7:00 AM to 5:00 PM)', () => {
  const m = (startTime, endTime) => windowFromNotice({ type: 'IN_MEETING', startDate: '2026-11-20', startTime, endTime }, now).ok;
  assert.equal(m('07:00', '17:00'), true);
  assert.equal(m('06:00', '08:00'), false);
  assert.equal(m('16:00', '18:00'), false);
});
test('leave: half days. First day from noon, last day until noon', () => {
  const r = windowFromNotice({ type: 'ON_LEAVE', startDate: '2026-11-20', endDate: '2026-11-23', startPart: 'PM', endPart: 'FULL' }, now);
  assert.equal(r.startAt.getTime(), t('2026-11-20T12:00:00'));
  assert.equal(r.endAt.getTime(), t('2026-11-24T00:00:00'));
  const r2 = windowFromNotice({ type: 'ON_LEAVE', startDate: '2026-11-20', endDate: '2026-11-23', startPart: 'FULL', endPart: 'AM' }, now);
  assert.equal(r2.startAt.getTime(), t('2026-11-20T00:00:00'));
  assert.equal(r2.endAt.getTime(), t('2026-11-23T12:00:00'));
});
test('leave: a single half day (morning or afternoon); afternoon-to-morning on one day is rejected', () => {
  const am = windowFromNotice({ type: 'ON_LEAVE', startDate: '2026-11-20', endDate: '2026-11-20', endPart: 'AM' }, now);
  assert.equal(am.endAt.getTime(), t('2026-11-20T12:00:00'));
  const pm = windowFromNotice({ type: 'ON_LEAVE', startDate: '2026-11-20', endDate: '2026-11-20', startPart: 'PM' }, now);
  assert.equal(pm.startAt.getTime(), t('2026-11-20T12:00:00'));
  assert.equal(windowFromNotice({ type: 'ON_LEAVE', startDate: '2026-11-20', endDate: '2026-11-20', startPart: 'PM', endPart: 'AM' }, now).ok, false);
  assert.equal(windowFromNotice({ type: 'ON_LEAVE', startDate: '2026-11-20', startPart: 'NOON' }, now).ok, false);
});
