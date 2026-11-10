const test = require('node:test');
const assert = require('node:assert');
const { validateClassBlock } = require('./classBlock');

const ok = { subject: 'LIS 6 (BLIS 2-A)', room: 'New Library', dayOfWeek: 2, startTime: '07:00', endTime: '08:30' };
const bad = (patch, siblings, approved) => validateClassBlock({ ...ok, ...patch }, siblings, approved);

test('a valid block passes and is cleaned (trimmed, day as a number)', () => {
  const r = validateClassBlock({ ...ok, subject: '  LIS   6  ', dayOfWeek: '2' });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.value, { ...ok, subject: 'LIS 6' });
});

test('required fields and the day range', () => {
  assert.strictEqual(bad({ subject: '   ' }).ok, false);
  assert.strictEqual(bad({ room: '' }).ok, false);
  assert.strictEqual(bad({ room: undefined }).ok, false);
  for (const d of [-1, 7, 1.5, 'x', null, '', '  ', undefined, false, true, [], NaN]) assert.strictEqual(bad({ dayOfWeek: d }).ok, false, String(d));
  for (const d of [0, 1, 2, 3, 4, 5, 6, '0', '6']) assert.strictEqual(bad({ dayOfWeek: d }).ok, true, String(d)); // 0 = Sunday
});

test('times: format, 30-minute grid, 7 AM to 7 PM, end after start', () => {
  for (const t of ['7:00', '25:00', '09:60', '', null, 900]) assert.strictEqual(bad({ startTime: t }).ok, false, String(t));
  assert.strictEqual(bad({ startTime: '09:15', endTime: '10:00' }).ok, false);
  assert.strictEqual(bad({ startTime: '09:00', endTime: '10:10' }).ok, false);
  assert.strictEqual(bad({ startTime: '06:30', endTime: '08:00' }).ok, false);
  assert.strictEqual(bad({ startTime: '17:00', endTime: '18:30' }).ok, true);   // a 6:30 PM end is fine now
  assert.strictEqual(bad({ startTime: '18:30', endTime: '19:00' }).ok, true);   // the last half hour of the day
  assert.strictEqual(bad({ startTime: '07:00', endTime: '19:00' }).ok, true);   // the whole day as one block
  assert.strictEqual(bad({ startTime: '18:30', endTime: '19:30' }).ok, false);  // past 7:00 PM
  assert.strictEqual(bad({ startTime: '19:00', endTime: '19:30' }).ok, false);
  assert.strictEqual(bad({ startTime: '17:00', endTime: '18:00' }).ok, true);
  assert.strictEqual(bad({ startTime: '10:00', endTime: '10:00' }).ok, false);
  assert.strictEqual(bad({ startTime: '11:00', endTime: '10:00' }).ok, false);
  assert.strictEqual(bad({ startTime: '09:00', endTime: '09:30' }).ok, true);
});

test('overlap with another class the same day is refused; touching, other days and other faculty are fine', () => {
  const sib = [{ subject: 'ICT 1', dayOfWeek: 2, startTime: '08:00', endTime: '10:00' }];
  const r = bad({ startTime: '09:30', endTime: '10:30' }, sib);
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /ICT 1/);
  assert.match(r.error, /8:00 AM - 10:00 AM/);
  assert.strictEqual(bad({ startTime: '08:30', endTime: '09:30' }, sib).ok, false); // fully inside
  assert.strictEqual(bad({ startTime: '07:00', endTime: '08:00' }, sib).ok, true);  // ends exactly when the other starts
  assert.strictEqual(bad({ startTime: '10:00', endTime: '11:00' }, sib).ok, true);  // starts exactly when it ends
  assert.strictEqual(bad({ dayOfWeek: 3, startTime: '08:30', endTime: '09:30' }, sib).ok, true);
});

test('an approved future consultation blocks the time, on the matching weekday only', () => {
  // 2026-11-10 is a Tuesday (day 2); 2026-11-11 is a Wednesday.
  const apt = (date, time, duration) => ({ date, time, duration });
  const r = bad({ startTime: '08:00', endTime: '09:00' }, [], [apt('2026-11-10', '08:30', 30)]);
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /2026-11-10 at 8:30 AM/);
  assert.strictEqual(bad({ startTime: '08:00', endTime: '09:00' }, [], [apt('2026-11-11', '08:30', 30)]).ok, true);
  assert.strictEqual(bad({ startTime: '08:00', endTime: '08:30' }, [], [apt('2026-11-10', '08:30', 30)]).ok, true); // back to back
  assert.strictEqual(bad({ startTime: '08:00', endTime: '09:00' }, [], [apt('2026-11-10', '09:00', undefined)]).ok, true);
});

test('real schedule rows from the sheet all validate, one after another', () => {
  const { DEMO_FACULTY_SCHEDULES } = require('./demoSchedules');
  for (const f of DEMO_FACULTY_SCHEDULES) {
    const placed = [];
    for (const c of f.classes) {
      const r = validateClassBlock(c, placed);
      assert.strictEqual(r.ok, true, `${f.key} ${c.subject} ${c.startTime}: ${r.error}`);
      placed.push(r.value);
    }
  }
});

test('Sunday is day 0: it validates, clashes only with other Sunday classes, and is blocked by approved Sunday consultations', () => {
  const sib = [{ subject: 'ICT 1', dayOfWeek: 0, startTime: '08:00', endTime: '10:00' }];
  assert.strictEqual(bad({ dayOfWeek: 0 }).ok, true);
  const r = bad({ dayOfWeek: 0, startTime: '09:00', endTime: '10:30' }, sib);
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /Sunday/);
  assert.strictEqual(bad({ dayOfWeek: 6, startTime: '09:00', endTime: '10:30' }, sib).ok, true); // Saturday is a different day
  assert.strictEqual(bad({ dayOfWeek: 1, startTime: '09:00', endTime: '10:30' }, sib).ok, true); // so is Monday
  // 2026-11-08 is a Sunday; 2026-11-09 is a Monday
  const apt = (date, time, duration) => ({ date, time, duration });
  const blocked = bad({ dayOfWeek: 0, startTime: '08:00', endTime: '09:00' }, [], [apt('2026-11-08', '08:30', 30)]);
  assert.strictEqual(blocked.ok, false);
  assert.match(blocked.error, /2026-11-08/);
  assert.strictEqual(bad({ dayOfWeek: 0, startTime: '08:00', endTime: '09:00' }, [], [apt('2026-11-09', '08:30', 30)]).ok, true);
});

test('a block stays one continuous range: 2:30 PM to 4:00 PM is a single valid record', () => {
  const r = bad({ dayOfWeek: 2, startTime: '14:30', endTime: '16:00' });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.value, { ...ok, dayOfWeek: 2, startTime: '14:30', endTime: '16:00' });
});
