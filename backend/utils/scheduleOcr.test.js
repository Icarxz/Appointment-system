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
  assert.strictEqual(draft.metadata.facultyNameNeedsReview, true);   // signatures overlap the name line
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
  assert.ok(exact >= 13, `only ${exact}/14 exact`);                  // measured 13/14 on this single sample; the 14th is flagged
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
