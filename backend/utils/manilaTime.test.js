const test = require('node:test');
const assert = require('node:assert/strict');
const { formatManilaDateTime } = require('./manilaTime');

test('formats CSV timestamps in Manila time and rolls the date over from UTC', () => {
  assert.equal(formatManilaDateTime(new Date('2026-11-27T18:51:46.000Z')), '2026-11-28 02:51:46');
});

test('returns an empty cell for missing or invalid timestamps', () => {
  assert.equal(formatManilaDateTime(null), '');
  assert.equal(formatManilaDateTime('not a date'), '');
});
