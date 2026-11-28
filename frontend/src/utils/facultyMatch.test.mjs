import assert from 'node:assert/strict';
import test from 'node:test';
import { needsNameConfirmation } from './facultyMatch.ts';

const faculty = [
  { _id: 'carl', name: 'Carl Spence' },
  { _id: 'carl-percy', name: 'Carl Spence Percy' },
  { _id: 'jane', name: 'Jane Doe' },
];

test('exact filename match does not require confirmation', () => {
  assert.equal(needsNameConfirmation('Carl Spence.pdf', 'carl', faculty), false);
});

test('an ambiguous filename accepts any faculty among its candidates', () => {
  assert.equal(needsNameConfirmation('Carl Spence.pdf', 'carl-percy', faculty), false);
  assert.equal(needsNameConfirmation('Carl Spence.pdf', 'jane', faculty), true);
});

test('an unmatched or misspelled filename requires confirmation for an assigned faculty', () => {
  assert.equal(needsNameConfirmation('Jnae Doe.pdf', 'jane', faculty), true);
  assert.equal(needsNameConfirmation('unknown.pdf', 'jane', faculty), true);
});

test('an unassigned file does not require confirmation', () => {
  assert.equal(needsNameConfirmation('unknown.pdf', '', faculty), false);
});
