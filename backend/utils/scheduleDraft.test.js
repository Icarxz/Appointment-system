const test = require('node:test');
const assert = require('node:assert');
const { fromOcrDraft, validateDraft, toScheduleRecord, subjectWithSection } = require('./scheduleDraft');
const { DEMO_FACULTY_SCHEDULES } = require('./demoSchedules');

// A draft shaped like backend/ocr/schedule_extractor.py output, built from the Percy demo schedule (the data phase 3 matched).
const percy = DEMO_FACULTY_SCHEDULES.find(f => f.key === 'percy');
const splitSection = (subject) => { const m = subject.match(/^(.*) \(([^)]+)\)$/); return m ? { subject: m[1], section: m[2] } : { subject, section: '' }; };
const draftOf = (over = {}) => ({
  parserVersion: 'test',
  document: { term: '2nd Semester', academicYear: '2025-2026', effectivityDate: 'March 9, 2026', facultyNameHint: 'Spence' },
  classes: percy.classes.map(c => ({ dayOfWeek: c.dayOfWeek, startTime: c.startTime, endTime: c.endTime, room: c.room, ...splitSection(c.subject), confidence: 92, needsReview: false, reviewReasons: [], rawText: 'x' })),
  consultationHours: percy.hours.map(h => ({ ...h, label: 'CONSULTATION HOURS', confidence: 95, needsReview: false, reviewReasons: [] })),
  warnings: [{ code: 'FACULTY_IDENTITY', message: 'covered by a signature' }],
  status: 'NEEDS_REVIEW', ...over,
});
const rows = (over) => { const d = fromOcrDraft(draftOf(over)); assert.ok(!d.error, d.error); return d; };
const check = (d, o) => validateDraft(d, { identityConfirmed: true, ...o });
const codes = (r) => r.errors.map(e => e.code);

test('fromOcrDraft: rejects things that are not a draft', () => {
  for (const bad of [null, 'x', {}, { classes: [] }, { classes: {}, consultationHours: [] }]) assert.ok(fromOcrDraft(bad).error, JSON.stringify(bad));
  const many = { classes: Array.from({ length: 201 }, () => ({})), consultationHours: [] };
  assert.ok(fromOcrDraft(many).error);
});

test('fromOcrDraft: the Percy draft becomes 14 classes + 2 consultation blocks with stable ids', () => {
  const d = rows();
  assert.strictEqual(d.classes.length, 14);
  assert.strictEqual(d.consultationHours.length, 2);
  assert.deepStrictEqual(d.classes.slice(0, 2).map(c => c.id), ['c1', 'c2']);
  assert.strictEqual(d.document.academicYear, '2025-2026');
});

test('fromOcrDraft: weekend consultations are excluded with a warning; weekend classes are kept', () => {
  const d = rows({
    classes: [{ dayOfWeek: 6, startTime: '08:00', endTime: '10:00', subject: 'Sat class', section: 'BSIT 1-A', room: 'R1' }],
    consultationHours: [{ dayOfWeek: 6, startTime: '09:00', endTime: '11:00' }, { dayOfWeek: 0, startTime: '09:00', endTime: '10:00' }, { dayOfWeek: 2, startTime: '09:00', endTime: '11:00' }],
  });
  assert.strictEqual(d.classes.length, 1);
  assert.strictEqual(d.classes[0].dayOfWeek, 6);
  assert.deepStrictEqual(d.consultationHours.map(h => h.dayOfWeek), [2]);
  assert.strictEqual(d.excludedWeekendConsultations, 2);
  assert.ok(d.warnings.some(w => w.code === 'WEEKEND_CONSULTATION_EXCLUDED'));
});

test('fromOcrDraft: the OCR faculty-identity warning is not copied (it becomes a blocking check instead)', () => {
  assert.ok(!rows().warnings.some(w => w.code === 'FACULTY_IDENTITY'));
});

test('a clean Percy draft passes once the identity is confirmed, and not before', () => {
  const d = rows();
  const ok = check(d);
  assert.deepStrictEqual(ok.errors, []);
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.summary.weeklyConsultationMinutes, 240);
  const no = validateDraft(d, { identityConfirmed: false });
  assert.deepStrictEqual(codes(no), ['IDENTITY_NOT_CONFIRMED']);
});

test('classes: overlap, 7 PM end, 30-minute grid and missing room are all blocking', () => {
  const d = rows();
  const base = { dayOfWeek: 3, subject: 'X', section: 'S', room: 'R1', needsReview: false, reviewReasons: [] };
  d.classes = [
    { ...base, id: 'a', startTime: '08:00', endTime: '10:00' },
    { ...base, id: 'b', startTime: '09:30', endTime: '10:30' },   // overlaps a
    { ...base, id: 'c', startTime: '18:30', endTime: '19:00' },   // fine: the last half hour
    { ...base, id: 'd', dayOfWeek: 4, startTime: '18:30', endTime: '19:30' },   // after 7 PM (another day, so it does not touch c)
    { ...base, id: 'e', startTime: '12:15', endTime: '13:00' },   // 15-minute start
    { ...base, id: 'f', startTime: '14:00', endTime: '15:00', room: '' },
  ];
  const bad = new Set(check(d).errors.filter(e => e.code === 'CLASS_INVALID').map(e => e.ref.id));
  assert.deepStrictEqual([...bad].sort(), ['a', 'b', 'd', 'e', 'f']);
  assert.ok(!bad.has('c'));
});

test('classes: touching blocks are allowed', () => {
  const d = rows();
  const base = { dayOfWeek: 1, subject: 'X', section: 'S', room: 'R', needsReview: false, reviewReasons: [] };
  d.classes = [{ ...base, id: 'a', startTime: '08:00', endTime: '09:00' }, { ...base, id: 'b', startTime: '09:00', endTime: '10:00' }];
  assert.ok(!codes(check(d)).includes('CLASS_INVALID'));
});

test('consultation hours: Saturday / Sunday are blocking if they get in, and the total must be exactly 4 hours', () => {
  const d = rows();
  d.consultationHours = [{ id: 'h1', dayOfWeek: 6, startTime: '09:00', endTime: '13:00', needsReview: false, reviewReasons: [] }];
  assert.ok(codes(check(d)).includes('CONSULT_DAY'));
  d.consultationHours = [{ id: 'h1', dayOfWeek: 2, startTime: '09:00', endTime: '11:00', needsReview: false, reviewReasons: [] }];
  const r = check(d);
  assert.ok(codes(r).includes('CONSULT_TOTAL'));
  assert.match(r.errors.find(e => e.code === 'CONSULT_TOTAL').message, /2\.0/);
  const soft = check(d, { requireFourHours: false });
  assert.ok(!codes(soft).includes('CONSULT_TOTAL'));
  assert.ok(soft.warnings.some(w => w.code === 'CONSULT_TOTAL'));
});

test('consultation hours may not overlap each other or a class', () => {
  const d = rows();
  const h = { needsReview: false, reviewReasons: [] };
  d.consultationHours = [
    { ...h, id: 'h1', dayOfWeek: 2, startTime: '09:00', endTime: '11:00' },
    { ...h, id: 'h2', dayOfWeek: 2, startTime: '10:30', endTime: '12:30' },   // overlaps h1
    { ...h, id: 'h3', dayOfWeek: 2, startTime: '15:00', endTime: '16:00' },   // inside a Percy class (14:30-16:00)
  ];
  const c = codes(check(d));
  assert.ok(c.includes('CONSULT_OVERLAP'));
  assert.ok(c.includes('CONSULT_CLASS_OVERLAP'));
});

test('an approved future consultation blocks a class; a pending one only warns', () => {
  const d = rows();
  d.classes = [{ id: 'a', dayOfWeek: 2, subject: 'X', section: '', room: 'R', startTime: '09:00', endTime: '10:00', needsReview: false, reviewReasons: [] }];
  d.consultationHours = [];
  const tuesday = '2026-11-17'; // a Tuesday
  const approved = check(d, { approved: [{ date: tuesday, time: '09:30', duration: 60 }], requireFourHours: false });
  assert.ok(codes(approved).includes('CLASS_INVALID'));
  const pending = check(d, { pending: [{ date: tuesday, time: '09:30', duration: 60 }], requireFourHours: false });
  assert.ok(!codes(pending).includes('CLASS_INVALID'));
  assert.ok(pending.warnings.some(w => w.code === 'PENDING_OVERLAP'));
});

test('rows the OCR flagged become warnings, not errors', () => {
  const d = rows();
  d.classes[0].needsReview = true; d.classes[0].reviewReasons = ['Low OCR confidence (41).'];
  const r = check(d);
  assert.strictEqual(r.ok, true);
  const w = r.warnings.find(x => x.code === 'REVIEW_ROW');
  assert.deepStrictEqual(w.ref, { type: 'class', id: 'c1' });
  assert.match(w.message, /Low OCR confidence/);
});

test('toScheduleRecord: section is folded into the subject once, like the demo schedules', () => {
  assert.strictEqual(subjectWithSection('LIS 6', 'BLIS 2-A'), 'LIS 6 (BLIS 2-A)');
  assert.strictEqual(subjectWithSection('LIS 6 (BLIS 2-A)', 'BLIS 2-A'), 'LIS 6 (BLIS 2-A)');
  assert.strictEqual(subjectWithSection('LIS 6', ''), 'LIS 6');
  const rec = toScheduleRecord({ dayOfWeek: 2, startTime: '07:00', endTime: '08:30', subject: 'LIS 6', section: 'BLIS 2-A', room: ' New Library ' });
  assert.deepStrictEqual(rec, { dayOfWeek: 2, startTime: '07:00', endTime: '08:30', subject: 'LIS 6 (BLIS 2-A)', room: 'New Library' });
});

test('round trip: the Percy draft converts to records equal to the demo schedule', () => {
  const recs = rows().classes.map(toScheduleRecord);
  assert.deepStrictEqual(recs, percy.classes.map(c => ({ dayOfWeek: c.dayOfWeek, startTime: c.startTime, endTime: c.endTime, subject: c.subject, room: c.room })));
});

test('importAccess: faculty only for themselves, admin for anyone, dean and student never', () => {
  const { importAccess } = require('./scheduleDraft');
  assert.strictEqual(importAccess({ role: 'FACULTY', userId: 'f1' }, 'f1'), 'self');
  assert.strictEqual(importAccess({ role: 'FACULTY', userId: 'f1' }, 'f2'), null);
  assert.strictEqual(importAccess({ role: 'ADMIN', userId: 'a1' }, 'f2'), 'admin');
  assert.strictEqual(importAccess({ role: 'DEAN', userId: 'd1' }, 'd1'), null);
  assert.strictEqual(importAccess({ role: 'STUDENT', userId: 's1' }, 's1'), null);
  assert.strictEqual(importAccess(null, 'f1'), null);
  assert.strictEqual(importAccess({ role: 'ADMIN' }, ''), null);
});

test('re-checking rows a browser sent keeps weekend consultations so they are reported, not dropped', () => {
  const sent = { classes: [], consultationHours: [{ dayOfWeek: 6, startTime: '09:00', endTime: '13:00' }] };
  assert.strictEqual(fromOcrDraft(sent).consultationHours.length, 0);                                    // first read: excluded with a warning
  const again = fromOcrDraft(sent, { keepWeekendConsultations: true });
  assert.strictEqual(again.consultationHours.length, 1);                                                 // re-check: kept
  assert.ok(validateDraft(again, { identityConfirmed: true }).errors.some(e => e.code === 'CONSULT_DAY')); // ...and rejected
});
