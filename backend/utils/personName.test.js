const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePersonName } = require('./personName');

test('normalizes word capitalization and spacing while preserving full middle names', () => {
  assert.equal(normalizePersonName('  jOhN   michael smith  '), 'John Michael Smith');
});

test('capitalizes hyphenated, apostrophe-separated, and initial words', () => {
  assert.equal(normalizePersonName("mARY-jANE o'neil j. r. smith"), "Mary-Jane O'Neil J. R. Smith");
});

test('handles empty and whitespace-only input', () => {
  assert.equal(normalizePersonName('   '), '');
});
