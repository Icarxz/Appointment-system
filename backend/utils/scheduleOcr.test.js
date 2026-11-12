// Compares the OCR prototype's draft (ocr/fixtures/percy.extracted.json, produced by ocr/schedule_ocr.py from the
// scanned VAA-FM-061 sheet) with the Percy fixture the repo already trusts (demoSchedules.js).
// Guarantee under test: day/start/end are exact; any text the OCR got wrong is FLAGGED for review, never silent.
const test = require('node:test');
const assert = require('node:assert');
const draft = require('../../ocr/fixtures/percy.extracted.json');
const { DEMO_FACULTY_SCHEDULES } = require('./demoSchedules');
const { validateClassBlock } = require('./classBlock');

const percy = DEMO_FACULTY_SCHEDULES.find(f => f.key === 'percy');
const key = b => `${b.dayOfWeek} ${b.startTime}-${b.endTime}`;
const norm = s => String(s).replace(/\s+/g, ' ').trim();

test('draft is never an active schedule and records its provenance', () => {
  assert.strictEqual(draft.status, 'DRAFT_NEEDS_REVIEW');
  assert.strictEqual(draft.template, 'VAA-FM-061');
  assert.match(draft.source.sha256, /^[0-9a-f]{64}$/);
});

test('header: term, academic year, effectivity date and form id are read; faculty name is flagged for a human', () => {
  assert.deepStrictEqual(
    [draft.metadata.term, draft.metadata.academicYear, draft.metadata.effectivityDate, draft.metadata.formId],
    ['Second Semester', '2025-2026', '2026-03-09', 'VAA-FM-061']);
  assert.strictEqual(draft.metadata.facultyNameNeedsReview, true);   // signature covers the printed name
});

test('faculty name: provenance and measured confidence are recorded, the unreliable read is never trusted', () => {
  const m = draft.metadata;
  assert.strictEqual(m.facultyNameSource, 'printed_text');
  assert.strictEqual(typeof m.facultyNameConfidence, 'number');      // measured for the name line, not the header
  assert.ok(m.facultyNameConfidence < 90);                           // below the trust threshold on this sample
  assert.ok(m.facultyNameCandidates.length >= 2);                    // every read kept for the review screen
  assert.ok(draft.warnings.some(w => w.code === 'faculty-name-needs-review'));
});

test('teaching blocks: same day/start/end as the Percy fixture (merged cells stay ONE record)', () => {
  assert.deepStrictEqual(draft.classes.map(key), percy.classes.map(key));
  const tue = draft.classes.find(b => b.dayOfWeek === 2 && b.startTime === '14:30');
  assert.strictEqual(tue.endTime, '16:00');                          // 3 half-hour rows -> one block
});

test('teaching blocks: subject and room match, or the block is flagged needsReview', () => {
  draft.classes.forEach((b, i) => {
    const want = percy.classes[i];
    const same = norm(b.subject) === norm(want.subject) && norm(b.room) === norm(want.room);
    assert.ok(same || b.needsReview, `${key(b)} differs from the fixture and is not flagged: ${b.subject} | ${b.room}`);
  });
  const exact = draft.classes.filter((b, i) => norm(b.subject) === norm(percy.classes[i].subject) && norm(b.room) === norm(percy.classes[i].room)).length;
  assert.strictEqual(exact, 14);                                     // measured on this sample: all 14 exact (earlier versions misread one room, flagged)
});

test('consultation hours are separated from classes and match the fixture', () => {
  const want = percy.hours.map(key).sort();
  assert.deepStrictEqual(draft.consultationHours.map(key).sort(), want);
  assert.ok(draft.classes.every(c => !/consult/i.test(c.subject)));
});

test('workload cross-check reconciles (15 teaching hours = 6 lecture + 9 laboratory)', () => {
  assert.strictEqual(draft.workload.extractedTeachingHours, 15);
  assert.strictEqual(draft.workload.reconciles, true);
});

test('every extracted block passes the existing class validation, so nothing invalid reaches review unflagged', () => {
  const ok = [];
  for (const b of draft.classes) {
    const r = validateClassBlock({ dayOfWeek: b.dayOfWeek, subject: b.subject, room: b.room, startTime: b.startTime, endTime: b.endTime }, ok);
    assert.ok(!r.error, `${key(b)}: ${r.error}`);
    ok.push(b);
  }
});

// ---- Second sheet: Fortaleza (ronnie), a different print of the same form: 25 rows with uneven heights, a page-edge shadow,
// three printed lines per cell, small blurry print and handwritten hour counts scribbled in the cells and bottom rows. ----
const fort = require('../../ocr/fixtures/fortaleza.extracted.json');
const fortaleza = DEMO_FACULTY_SCHEDULES.find(f => f.key === 'fortaleza');
const sortKey = (a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime);
const looseNorm = s => String(s || '').toUpperCase().replace(/IICT/g, 'ICT').replace(/[^A-Z0-9]/g, '');

test('Fortaleza: the sheet is recognised and every class has the exact day, start and end of the fixture', () => {
  assert.strictEqual(fort.status, 'DRAFT_NEEDS_REVIEW');
  const want = fortaleza.classes.slice().sort(sortKey);
  assert.deepStrictEqual(fort.classes.map(key), want.map(key));
  assert.strictEqual(fort.consultationHours.length, 0);              // this sheet prints no consultation block
});

test('Fortaleza: header and workload are read, and the extracted hours reconcile with the sheet (29 = 16 lecture + 13 laboratory)', () => {
  assert.deepStrictEqual([fort.metadata.term, fort.metadata.academicYear, fort.metadata.effectivityDate], ['Second Semester', '2025-2026', '2026-02-02']);
  assert.deepStrictEqual([fort.workload.lectureHours, fort.workload.laboratoryHours, fort.workload.totalHours], [16, 13, 29]);
  assert.strictEqual(fort.workload.extractedTeachingHours, 29);
  assert.strictEqual(fort.workload.reconciles, true);
  assert.strictEqual(fort.metadata.facultyNameNeedsReview, true);    // a signature runs through the name here too
});

test('Fortaleza: handwriting and the extra 7:00 PM row never become classes, and the left-out marks are reported', () => {
  assert.strictEqual(fort.classes.length, 19);
  assert.ok(fort.classes.every(c => c.endTime <= '19:00'));
  assert.ok(fort.warnings.some(w => w.code === 'ignored-marks'));
  assert.ok(fort.warnings.some(w => w.code === 'rows-after-7pm'));
});

test('Fortaleza: the small print is often misread, but EVERY wrong subject or room is flagged for review (no silent errors)', () => {
  const want = fortaleza.classes.slice().sort(sortKey);
  let wrong = 0;
  fort.classes.forEach((b, i) => {
    const same = looseNorm(b.subject) === looseNorm(want[i].subject) && looseNorm(b.room) === looseNorm(want[i].room);
    if (!same) { wrong++; assert.ok(b.needsReview, `${key(b)} is wrong and not flagged: ${b.subject} | ${b.room}`); }
  });
  assert.ok(wrong > 0 && wrong < fort.classes.length);               // documents the real limit: not all cells are readable on this scan
});

test('Fortaleza: every extracted block passes the existing class validation', () => {
  const ok = [];
  for (const b of fort.classes) {
    const r = validateClassBlock({ dayOfWeek: b.dayOfWeek, subject: b.subject, room: b.room || 'x', startTime: b.startTime, endTime: b.endTime }, ok);
    assert.ok(!r.error, `${key(b)}: ${r.error}`);
    ok.push(b);
  }
});
