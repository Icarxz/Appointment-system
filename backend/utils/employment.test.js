const test = require('node:test');
const assert = require('node:assert');
const { EMPLOYMENT_TYPES, isEmploymentType } = require('./employment');

test('the two employment types, and only they are valid', () => {
  assert.deepStrictEqual([...EMPLOYMENT_TYPES], ['Full-time', 'Part-time']);
  EMPLOYMENT_TYPES.forEach(t => assert.ok(isEmploymentType(t)));
  ['', 'full-time', 'Fulltime', 'Part time', 'Contractual', null, undefined, 1, {}, ['Full-time']].forEach(v => assert.strictEqual(isEmploymentType(v), false, String(v)));
});
