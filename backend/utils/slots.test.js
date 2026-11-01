const test = require('node:test');
const assert = require('node:assert');
const { splitIntoSlots, buildSlots, buildBusy, insideBookableHours, insideConsultHours, maxDurationAt, dayOfWeekOf } = require('./slots');

test('splits a 2-hour block into two 1-hour slots', () => {
  assert.deepStrictEqual(splitIntoSlots('09:00', '11:00').map(s => `${s.start}-${s.end}`), ['09:00-10:00', '10:00-11:00']);
});
test('keeps the shorter remainder as its own slot', () => {
  const s = splitIntoSlots('09:30', '11:00');
  assert.deepStrictEqual(s.map(x => `${x.start}-${x.end}:${x.duration}`), ['09:30-10:30:60', '10:30-11:00:30']);
});
test('day of week is timezone independent', () => {
  assert.strictEqual(dayOfWeekOf('2026-10-27'), 2); // Tuesday
});

// 2026-10-26 is a Monday. "now" is Mon 00:00 Manila so the 12-hour lead excludes nothing later in the week.
const base = {
  official: [{ dayOfWeek: 2, startTime: '09:00', endTime: '11:00' }],
  added: [], classes: [], appointments: [],
  today: '2026-10-26', nowMs: new Date('2026-10-26T00:00:00+08:00').getTime(), weeks: 1,
  includeVacant: false, // the tests below are about consultation hours; vacant slots have their own tests at the end
};

test('official weekly hours become hourly slots on the next matching date', () => {
  const s = buildSlots(base);
  assert.deepStrictEqual(s.map(x => `${x.date} ${x.start}`), ['2026-10-27 09:00', '2026-10-27 10:00']);
  assert.ok(s.every(x => x.kind === 'OFFICIAL' && !x.full));
});
test('added hours recur every week on their weekday', () => {
  const s = buildSlots({ ...base, weeks: 2, added: [{ dayOfWeek: 4, startTime: '13:00', endTime: '14:00' }] });
  const a = s.filter(x => x.kind === 'ADDED');
  assert.deepStrictEqual(a.map(x => `${x.date} ${x.start}`), ['2026-10-29 13:00', '2026-11-05 13:00']); // Thursdays
});
test('slots inside the 1-hour lead time are hidden', () => {
  const s = buildSlots({ ...base, nowMs: new Date('2026-10-27T08:30:00+08:00').getTime() });
  assert.deepStrictEqual(s.map(x => x.start), ['10:00']); // 09:00 is 30 min away, 10:00 is 1.5h away
  const edge = buildSlots({ ...base, nowMs: new Date('2026-10-27T08:00:00+08:00').getTime() });
  assert.deepStrictEqual(edge.map(x => x.start), ['09:00', '10:00']); // exactly 1h away is still bookable
});
test('an approved appointment removes the slot', () => {
  const s = buildSlots({ ...base, appointments: [{ date: '2026-10-27', time: '09:00', duration: 60, status: 'APPROVED' }] });
  assert.deepStrictEqual(s.map(x => x.start), ['10:00']);
});
test('three pending requests mark the slot full; two do not', () => {
  const pend = (n) => Array.from({ length: n }, () => ({ date: '2026-10-27', time: '09:00', duration: 60, status: 'PENDING' }));
  assert.strictEqual(buildSlots({ ...base, appointments: pend(2) })[0].full, false);
  assert.strictEqual(buildSlots({ ...base, appointments: pend(3) })[0].full, true);
  assert.strictEqual(buildSlots({ ...base, appointments: pend(3) })[0].pending, 3);
});
test('a class overlapping the slot hides it', () => {
  const s = buildSlots({ ...base, classes: [{ dayOfWeek: 2, startTime: '09:30', endTime: '10:30' }] });
  assert.strictEqual(s.length, 0); // both hourly slots touch the class
});
test('the date the faculty is out is skipped', () => {
  assert.strictEqual(buildSlots({ ...base, flaggedDate: '2026-10-27' }).length, 0);
});
test('insideConsultHours checks the whole range', () => {
  const args = { official: base.official, added: [] };
  assert.ok(insideConsultHours({ date: '2026-10-27', time: '10:00', duration: 60, ...args }));
  assert.ok(!insideConsultHours({ date: '2026-10-27', time: '10:30', duration: 60, ...args }));
  assert.ok(!insideConsultHours({ date: '2026-10-28', time: '10:00', duration: 60, ...args }));
});

test('back-to-back official and added hours form one continuous run', () => {
  const args = { official: [{ dayOfWeek: 2, startTime: '09:00', endTime: '10:00' }], added: [{ dayOfWeek: 2, startTime: '10:00', endTime: '11:00' }] };
  assert.ok(insideConsultHours({ date: '2026-10-27', time: '09:30', duration: 90, ...args }));
});
test('maxDurationAt is the rest of the continuous run, capped at 2 hours', () => {
  const two = { official: [{ dayOfWeek: 2, startTime: '09:00', endTime: '11:00' }], added: [] };
  assert.strictEqual(maxDurationAt({ date: '2026-10-27', time: '09:00', ...two }), 120);
  assert.strictEqual(maxDurationAt({ date: '2026-10-27', time: '10:00', ...two }), 60);
  assert.strictEqual(maxDurationAt({ date: '2026-10-27', time: '11:00', ...two }), 0); // outside
  const four = { official: [{ dayOfWeek: 2, startTime: '08:00', endTime: '12:00' }], added: [] };
  assert.strictEqual(maxDurationAt({ date: '2026-10-27', time: '08:00', ...four }), 120); // cap
});

// ---- Vacant slots: Mon-Fri 8 AM-5 PM minus consultation hours, classes, approved appointments, leave ----
const vac = { ...base, includeVacant: true };
const vacantOn = (slots, date) => slots.filter(x => x.kind === 'VACANT' && x.date === date).map(x => x.start);
const ALL_DAY = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00'];

test('vacant: a free weekday offers nine 1-hour slots from 8 AM to 5 PM', () => {
  const s = buildSlots({ ...vac, official: [] });
  assert.deepStrictEqual(vacantOn(s, '2026-10-27'), ALL_DAY);
  assert.ok(s.filter(x => x.kind === 'VACANT').every(x => x.duration === 60 && x.pending === 0 && !x.full));
  assert.strictEqual(s.find(x => x.start === '16:00').end, '17:00');
});

test('vacant: Saturday and Sunday are never vacant (Monday to Friday only)', () => {
  const s = buildSlots({ ...vac, official: [], weeks: 1, today: '2026-10-26', nowMs: new Date('2026-10-26T00:00:00+08:00').getTime() });
  const days = [...new Set(s.map(x => dayOfWeekOf(x.date)))].sort();
  assert.deepStrictEqual(days, [1, 2, 3, 4, 5]);
});

test('vacant: consultation hours are shown as consultation slots, not vacant ones', () => {
  const s = buildSlots(vac); // official Tuesday 09:00-11:00
  assert.deepStrictEqual(s.filter(x => x.date === '2026-10-27' && x.kind === 'OFFICIAL').map(x => x.start), ['09:00', '10:00']);
  assert.deepStrictEqual(vacantOn(s, '2026-10-27'), ['08:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00']);
});

test('vacant: classes are excluded, and a class that only touches an hour edge is not', () => {
  const s = buildSlots({ ...vac, official: [], classes: [{ dayOfWeek: 2, startTime: '13:00', endTime: '15:00' }] });
  assert.deepStrictEqual(vacantOn(s, '2026-10-27'), ['08:00', '09:00', '10:00', '11:00', '12:00', '15:00', '16:00']);
  const half = buildSlots({ ...vac, official: [], classes: [{ dayOfWeek: 2, startTime: '09:30', endTime: '10:30' }] });
  assert.ok(!vacantOn(half, '2026-10-27').includes('09:00') && !vacantOn(half, '2026-10-27').includes('10:00'));
});

test('vacant: an approved appointment removes the hour; pending ones count toward the 3-request limit', () => {
  const apt = (status, time = '14:00') => ({ date: '2026-10-27', time, duration: 60, status });
  const s1 = buildSlots({ ...vac, official: [], appointments: [apt('APPROVED')] });
  assert.ok(!vacantOn(s1, '2026-10-27').includes('14:00'));
  const s2 = buildSlots({ ...vac, official: [], appointments: [apt('PENDING'), apt('PENDING'), apt('PENDING')] });
  const slot = s2.find(x => x.date === '2026-10-27' && x.start === '14:00');
  assert.strictEqual(slot.pending, 3);
  assert.strictEqual(slot.full, true);
  const s3 = buildSlots({ ...vac, official: [], appointments: [apt('PENDING')] });
  assert.strictEqual(s3.find(x => x.date === '2026-10-27' && x.start === '14:00').full, false);
});

test('vacant: a longer approved appointment covers every hour it overlaps', () => {
  const s = buildSlots({ ...vac, official: [], appointments: [{ date: '2026-10-27', time: '14:00', duration: 120, status: 'APPROVED' }] });
  assert.ok(!vacantOn(s, '2026-10-27').includes('14:00') && !vacantOn(s, '2026-10-27').includes('15:00'));
  assert.ok(vacantOn(s, '2026-10-27').includes('16:00'));
});

test('vacant: the leave date is skipped, and the 1-hour lead time applies', () => {
  assert.deepStrictEqual(vacantOn(buildSlots({ ...vac, official: [], flaggedDate: '2026-10-27' }), '2026-10-27'), []);
  const s = buildSlots({ ...vac, official: [], nowMs: new Date('2026-10-27T10:30:00+08:00').getTime() });
  assert.deepStrictEqual(vacantOn(s, '2026-10-27'), ['12:00', '13:00', '14:00', '15:00', '16:00']); // 11:00 is only 30 min away
});

test('vacant: slots can be switched off, leaving only consultation hours', () => {
  const s = buildSlots({ ...base, includeVacant: false });
  assert.ok(s.every(x => x.kind === 'OFFICIAL' || x.kind === 'ADDED'));
});

test('buildBusy: lists classes and approved appointments as times only, never pending ones or names', () => {
  const busy = buildBusy({
    classes: [{ dayOfWeek: 2, startTime: '13:00', endTime: '15:00', subject: 'Secret', room: 'R1' }],
    appointments: [
      { date: '2026-10-27', time: '09:30', duration: 45, status: 'APPROVED', studentName: 'Maria' },
      { date: '2026-10-27', time: '11:00', duration: 60, status: 'PENDING', studentName: 'Juan' },
    ],
    today: '2026-10-26', weeks: 1,
  });
  assert.deepStrictEqual(busy, [
    { date: '2026-10-27', start: '13:00', end: '15:00', type: 'CLASS' },
    { date: '2026-10-27', start: '09:30', end: '10:15', type: 'BOOKED' },
  ]);
  assert.ok(!JSON.stringify(busy).includes('Maria') && !JSON.stringify(busy).includes('Secret'));
});

test('buildBusy: skips Sundays and the leave date', () => {
  const classes = [{ dayOfWeek: 0, startTime: '09:00', endTime: '10:00' }, { dayOfWeek: 2, startTime: '09:00', endTime: '10:00' }];
  assert.deepStrictEqual(buildBusy({ classes, appointments: [], today: '2026-10-26', weeks: 1 }).map(b => b.date), ['2026-10-27']);
  assert.deepStrictEqual(buildBusy({ classes, appointments: [], today: '2026-10-26', weeks: 1, flaggedDate: '2026-10-27' }), []);
});

test('insideBookableHours: vacant weekday hours are allowed even outside consultation hours', () => {
  const args = { official: base.official, added: [] }; // official Tuesday 09:00-11:00
  assert.ok(insideBookableHours({ date: '2026-10-27', time: '14:00', duration: 60, ...args }));   // vacant Tuesday
  assert.ok(insideBookableHours({ date: '2026-10-27', time: '16:00', duration: 60, ...args }));   // last vacant hour
  assert.ok(insideBookableHours({ date: '2026-10-27', time: '10:30', duration: 60, ...args }));   // runs from consult into vacant time, still 8-5
  assert.ok(!insideBookableHours({ date: '2026-10-27', time: '16:30', duration: 60, ...args }));  // ends after 5 PM
  assert.ok(!insideBookableHours({ date: '2026-10-27', time: '07:00', duration: 60, ...args }));  // starts before 8 AM
});

test('insideBookableHours: weekends need real consultation hours', () => {
  assert.ok(!insideBookableHours({ date: '2026-10-31', time: '10:00', duration: 60, official: [], added: [] })); // Saturday
  assert.ok(insideBookableHours({ date: '2026-10-31', time: '10:00', duration: 60, official: [{ dayOfWeek: 6, startTime: '09:00', endTime: '11:00' }], added: [] }));
  assert.ok(!insideBookableHours({ date: '2026-11-01', time: '10:00', duration: 60, official: [], added: [] })); // Sunday
});

test('insideBookableHours: consultation hours outside 8-5 still count (7:30 start)', () => {
  assert.ok(insideBookableHours({ date: '2026-10-27', time: '07:30', duration: 60, official: [{ dayOfWeek: 2, startTime: '07:30', endTime: '09:00' }], added: [] }));
});
