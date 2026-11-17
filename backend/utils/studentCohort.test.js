const test = require('node:test');
const assert = require('node:assert/strict');
const { isValidCohort, cohortLabel } = require('./studentCohort');

test('accepts real program, year and section combinations', () => {
  assert.equal(isValidCohort('BS INFO', 3, 'A'), true);
  assert.equal(isValidCohort('BS INFO', '1', 'E'), true);
  assert.equal(isValidCohort('BLIS', '4', 'B'), true);
});

test('rejects sections and years that do not exist', () => {
  assert.equal(isValidCohort('BS INFO', 2, 'E'), false);   // only year 1 has section E
  assert.equal(isValidCohort('BS COMSCI', 1, 'C'), false);
  assert.equal(isValidCohort('BS INFO', 5, 'A'), false);
  assert.equal(isValidCohort('BSIT', 1, 'A'), false);
  assert.equal(isValidCohort('BS INFO', 1, 'AB'), false);  // one letter only
  assert.equal(isValidCohort('BS INFO', 1, ''), false);
  assert.equal(isValidCohort('constructor', 1, 'A'), false);
  assert.equal(isValidCohort(undefined, 1, 'A'), false);
});

test('label matches the stored format', () => {
  assert.equal(cohortLabel('BS INFO', '3', 'A'), 'BS INFO 3A');
});
