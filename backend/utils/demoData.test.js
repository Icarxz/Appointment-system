const test = require('node:test');
const assert = require('node:assert');
const { buildDemoData } = require('./demoData');
const { STUDENT_ID_REGEX, EMPLOYEE_ID_REGEX } = require('./idValidator');

const data = buildDemoData({ today: '2026-10-28' });

test('demo users are unusable fake accounts with valid ids', () => {
  assert.ok(data.students.length >= 20);
  for (const s of data.students) { assert.match(s.email, /@demo\.invalid$/); assert.ok(STUDENT_ID_REGEX.test(s.schoolId), s.schoolId); assert.match(s.programPosition, /^.+ \d[A-E]$/); }
  for (const f of data.faculty) { assert.match(f.email, /@demo\.invalid$/); assert.ok(EMPLOYEE_ID_REGEX.test(f.facultyId), f.facultyId); }
});

test('appointments cover past dates only, use known keys, and are repeatable', () => {
  const fk = new Set(data.faculty.map(f => f.key)), sk = new Set(data.students.map(s => s.key));
  assert.ok(data.appointments.length > 50);
  for (const a of data.appointments) { assert.ok(a.date < '2026-10-28'); assert.ok(fk.has(a.facultyKey) && sk.has(a.studentKey)); assert.notStrictEqual(a.status, 'PENDING'); }
  assert.deepStrictEqual(buildDemoData({ today: '2026-10-28' }).appointments, data.appointments);
});

test('there are student appeals with several reasons, all record-only', () => {
  const appeals = data.appointments.filter(a => a.appeal);
  assert.ok(appeals.length > 3);
  assert.ok(appeals.every(a => a.appeal.status === 'SUBMITTED'));
  assert.ok(new Set(appeals.map(a => a.appeal.reason)).size > 1);
});

// ---- Faculty schedules (from the owner's sheet, Nov 3 2026) ----
const { DEMO_FACULTY_SCHEDULES } = require('./demoSchedules');
const { timeToMinutes } = require('./timeMath');
const sched = (key) => DEMO_FACULTY_SCHEDULES.find(f => f.key === key);

test('five faculty with the expected class counts and consultation hours', () => {
  assert.deepStrictEqual(DEMO_FACULTY_SCHEDULES.map(f => f.key), ['colmo', 'edjan', 'fortaleza', 'percy', 'silva']);
  assert.deepStrictEqual(DEMO_FACULTY_SCHEDULES.map(f => f.classes.length), [4, 5, 19, 14, 0]);
  assert.deepStrictEqual(sched('percy').hours.map(h => [h.dayOfWeek, h.startTime, h.endTime]), [[2, '09:00', '11:00'], [4, '09:00', '11:00']]);
  assert.deepStrictEqual(sched('silva').hours.map(h => [h.dayOfWeek, h.startTime, h.endTime]), [[2, '12:30', '14:30'], [4, '12:30', '14:30']]);
  for (const k of ['colmo', 'edjan', 'fortaleza']) assert.strictEqual(sched(k).hours.length, 0);
});

test('every class and consultation row is Mon-Fri, well-formed and ends after it starts', () => {
  for (const f of DEMO_FACULTY_SCHEDULES) for (const r of [...f.classes, ...f.hours]) {
    assert.ok(r.dayOfWeek >= 1 && r.dayOfWeek <= 5, `${f.key} day ${r.dayOfWeek}`);
    assert.match(r.startTime, /^\d{2}:\d{2}$/); assert.match(r.endTime, /^\d{2}:\d{2}$/);
    assert.ok(timeToMinutes(r.startTime) < timeToMinutes(r.endTime), `${f.key} ${r.startTime}-${r.endTime}`);
  }
});

test("a faculty member's classes never overlap each other, and consultation hours never overlap a class", () => {
  for (const f of DEMO_FACULTY_SCHEDULES) {
    const all = [...f.classes.map(r => ({ ...r, t: 'class' })), ...f.hours.map(r => ({ ...r, t: 'consult' }))];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j];
      if (a.dayOfWeek !== b.dayOfWeek) continue;
      const clash = timeToMinutes(a.startTime) < timeToMinutes(b.endTime) && timeToMinutes(b.startTime) < timeToMinutes(a.endTime);
      assert.ok(!clash, `${f.key} day ${a.dayOfWeek}: ${a.startTime}-${a.endTime} (${a.t}) overlaps ${b.startTime}-${b.endTime} (${b.t})`);
    }
  }
});

test('demo output carries the classes and hours, and no demo appointment falls on a class', () => {
  assert.strictEqual(data.classes.length, 42);
  assert.strictEqual(data.hours.length, 4);
  assert.strictEqual(data.faculty.length, 5);
  const dow = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();
  for (const a of data.appointments) {
    const s = timeToMinutes(a.time), e = s + a.duration, d = dow(a.date);
    assert.ok(d >= 1 && d <= 5, `${a.date} is a weekend`);
    for (const c of sched(a.facultyKey).classes.filter(c => c.dayOfWeek === d)) {
      assert.ok(!(s < timeToMinutes(c.endTime) && timeToMinutes(c.startTime) < e), `${a.facultyKey} ${a.date} ${a.time} lands on ${c.subject}`);
    }
  }
});

test('slots built from a demo faculty show consultation hours, classes and vacant hours as designed', () => {
  const { buildSlots } = require('./slots');
  const mk = (rows) => rows.map(({ dayOfWeek, startTime, endTime }) => ({ dayOfWeek, startTime, endTime }));
  // Mon 2026-11-02 midnight Manila is long before the slots; Tue Nov 3 and Thu Nov 5 are Percy's consultation days.
  const percy = sched('percy');
  const slots = buildSlots({ official: mk(percy.hours), added: [], classes: mk(percy.classes), appointments: [], today: '2026-11-02', nowMs: Date.parse('2026-11-02T00:00:00+08:00'), weeks: 1 });
  const at = (date, start) => slots.find(s => s.date === date && s.start === start);
  assert.strictEqual(at('2026-11-03', '09:00').kind, 'OFFICIAL');
  assert.strictEqual(at('2026-11-05', '10:00').kind, 'OFFICIAL');
  assert.strictEqual(at('2026-11-03', '08:00').kind, 'VACANT');
  assert.strictEqual(at('2026-11-02', '09:00').kind, 'VACANT');           // Monday morning is free
  assert.strictEqual(at('2026-11-02', '11:00'), undefined);               // 11:00-12:00 overlaps the 11:30 class
  assert.strictEqual(at('2026-11-02', '13:00'), undefined);               // 13:00-14:00 overlaps the 13:30 class
  assert.strictEqual(at('2026-11-02', '12:00'), undefined);               // 12:00-13:00 overlaps the class that ends 12:30
});
