const test = require('node:test');
const assert = require('node:assert');
const { openWindow } = require('./slots');
const { planApproval } = require('./approvalTime');

const MON = '2026-11-02'; // a Monday
const none = { official: [], added: [], classes: [], appointments: [] };
const approved = (id, time, duration) => ({ _id: id, date: MON, time, duration, status: 'APPROVED' });
const win = (over = {}) => openWindow({ ...none, date: MON, time: '08:00', ...over });

test('openWindow: same as availableWindow when nothing covers the requested start', () => {
  const w = win({ classes: [{ dayOfWeek: 1, startTime: '10:00', endTime: '11:00' }] });
  assert.deepStrictEqual([w.start, w.end, w.minutes], ['08:00', '10:00', 120]);
});

test('openWindow: after another student got 8:00-8:30, the window starts at 8:30', () => {
  const w = win({ appointments: [approved('a', '08:00', 30)], classes: [{ dayOfWeek: 1, startTime: '10:00', endTime: '11:00' }] });
  assert.deepStrictEqual([w.start, w.end, w.minutes], ['08:30', '10:00', 90]);
  assert.strictEqual(w.label, '8:30 AM - 10:00 AM (1 hr 30 mins total)');
});

test('openWindow: back-to-back approved appointments push the start further', () => {
  const w = win({ appointments: [approved('a', '08:00', 30), approved('b', '08:30', 30)] });
  assert.strictEqual(w.start, '09:00');
});

test('openWindow: the whole hour taken means no time left; pending requests never matter', () => {
  assert.strictEqual(win({ appointments: [approved('a', '08:00', 120)], classes: [{ dayOfWeek: 1, startTime: '10:00', endTime: '11:00' }] }).minutes, 0);
  const pending = { _id: 'p', date: MON, time: '08:00', duration: 60, status: 'PENDING' };
  assert.strictEqual(win({ appointments: [pending] }).start, '08:00');
});

test('openWindow: the request being approved does not block itself', () => {
  const w = openWindow({ ...none, date: MON, time: '08:00', appointments: [approved('me', '08:00', 60)], excludeId: 'me' });
  assert.strictEqual(w.start, '08:00');
});

const W = (start, end) => ({ start, end, minutes: (Number(end.slice(0, 2)) * 60 + Number(end.slice(3))) - (Number(start.slice(0, 2)) * 60 + Number(start.slice(3))) });
const apt = { time: '08:00', duration: 60 };

test('planApproval: no choice keeps the requested start and length when they fit', () => {
  const p = planApproval({ window: W('08:00', '10:00'), apt, body: {} });
  assert.deepStrictEqual([p.ok, p.time, p.duration, p.moved, p.lengthChanged], [true, '08:00', 60, false, false]);
});

test('planApproval: first student 30 minutes, second student moved to 8:30', () => {
  const first = planApproval({ window: W('08:00', '10:00'), apt, body: { duration: 30 } });
  assert.deepStrictEqual([first.ok, first.time, first.duration, first.lengthChanged], [true, '08:00', 30, true]);
  const second = planApproval({ window: W('08:30', '10:00'), apt, body: { time: '08:30', duration: 45 } });
  assert.deepStrictEqual([second.ok, second.time, second.duration, second.moved], [true, '08:30', 45, true]);
});

test('planApproval: without choosing a new start, a taken start is refused with the free range', () => {
  const p = planApproval({ window: W('08:30', '10:00'), apt, body: { duration: 30 } });
  assert.strictEqual(p.ok, false);
  assert.match(p.error, /8:30 AM - 10:00 AM/);
});

test('planApproval: start before or after the window, and lengths that run past it, are refused', () => {
  const w = W('08:30', '10:00');
  assert.strictEqual(planApproval({ window: w, apt, body: { time: '08:15' } }).ok, false);
  assert.strictEqual(planApproval({ window: w, apt, body: { time: '10:00', duration: 15 } }).ok, false);
  const long = planApproval({ window: w, apt, body: { time: '09:30', duration: 60 } });
  assert.strictEqual(long.ok, false);
  assert.match(long.error, /Only 30 minutes are free from 9:30 AM/);
  assert.strictEqual(planApproval({ window: w, apt, body: { time: '09:30', duration: 30 } }).ok, true);
});

test('planApproval: bad numbers are refused', () => {
  const w = W('08:00', '17:00');
  for (const body of [{ time: '8:30' }, { time: '08:20' }, { time: 830 }, { duration: 10 }, { duration: 20 }, { duration: 135 }, { duration: 150 }, { duration: 'x' }, { duration: 45.5 }]) {
    assert.strictEqual(planApproval({ window: w, apt, body }).ok, false, JSON.stringify(body));
  }
  assert.strictEqual(planApproval({ window: w, apt, body: { duration: 120 } }).ok, true);
  assert.strictEqual(planApproval({ window: w, apt, body: { time: '08:15', duration: 15 } }).ok, true);
});

test('planApproval: nothing left is a 409 whatever was chosen', () => {
  const p = planApproval({ window: { start: '08:00', end: '08:00', minutes: 0 }, apt, body: { time: '08:00', duration: 15 } });
  assert.deepStrictEqual([p.ok, p.status], [false, 409]);
  assert.strictEqual(planApproval({ window: null, apt, body: {} }).ok, false);
});

test('a longer consultation than the old consultation-hours limit is allowed in vacant time (up to 2 hours)', () => {
  const w = win({}); // plain Monday: 8:00 to 5:00 free
  const p = planApproval({ window: w, apt, body: { duration: 120 } });
  assert.deepStrictEqual([p.ok, p.duration], [true, 120]);
});
