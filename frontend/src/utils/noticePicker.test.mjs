// Run with:  node --test frontend/src/utils/noticePicker.test.mjs   (Node 22.18+; older: add --experimental-strip-types)
import test from 'node:test';
import assert from 'node:assert/strict';
import * as p from './noticePicker.ts';

test('meeting: start hour then end hour on the same day', () => {
  const a = p.pickMeeting(null, '2026-11-20', 13);
  assert.deepEqual(a.sel, { date: '2026-11-20', startHour: 13, endHour: null });
  assert.equal(a.done, undefined);
  const b = p.pickMeeting(a.sel, '2026-11-20', 15);
  assert.equal(b.done, true);
  assert.deepEqual(p.meetingTimes(b.sel), { date: '2026-11-20', startTime: '13:00', endTime: '15:00' });
});
test('meeting: an end that is not after the start is rejected, never reversed', () => {
  const a = p.pickMeeting(null, '2026-11-20', 13).sel;
  for (const h of [13, 12, 8]) {
    const r = p.pickMeeting(a, '2026-11-20', h);
    assert.ok(r.error, `hour ${h}`);
    assert.deepEqual(r.sel, a); // the start stays
  }
});
test('meeting: the end must be on the same day; the day ends at 5:00 PM', () => {
  const a = p.pickMeeting(null, '2026-11-20', 9).sel;
  assert.ok(p.pickMeeting(a, '2026-11-23', 11).error);
  assert.equal(p.pickMeeting(a, '2026-11-20', 17).done, true); // ends at 5:00 PM
  assert.ok(p.pickMeeting(a, '2026-11-20', 18).error);
  assert.ok(p.pickMeeting(null, '2026-11-20', 17).error);       // cannot start at 5:00 PM
});
test('meeting: tapping after a finished range starts a new one', () => {
  const done = p.pickMeeting(p.pickMeeting(null, '2026-11-20', 9).sel, '2026-11-20', 10).sel;
  assert.deepEqual(p.pickMeeting(done, '2026-11-24', 14).sel, { date: '2026-11-24', startHour: 14, endHour: null });
});
test('meeting: confirmation text', () => {
  assert.equal(p.meetingQuestion({ date: '2026-11-20', startHour: 13, endHour: 15 }), 'Meeting on Fri, Nov 20, 1:00 to 3:00 PM?');
  assert.equal(p.meetingQuestion({ date: '2026-11-20', startHour: 11, endHour: 13 }), 'Meeting on Fri, Nov 20, 11:00 AM to 1:00 PM?');
  assert.equal(p.meetingQuestion({ date: '2026-11-23', startHour: 8, endHour: 9 }), 'Meeting on Mon, Nov 23, 8:00 to 9:00 AM?');
});

const pt = (date, part = 'FULL') => ({ date, part });
test('leave: first day, then last day; a new tap after that starts over', () => {
  const a = p.pickLeave({ start: null, end: null }, pt('2026-11-20'));
  assert.equal(a.done, undefined);
  const b = p.pickLeave(a.sel, pt('2026-11-24'));
  assert.equal(b.done, true);
  assert.deepEqual(p.leavePayload(b.sel), { startDate: '2026-11-20', endDate: '2026-11-24', startPart: 'FULL', endPart: 'FULL' });
  assert.deepEqual(p.pickLeave(b.sel, pt('2026-12-01')).sel, { start: pt('2026-12-01'), end: null });
});
test('leave: last day before the first is rejected and the first stays', () => {
  const a = p.pickLeave({ start: null, end: null }, pt('2026-11-24')).sel;
  const r = p.pickLeave(a, pt('2026-11-20'));
  assert.ok(r.error);
  assert.deepEqual(r.sel, a);
});
test('leave: half days. Afternoon first day, morning last day', () => {
  const a = p.pickLeave({ start: null, end: null }, pt('2026-11-20', 'PM')).sel;
  const b = p.pickLeave(a, pt('2026-11-23', 'AM')).sel;
  assert.deepEqual(p.leavePayload(b), { startDate: '2026-11-20', endDate: '2026-11-23', startPart: 'PM', endPart: 'AM' });
  assert.equal(p.leaveQuestion(b), 'Leave from Fri, Nov 20 (half day, afternoon) to Mon, Nov 23 (half day, morning)?');
});
test('leave: a morning tap first, or an afternoon tap last, is a whole day at that end', () => {
  const b = p.pickLeave(p.pickLeave({ start: null, end: null }, pt('2026-11-20', 'AM')).sel, pt('2026-11-23', 'PM')).sel;
  assert.deepEqual(p.leavePayload(b), { startDate: '2026-11-20', endDate: '2026-11-23', startPart: 'FULL', endPart: 'FULL' });
  assert.equal(p.leaveQuestion(b), 'Leave from Fri, Nov 20 (whole day) to Mon, Nov 23 (whole day)?');
  assert.ok(!/half/.test(p.leaveQuestion(b)), 'no half-day wording for whole days');
});
test('leave: single day, whole or half; afternoon-to-morning on one day rejected', () => {
  const day = (a, b) => p.pickLeave(p.pickLeave({ start: null, end: null }, a).sel, b);
  assert.equal(p.leaveQuestion(day(pt('2026-11-20'), pt('2026-11-20')).sel), 'Leave on Fri, Nov 20 (whole day)?');
  assert.equal(p.leaveQuestion(day(pt('2026-11-20', 'AM'), pt('2026-11-20', 'AM')).sel), 'Leave on Fri, Nov 20 (half day, morning)?');
  assert.equal(p.leaveQuestion(day(pt('2026-11-20', 'PM'), pt('2026-11-20', 'PM')).sel), 'Leave on Fri, Nov 20 (half day, afternoon)?');
  assert.ok(day(pt('2026-11-20', 'PM'), pt('2026-11-20', 'AM')).error);
});
test('leave: coverage per day half, across weeks', () => {
  const b = p.pickLeave(p.pickLeave({ start: null, end: null }, pt('2026-11-20', 'PM')).sel, pt('2026-11-24', 'AM')).sel;
  assert.deepEqual(p.leaveCoverage(b, '2026-11-19'), { am: false, pm: false });
  assert.deepEqual(p.leaveCoverage(b, '2026-11-20'), { am: false, pm: true });
  assert.deepEqual(p.leaveCoverage(b, '2026-11-23'), { am: true, pm: true });
  assert.deepEqual(p.leaveCoverage(b, '2026-11-24'), { am: true, pm: false });
  assert.deepEqual(p.leaveCoverage(b, '2026-11-25'), { am: false, pm: false });
  // only the first day is picked so far
  const a = p.pickLeave({ start: null, end: null }, pt('2026-11-20')).sel;
  assert.deepEqual(p.leaveCoverage(a, '2026-11-20'), { am: true, pm: true });
  assert.deepEqual(p.leaveCoverage(a, '2026-11-23'), { am: false, pm: false });
});
test('week helpers', () => {
  assert.equal(p.mondayOf('2026-11-20'), '2026-11-16');
  assert.equal(p.mondayOf('2026-11-22'), '2026-11-16');
  assert.equal(p.addDays('2026-11-16', 7), '2026-11-23');
});
