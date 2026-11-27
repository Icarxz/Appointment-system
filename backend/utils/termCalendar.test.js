const test = require('node:test');
const assert = require('node:assert/strict');
const { defaultTermForDate, termForDate, validateTerm, matchesTermFilter, isValidDateString } = require('./termCalendar');

test('default calendar: Aug-Dec is the first semester, Jan-Apr the second, May-Jul none', () => {
  assert.deepEqual(defaultTermForDate('2025-08-01'), { academicYear: '2025-2026', name: 'First Semester', source: 'default' });
  assert.equal(defaultTermForDate('2025-12-31').name, 'First Semester');
  assert.deepEqual(defaultTermForDate('2026-01-01'), { academicYear: '2025-2026', name: 'Second Semester', source: 'default' });
  assert.equal(defaultTermForDate('2026-04-30').name, 'Second Semester');
  assert.equal(defaultTermForDate('2026-05-01'), null);
  assert.equal(defaultTermForDate('2026-07-31'), null);
});

test('an Admin-defined term wins over the default and can cover May-Jul', () => {
  const terms = [{ academicYear: '2025-2026', name: 'Summer', startDate: '2026-05-04', endDate: '2026-07-10' }];
  assert.deepEqual(termForDate('2026-06-01', terms), { academicYear: '2025-2026', name: 'Summer', source: 'admin' });
  assert.equal(termForDate('2026-07-20', terms), null);
  const shifted = [{ academicYear: '2025-2026', name: 'First Semester', startDate: '2025-08-18', endDate: '2025-12-19' }];
  assert.equal(termForDate('2025-08-10', shifted).source, 'default');
  assert.equal(termForDate('2025-09-01', shifted).source, 'admin');
});

test('invalid dates give no term', () => {
  assert.equal(isValidDateString('2026-02-30'), false);
  assert.equal(termForDate('2026-02-30'), null);
  assert.equal(termForDate('not a date'), null);
  assert.equal(termForDate(undefined), null);
});

test('validateTerm explains problems in plain words and rejects overlaps', () => {
  assert.equal(validateTerm({ name: '', academicYear: '2025-2026', startDate: '2026-05-01', endDate: '2026-07-01' }).ok, false);
  assert.match(validateTerm({ name: 'Summer', academicYear: '2025-26', startDate: '2026-05-01', endDate: '2026-07-01' }).error, /2025-2026/);
  assert.match(validateTerm({ name: 'Summer', academicYear: '2025-2026', startDate: '2026-07-01', endDate: '2026-05-01' }).error, /before/);
  const existing = [{ name: 'Summer', academicYear: '2025-2026', startDate: '2026-05-04', endDate: '2026-07-10' }];
  const overlap = validateTerm({ name: 'Midyear', academicYear: '2025-2026', startDate: '2026-07-01', endDate: '2026-07-31' }, existing);
  assert.equal(overlap.ok, false);
  assert.match(overlap.error, /overlap/);
  const fine = validateTerm({ name: ' Midyear ', academicYear: '2025-2026', startDate: '2026-07-11', endDate: '2026-07-31' }, existing);
  assert.equal(fine.ok, true);
  assert.equal(fine.value.name, 'Midyear');
});

test('term filter handles all, one year, one semester and "outside a term"', () => {
  const first = { academicYear: '2025-2026', name: 'First Semester' };
  assert.equal(matchesTermFilter(first, {}), true);
  assert.equal(matchesTermFilter(first, { academicYear: '2025-2026', term: 'First Semester' }), true);
  assert.equal(matchesTermFilter(first, { academicYear: '2026-2027' }), false);
  assert.equal(matchesTermFilter(first, { term: 'Second Semester' }), false);
  assert.equal(matchesTermFilter(null, { term: 'NONE' }), true);
  assert.equal(matchesTermFilter(first, { term: 'NONE' }), false);
  assert.equal(matchesTermFilter(null, { academicYear: '2025-2026' }), false);
});
