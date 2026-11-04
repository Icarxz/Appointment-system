const test = require('node:test');
const assert = require('node:assert');
const { availableWindow } = require('./slots');

// 2026-11-02 is a Monday (dayOfWeek 1), 2026-11-07 a Saturday (6).
const MON = '2026-11-02';
const SAT = '2026-11-07';
const none = { official: [], added: [], classes: [], appointments: [] };

test('a plain weekday runs to the end of the vacant window (5 PM)', () => {
  const w = availableWindow({ ...none, date: MON, time: '14:00' });
  assert.deepStrictEqual([w.start, w.end, w.minutes], ['14:00', '17:00', 180]);
});

test('a class stops the window: 8:00 request with a class at 10:00 has 2 hours', () => {
  const w = availableWindow({ ...none, date: MON, time: '08:00', classes: [{ dayOfWeek: 1, startTime: '10:00', endTime: '11:00' }] });
  assert.strictEqual(w.minutes, 120);
  assert.strictEqual(w.label, '8:00 AM - 10:00 AM (2 hrs total)');
});

test('an approved appointment stops the window, a pending one does not', () => {
  const apts = [
    { _id: 'a1', date: MON, time: '09:30', duration: 30, status: 'APPROVED' },
    { _id: 'a2', date: MON, time: '08:30', duration: 60, status: 'PENDING' },
    { _id: 'a3', date: MON, time: '08:45', duration: 60, status: 'REJECTED' },
  ];
  assert.strictEqual(availableWindow({ ...none, date: MON, time: '08:00', appointments: apts }).minutes, 90);
});

test('the request being looked at does not block itself (excludeId)', () => {
  const apts = [{ _id: 'me', date: MON, time: '09:00', duration: 60, status: 'APPROVED' }];
  assert.strictEqual(availableWindow({ ...none, date: MON, time: '09:00', appointments: apts }).minutes, 0);
  assert.strictEqual(availableWindow({ ...none, date: MON, time: '09:00', appointments: apts, excludeId: 'me' }).minutes, 480);
});

test('approved appointments on other days and classes on other weekdays are ignored', () => {
  const w = availableWindow({
    ...none, date: MON, time: '15:00',
    classes: [{ dayOfWeek: 2, startTime: '16:00', endTime: '17:00' }],
    appointments: [{ _id: 'x', date: '2026-11-03', time: '16:00', duration: 60, status: 'APPROVED' }],
  });
  assert.strictEqual(w.minutes, 120);
});

test('a start inside a class or an approved appointment has no time', () => {
  const inClass = availableWindow({ ...none, date: MON, time: '10:30', classes: [{ dayOfWeek: 1, startTime: '10:00', endTime: '11:00' }] });
  assert.strictEqual(inClass.minutes, 0);
  assert.strictEqual(inClass.label, 'No time available');
  const booked = availableWindow({ ...none, date: MON, time: '10:15', appointments: [{ _id: 'b', date: MON, time: '10:00', duration: 30, status: 'APPROVED' }] });
  assert.strictEqual(booked.minutes, 0);
});

test('back-to-back: an approved appointment ending at the start leaves the rest open', () => {
  const w = availableWindow({ ...none, date: MON, time: '08:30', appointments: [{ _id: 'a', date: MON, time: '08:00', duration: 30, status: 'APPROVED' }] });
  assert.deepStrictEqual([w.start, w.end, w.minutes], ['08:30', '17:00', 510]);
});

test('Saturday has no vacant window: only consultation hours count', () => {
  const official = [{ dayOfWeek: 6, startTime: '09:00', endTime: '11:00' }];
  assert.strictEqual(availableWindow({ ...none, official, date: SAT, time: '09:00' }).minutes, 120);
  assert.strictEqual(availableWindow({ ...none, official, date: SAT, time: '10:30' }).minutes, 30);
  assert.strictEqual(availableWindow({ ...none, official, date: SAT, time: '14:00' }).minutes, 0);
});

test('consultation hours that run past 5 PM still count', () => {
  const added = [{ dayOfWeek: 1, startTime: '16:00', endTime: '18:00' }];
  const w = availableWindow({ ...none, added, date: MON, time: '16:00' });
  assert.deepStrictEqual([w.end, w.minutes], ['18:00', 120]);
});

test('consultation hours before 8 AM join the vacant window into one run', () => {
  const official = [{ dayOfWeek: 1, startTime: '07:30', endTime: '09:00' }];
  const w = availableWindow({ ...none, official, date: MON, time: '07:30', classes: [{ dayOfWeek: 1, startTime: '10:00', endTime: '11:00' }] });
  assert.deepStrictEqual([w.start, w.end, w.minutes], ['07:30', '10:00', 150]);
});

test('maxMinutes is capped at the 2-hour consultation limit, minutes is not', () => {
  const w = availableWindow({ ...none, date: MON, time: '08:00' });
  assert.deepStrictEqual([w.minutes, w.maxMinutes], [540, 120]);
});

test('Sunday and times outside every bookable span have no time', () => {
  assert.strictEqual(availableWindow({ ...none, date: '2026-11-01', time: '09:00' }).minutes, 0);
  assert.strictEqual(availableWindow({ ...none, date: MON, time: '06:00' }).minutes, 0);
  assert.strictEqual(availableWindow({ ...none, date: MON, time: '17:00' }).minutes, 0);
});

test('length labels: singular hour, hours with minutes, minutes only', () => {
  const classes = (start) => [{ dayOfWeek: 1, startTime: start, endTime: '12:00' }];
  assert.strictEqual(availableWindow({ ...none, date: MON, time: '08:00', classes: classes('09:00') }).label, '8:00 AM - 9:00 AM (1 hr total)');
  assert.strictEqual(availableWindow({ ...none, date: MON, time: '08:00', classes: classes('09:30') }).label, '8:00 AM - 9:30 AM (1 hr 30 mins total)');
  assert.strictEqual(availableWindow({ ...none, date: MON, time: '08:00', classes: classes('08:45') }).label, '8:00 AM - 8:45 AM (45 mins total)');
});
