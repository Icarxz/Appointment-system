const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { fromOcrDraft, validateDraft, toScheduleRecord, subjectWithSection, compareNames, identityOf, importAccess } = require('./scheduleDraft');
const { DEMO_FACULTY_SCHEDULES } = require('./demoSchedules');

// The REAL output of ocr/schedule_ocr.py for the Percy sheet (committed with phase 3). On it the signature covers the printed name,
// so the name is a garbled read at about 64% confidence: exactly the case the identity check has to handle.
const FIXTURE = path.join(__dirname, '..', '..', 'ocr', 'fixtures', 'percy.extracted.json');
const draftOf = (over = {}) => ({ ...JSON.parse(fs.readFileSync(FIXTURE, 'utf8')), ...over });
const percy = DEMO_FACULTY_SCHEDULES.find(f => f.key === 'percy');
const rows = (over, opts) => { const d = fromOcrDraft(draftOf(over), opts); assert.ok(!d.error, d.error); return d; };
const check = (d, o) => validateDraft(d, { identityConfirmed: true, targetName: 'Carl Spence Percy', ...o });
const codes = (r) => r.errors.map(e => e.code);
const trustedName = (name) => ({ metadata: { ...draftOf().metadata, facultyName: name, facultyNameConfidence: 96, facultyNameNeedsReview: false } });

test('fromOcrDraft: rejects things that are not a draft', () => {
  for (const bad of [null, 'x', {}, { classes: [] }, { classes: {}, consultationHours: [] }]) assert.ok(fromOcrDraft(bad).error, JSON.stringify(bad));
  assert.ok(fromOcrDraft({ classes: Array.from({ length: 201 }, () => ({})), consultationHours: [] }).error);
  assert.ok(fromOcrDraft({ status: 'FAILED', classes: [], consultationHours: [] }).error);
});

test('fromOcrDraft: the real Percy draft becomes 14 classes + 2 consultation blocks with stable ids and its sheet details', () => {
  const d = rows();
  assert.strictEqual(d.classes.length, 14);
  assert.strictEqual(d.consultationHours.length, 2);
  assert.deepStrictEqual(d.classes.slice(0, 2).map(c => c.id), ['c1', 'c2']);
  assert.strictEqual(d.metadata.academicYear, '2025-2026');
  assert.strictEqual(d.metadata.effectivityDate, '2026-03-09');
  assert.strictEqual(d.workload.lectureHours, 6);
});

test('fromOcrDraft: the OCR flags become readable review reasons', () => {
  const flagged = rows().classes.filter(c => c.flags.includes('room-prefix-check'));
  assert.ok(flagged.length > 0);
  assert.ok(flagged.every(c => c.needsReview && /IICT/.test(c.reviewReasons.join(' '))));
  const low = rows({ classes: [{ dayOfWeek: 1, startTime: '08:00', endTime: '09:00', courseTitle: 'X', section: 'S', room: 'R', confidence: 40, flags: [] }] }).classes[0];
  assert.deepStrictEqual(low.flags, ['low-confidence']);
  assert.strictEqual(low.needsReview, true);
});

test('fromOcrDraft: weekend consultations are excluded with a warning; weekend classes are kept', () => {
  const d = rows({
    classes: [{ dayOfWeek: 6, startTime: '08:00', endTime: '10:00', subject: 'Sat class', section: 'BSIT 1-A', room: 'R1' }],
    consultationHours: [{ dayOfWeek: 6, startTime: '09:00', endTime: '11:00' }, { dayOfWeek: 0, startTime: '09:00', endTime: '10:00' }, { dayOfWeek: 2, startTime: '09:00', endTime: '11:00' }],
  });
  assert.strictEqual(d.classes[0].dayOfWeek, 6);
  assert.deepStrictEqual(d.consultationHours.map(h => h.dayOfWeek), [2]);
  assert.strictEqual(d.excludedWeekendConsultations, 2);
  assert.ok(d.warnings.some(w => w.code === 'WEEKEND_CONSULTATION_EXCLUDED'));
});

test('fromOcrDraft: the OCR name warning is not copied (the identity check replaces it)', () => {
  assert.ok(!rows().warnings.some(w => w.code === 'faculty-name-needs-review'));
});

test('identity: a garbled read (the real Percy sheet) is UNREADABLE, not a mismatch, and a person can confirm it', () => {
  const d = rows();
  assert.strictEqual(identityOf(d.metadata, 'Carl Spence Percy').status, 'unreadable');
  const no = validateDraft(d, { identityConfirmed: false, targetName: 'Carl Spence Percy' });
  assert.deepStrictEqual(codes(no), ['IDENTITY_NOT_CONFIRMED']);
  const yes = check(d);
  assert.deepStrictEqual(yes.errors, []);
  assert.strictEqual(yes.ok, true);
  assert.strictEqual(yes.summary.weeklyConsultationMinutes, 240);
});

test('identity: a clear read of the right name passes without a checkbox', () => {
  const d = rows(trustedName('CARL SPENCE PERCY MIT'));
  const r = validateDraft(d, { identityConfirmed: false, targetName: 'Carl Spence Percy' });
  assert.strictEqual(r.identity.status, 'match');
  assert.deepStrictEqual(r.errors, []);
});

test('identity: a clear read of ANOTHER name is a hard block that the checkbox cannot override', () => {
  const d = rows(trustedName('MARY ANNE EDJAN'));
  const r = validateDraft(d, { identityConfirmed: true, targetName: 'Carl Spence Percy' });
  assert.strictEqual(r.identity.status, 'mismatch');
  assert.ok(codes(r).includes('IDENTITY_MISMATCH'));
  assert.strictEqual(r.ok, false);
});

test('identity: below 90% confidence, or flagged by the OCR, is never trusted', () => {
  const md = draftOf().metadata;
  assert.strictEqual(identityOf({ ...md, facultyName: 'CARL SPENCE PERCY', facultyNameConfidence: 89, facultyNameNeedsReview: false }, 'Carl Spence Percy').status, 'unreadable');
  assert.strictEqual(identityOf({ ...md, facultyName: 'CARL SPENCE PERCY', facultyNameConfidence: 99, facultyNameNeedsReview: true }, 'Carl Spence Percy').status, 'unreadable');
  assert.strictEqual(identityOf({ ...md, facultyName: '', facultyNameConfidence: 99, facultyNameNeedsReview: false }, 'Carl Spence Percy').status, 'unreadable');
});

test('compareNames: titles, case and middle initials are ignored; a different name is a mismatch', () => {
  assert.strictEqual(compareNames('CARL SPENCE PERCY MIT', 'Percy, Carl Spence D.'), 'match');
  assert.strictEqual(compareNames('Carl Percy', 'Carl Spence Percy'), 'match');
  assert.strictEqual(compareNames('Mary Anne Edjan', 'Carl Spence Percy'), 'mismatch');
  assert.strictEqual(compareNames('', 'Carl Spence Percy'), 'unknown');
});

test('metadata that was not read is a warning; a workload that does not add up is a warning', () => {
  const d = rows({ metadata: { ...draftOf().metadata, term: '', effectivityDate: '' } });
  const r = check(d);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.warnings.filter(w => w.code === 'METADATA_MISSING').length, 2);
  const off = check(rows({ workload: { lectureHours: 6, laboratoryHours: 4 } }));
  assert.ok(off.warnings.some(w => w.code === 'WORKLOAD_MISMATCH'));
  assert.ok(!check(rows()).warnings.some(w => w.code === 'WORKLOAD_MISMATCH')); // the real sheet reconciles: 6 + 9 = 15
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

test('rows the OCR flagged become warnings, not errors, and point at their row', () => {
  const r = check(rows());
  assert.strictEqual(r.ok, true);
  const w = r.warnings.find(x => x.code === 'REVIEW_ROW');
  assert.ok(w && w.ref.type === 'class');
  assert.match(w.message, /IICT/);
});

test('toScheduleRecord: section is folded into the subject once, like the demo schedules', () => {
  assert.strictEqual(subjectWithSection('LIS 6', 'BLIS 2-A'), 'LIS 6 (BLIS 2-A)');
  assert.strictEqual(subjectWithSection('LIS 6 (BLIS 2-A)', 'BLIS 2-A'), 'LIS 6 (BLIS 2-A)');
  assert.strictEqual(subjectWithSection('LIS 6', ''), 'LIS 6');
  const rec = toScheduleRecord({ dayOfWeek: 2, startTime: '07:00', endTime: '08:30', subject: 'LIS 6', section: 'BLIS 2-A', room: ' New Library ' });
  assert.deepStrictEqual(rec, { dayOfWeek: 2, startTime: '07:00', endTime: '08:30', subject: 'LIS 6 (BLIS 2-A)', room: 'New Library' });
});

test('round trip: the real Percy draft equals the demo schedule, and every difference is a row the OCR flagged', () => {
  const d = rows();
  const demo = percy.classes.map(c => ({ dayOfWeek: c.dayOfWeek, startTime: c.startTime, endTime: c.endTime, subject: c.subject, room: c.room }));
  const got = d.classes.map(toScheduleRecord);
  assert.strictEqual(got.length, demo.length);
  got.forEach((rec, i) => {
    const { room: _r1, ...restGot } = rec, { room: _r2, ...restDemo } = demo[i];
    assert.deepStrictEqual(restGot, restDemo);                                   // day, times and subject always agree
    if (rec.room !== demo[i].room) {                                             // the known "IICT" read as "ICT" misread...
      assert.strictEqual(rec.room.replace(/^ICT/, 'IICT'), demo[i].room);
      assert.ok(d.classes[i].flags.includes('room-prefix-check'), `row ${i} differs from the demo and must be flagged`); // ...is never silent
    }
  });
});

test('importAccess: faculty only for themselves, admin for anyone, dean and student never', () => {
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
