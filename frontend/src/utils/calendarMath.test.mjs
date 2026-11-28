import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calendarEventPosition,
  calendarTimeAtSlot,
  findOverlappingIds,
  intervalsOverlap,
} from './calendarMath.ts';

test('calendar slots cover 07:00 through 18:30 at 30-minute steps', () => {
  assert.equal(calendarTimeAtSlot(0), '07:00');
  assert.equal(calendarTimeAtSlot(23), '18:30');
  assert.equal(calendarTimeAtSlot(24), null);
});

test('overlap math treats touching endpoints and different days as non-overlapping', () => {
  const first = { id: 'a', dayOfWeek: 1, startTime: '08:00', endTime: '09:00' };
  assert.equal(intervalsOverlap(first, { ...first, id: 'b', startTime: '09:00', endTime: '10:00' }), false);
  assert.equal(intervalsOverlap(first, { ...first, id: 'b', dayOfWeek: 2 }), false);
});

test('overlap math marks both events for an actual same-day clash', () => {
  const events = [
    { id: 'class', dayOfWeek: 1, startTime: '08:00', endTime: '09:30' },
    { id: 'consult', dayOfWeek: 1, startTime: '09:00', endTime: '10:00' },
    { id: 'other-day', dayOfWeek: 2, startTime: '09:00', endTime: '10:00' },
  ];
  assert.deepEqual(findOverlappingIds(events), ['class', 'consult']);
});

test('calendar event positions clip to the visible day and reject invalid ranges', () => {
  assert.deepEqual(calendarEventPosition('07:00', '07:30', 24), { top: 0, height: 22 });
  assert.deepEqual(calendarEventPosition('18:30', '19:30', 24), { top: 552, height: 22 });
  assert.deepEqual(calendarEventPosition('06:00', '06:30', 24), { top: 0, height: 22 });
  assert.deepEqual(calendarEventPosition('19:00', '20:00', 24), { top: 552, height: 22 });
  assert.equal(calendarEventPosition('12:00', '11:30', 24), null);
});
