const test = require('node:test');
const assert = require('node:assert/strict');
const { isConsultable, consultableFilter } = require('./consultable');

test('faculty are always consultable', () => {
  assert.equal(isConsultable({ role: 'FACULTY' }), true);
});
test('a Dean is consultable only when the switch is on', () => {
  assert.equal(isConsultable({ role: 'DEAN' }), false);
  assert.equal(isConsultable({ role: 'DEAN', acceptsConsultations: false }), false);
  assert.equal(isConsultable({ role: 'DEAN', acceptsConsultations: true }), true);
});
test('students, admins and missing users are never consultable', () => {
  for (const u of [{ role: 'STUDENT' }, { role: 'ADMIN', acceptsConsultations: true }, null, undefined]) assert.equal(isConsultable(u), false);
});
test('filter matches the same rule and keeps extra conditions', () => {
  const f = consultableFilter({ _id: 'x' });
  assert.equal(f._id, 'x');
  assert.deepEqual(f.$or, [{ role: 'FACULTY' }, { role: 'DEAN', acceptsConsultations: true }]);
});
