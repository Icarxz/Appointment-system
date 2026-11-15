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

// ---- Third sheet: Silva (sarah mae), another print of the same form: a left-edge shadow that is SHORTER than the table (so the "longer than
// typical" rule of the Fortaleza fix missed it), a sheet that stops at 5:30 PM (21 rows), titles that wrap and end in "<section> - <room>",
// handwritten hour counts, a signature across the name. The expected blocks below were read off the scan by eye, not taken from the OCR. ----
const silva = require('../../ocr/fixtures/silva.extracted.json');
const SILVA_CLASSES = [
  [1, '08:30', '10:30', 'BSCS 3B-SE', 'IICT 106'],
  [2, '07:00', '08:30', 'BS INFO 3C', 'IICT 305'], [2, '08:30', '10:00', 'BS INFO 3B', 'IICT 305'], [2, '10:00', '11:30', 'BS INFO 3D', 'IICT 305'], [2, '14:30', '16:00', 'BS INFO 3A', 'IICT 108'],
  [3, '08:00', '09:30', 'BSCS 3A-INS', 'IICT 201'], [3, '09:30', '11:00', 'BSCS 3B-SE', 'IICT 201'], [3, '11:00', '12:00', 'BSCS 3A-INS', 'IICT 106'],
  [4, '07:00', '08:30', 'BS INFO 3C', 'IICT 305'], [4, '08:30', '10:00', 'BS INFO 3B', 'IICT 305'], [4, '10:00', '11:30', 'BS INFO 3D', 'IICT 305'], [4, '14:30', '16:00', 'BS INFO 3A', 'IICT 108'],
  [5, '08:00', '09:30', 'BSCS 3A-INS', 'IICT 201'], [5, '09:30', '11:00', 'BSCS 3B-SE', 'IICT 201'], [5, '11:00', '12:00', 'BSCS 3A-INS', 'IICT 106'],
].map(([dayOfWeek, startTime, endTime, section, room]) => ({ dayOfWeek, startTime, endTime, section, room }));

test('Silva: the sheet is recognised (it used to fail with "found 10 vertical grid lines") and all 15 classes have the exact day, start and end', () => {
  assert.strictEqual(silva.status, 'DRAFT_NEEDS_REVIEW');
  assert.deepStrictEqual(silva.classes.slice().sort(sortKey).map(key), SILVA_CLASSES.slice().sort(sortKey).map(key));
});

test('Silva: the Tuesday and Thursday consultation blocks are read (12:30-2:30 PM, 4 hours in all) and the shorter sheet is accepted', () => {
  assert.deepStrictEqual(silva.consultationHours.map(key).sort(), ['2 12:30-14:30', '4 12:30-14:30']);
  assert.ok(silva.classes.every(c => c.endTime <= '19:00'));
});

test('Silva: header and workload are read, and the extracted hours reconcile with the sheet (22 = 16 lecture + 6 laboratory)', () => {
  assert.deepStrictEqual([silva.metadata.term, silva.metadata.academicYear, silva.metadata.effectivityDate], ['Second Semester', '2025-2026', '2026-02-02']);
  assert.strictEqual(silva.workload.totalHours, 22);
  assert.strictEqual(silva.workload.extractedTeachingHours, 22);
  assert.strictEqual(silva.metadata.facultyNameNeedsReview, true);   // the signature covers the printed name
  assert.ok(silva.warnings.some(w => w.code === 'ignored-marks'));   // handwritten hour counts are left out, never classes
});

test('Silva: sections are read from the "<section> - <room>" line, and EVERY wrong room is flagged for review (no silent errors)', () => {
  const want = SILVA_CLASSES.slice().sort(sortKey);
  silva.classes.slice().sort(sortKey).forEach((b, i) => {
    assert.strictEqual(norm(b.section), want[i].section, `${key(b)} section`);
    if (norm(b.room) !== want[i].room) assert.ok(b.needsReview, `${key(b)} room ${b.room} is wrong and not flagged`);
  });
});

test('Silva: every extracted block passes the existing class validation', () => {
  const ok = [];
  for (const b of silva.classes) {
    const r = validateClassBlock({ dayOfWeek: b.dayOfWeek, subject: b.subject, room: b.room || 'x', startTime: b.startTime, endTime: b.endTime }, ok);
    assert.ok(!r.error, `${key(b)}: ${r.error}`);
    ok.push(b);
  }
});

// ---- Saylo, Niego, Egualan: three more prints that used to fail ("found 3/8 ... labels", "found 8 vertical grid lines", times 30 min off).
// Expected values are in ocrGroundTruth.js (read off the scans by eye). Measured: day/start/end 60/60 exact, consultation blocks exact,
// and not one wrong section or room that is not flagged. ----
const { SAYLO, NIEGO, EGUALAN } = require('./ocrGroundTruth');
const SHEETS = [['Saylo', SAYLO, require('../../ocr/fixtures/saylo.extracted.json')], ['Niego', NIEGO, require('../../ocr/fixtures/niego.extracted.json')], ['Egualan', EGUALAN, require('../../ocr/fixtures/egualan.extracted.json')]];

for (const [name, truth, fx] of SHEETS) {
  test(`${name}: every block has the exact day, start and end, and the consultation hours are exact`, () => {
    assert.strictEqual(fx.status, 'DRAFT_NEEDS_REVIEW');
    assert.deepStrictEqual(fx.classes.map(key).sort(), truth.classes.map(key).sort());
    assert.deepStrictEqual(fx.consultationHours.map(key).sort(), truth.consultation.slice().sort());
  });
  test(`${name}: the time axis is read from the printed labels (first row ${truth.firstRow}, ${truth.rows} rows) and the hours reconcile with the sheet`, () => {
    assert.deepStrictEqual([fx.source.timeAxis.firstRow, fx.source.timeAxis.rows], [truth.firstRow, truth.rows]);
    assert.strictEqual(fx.workload.lectureHours, truth.lecture);
    assert.strictEqual(fx.workload.laboratoryHours, truth.laboratory);
    assert.strictEqual(fx.workload.reconciles, true);
    assert.strictEqual(fx.workload.extractedTeachingHours, truth.total);
    assert.strictEqual(fx.metadata.effectivityDate, truth.effectivity);
    assert.strictEqual(fx.metadata.facultyNameNeedsReview, true);        // a signature covers the printed name on every sheet seen so far
  });
  test(`${name}: every wrong section or room is flagged for review (no silent errors)`, () => {
    const want = Object.fromEntries(truth.classes.map(c => [key(c), c]));
    for (const b of fx.classes) {
      const w = want[key(b)];
      if (looseNorm(b.section) !== looseNorm(w.section) || looseNorm(b.room) !== looseNorm(w.room)) {
        assert.ok(b.needsReview, `${key(b)} reads "${b.section} | ${b.room}", the sheet says "${w.section} | ${w.room}", and it is not flagged`);
      }
    }
  });
  test(`${name}: every extracted block passes the existing class validation`, () => {
    const ok = [];
    for (const b of fx.classes) {
      const r = validateClassBlock({ dayOfWeek: b.dayOfWeek, subject: b.subject, room: b.room || 'x', startTime: b.startTime, endTime: b.endTime }, ok);
      assert.ok(!r.error, `${key(b)}: ${r.error}`);
      ok.push(b);
    }
  });
}

test('Saylo: rows printed after 7 PM are reported, and handwriting in them never becomes a class', () => {
  assert.ok(SHEETS[0][2].warnings.some(w => w.code === 'rows-after-7pm'));
  assert.ok(SHEETS[0][2].classes.every(c => c.endTime <= '19:00'));
});

// ---- The Python itself (skipped where Python or its packages are not installed) ----
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const SCRIPT = path.join(__dirname, '..', '..', 'ocr', 'schedule_ocr.py');
const hasPy = spawnSync('python3', ['-c', 'import cv2, numpy, pytesseract'], { encoding: 'utf8' }).status === 0;
const py = code => {
  const r = spawnSync('python3', ['-W', 'ignore', '-c', `import runpy, json, sys; sys.modules['fitz'] = None\nm = runpy.run_path(${JSON.stringify(SCRIPT)}, run_name='lib')\n${code}`], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};
const labels = (first, n, garbled = []) => Array.from({ length: n }, (_, i) => {   // the printed start of row i, as the label reader would return it
  if (garbled.includes(i)) return [];
  const m = first + 30 * i; const h = Math.floor(m / 60) % 12 || 12;
  return [[h, m % 60]];
});
const axis = (cands) => py(`
try:
    print(json.dumps({'ok': m['vote_time_axis'](${JSON.stringify(cands)})}))
except ValueError as e:
    print(json.dumps({'error': str(e)}))`);

test('time axis: a sheet starting at 7:00 and one starting at 7:30 are both read from the labels', { skip: !hasPy }, () => {
  assert.deepStrictEqual(axis(labels(7 * 60, 24)).ok, [420, 24]);
  assert.deepStrictEqual(axis(labels(7 * 60 + 30, 21)).ok, [450, 21]);        // Egualan: times were 30 minutes early when 7:00 was assumed
});
test('time axis: garbled labels lose the vote, they do not break it', { skip: !hasPy }, () => {
  assert.strictEqual(axis(labels(420, 27, [4, 9, 10, 26])).ok[0], 420);
});
test('time axis: a MISSED ROW LINE (labels shift by one row from the middle on) is refused, never guessed', { skip: !hasPy }, () => {
  // what happened to Saylo under another renderer: the line between rows 2 and 3 was lost, so rows 3.. are one index early
  const shifted = labels(420, 27).map((c, i) => (i >= 2 ? labels(420, 27)[i + 1] || [] : c)).slice(0, 26);
  assert.match(axis(shifted).error, /row line was probably missed/);
});
test('time axis: too few readable labels is refused', { skip: !hasPy }, () => {
  assert.match(axis(labels(420, 24, Array.from({ length: 21 }, (_, i) => i))).error, /could not read the time column/);
});

const cell = text => py(`print(json.dumps(m['parse_teaching'](${JSON.stringify(text)})))`);
test('cell text: room printed BEFORE the section (Niego), wrapped titles and noisy dashes', { skip: !hasPy }, () => {
  let [p] = cell('ICT 1 – ICT FUNDAMENTALS\nIICT 103 (LEC)\nBSCD 1 – A');
  assert.deepStrictEqual([p.section, p.room], ['BSCD 1-A', 'IICT 103 (LEC)']);
  assert.match(p.courseTitle, /FUNDAMENTALS/);
  [p] = cell('CPROG 3 – OBJECT-ORIENTED\nPROGRAMMING\nIICT 303 (LAB)\nBSINFO 2 – D');
  assert.deepStrictEqual([p.section, p.room], ['BSINFO 2-D', 'IICT 303 (LAB)']);
  assert.match(p.courseTitle, /PROGRAMMING/);
  [p] = cell('INFOE 3 (NAS 3) – IT SECURITY\nIICT 306 (LEC)\nBS INFO3~-B A');       // "~-" for the dash, a handwritten mark after
  assert.deepStrictEqual([p.section, p.room], ['BS INFO 3-B', 'IICT 306 (LEC)']);
});
test('cell text: the layouts that already worked still give the same answer', { skip: !hasPy }, () => {
  let [p] = cell('COMPE 6 – Software Engineering 6\nBSCS 4-B IICT 308 (LEC)');               // Egualan: section and room share a line
  assert.deepStrictEqual([p.section, p.room], ['BSCS 4-B', 'IICT 308 (LEC)']);
  [p] = cell('INFOT 6\nSC BSINFO 3-B\nIICT 304 (LAB)');                                       // Saylo: title / section / room
  assert.deepStrictEqual([p.section, p.room], ['SC BSINFO 3-B', 'IICT 304 (LAB)']);
  [p] = cell('COMSC 9 SOFTWARE\nENGINEERING 2\nBSCS 3B-SE – IICT 106');                     // Silva: title wraps, last line "<section> - <room>"
  assert.deepStrictEqual([p.section, p.room], ['BSCS 3B-SE', 'IICT 106']);
});
test('cell text: a title that looks a little like a section is never taken for one, and nothing is invented', { skip: !hasPy }, () => {
  const [p, flags] = cell('ICT 1 – ICT FUNDAMENTALS\nCT 305 (LAB)');                          // no readable room (the I was lost), no section line
  assert.strictEqual(p.section, null);
  assert.strictEqual(p.room, null);
  assert.ok(flags.length > 0);
});
