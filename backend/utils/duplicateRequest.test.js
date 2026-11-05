const test = require('node:test');
const assert = require('node:assert/strict');
const { findConflict, normalizeReason } = require('./duplicateRequest');

const NOW = new Date('2026-11-05T10:00:00+08:00').getTime();
const apt = (o) => ({ facultyId: 'F1', date: '2026-11-10', time: '09:00', reason: 'Thesis help', status: 'PENDING', ...o });
const want = (o) => ({ facultyId: 'F1', date: '2026-11-12', time: '14:00', reason: 'thesis help.', ...o });

test('normalizeReason ignores case, punctuation and spacing', () => {
  assert.equal(normalizeReason('  Thesis   HELP! '), 'thesis help');
});
test('same professor, same reason, another day: refused', () => {
  assert.equal(findConflict([apt()], want(), NOW).code, 'SAME_REASON');
});
test('approved upcoming request also blocks', () => {
  assert.equal(findConflict([apt({ status: 'APPROVED' })], want(), NOW).code, 'SAME_REASON');
});
test('same professor, same hour, different reason: allowed', () => {
  assert.equal(findConflict([apt({ date: '2026-11-12', time: '14:00' })], want({ reason: 'Grade question' }), NOW), null);
});
test('different professor, same date and hour: refused', () => {
  assert.equal(findConflict([apt({ facultyId: 'F2', date: '2026-11-12', time: '14:00', reason: 'x' })], want(), NOW).code, 'SAME_TIME');
});
test('different professor, same reason, other time: allowed', () => {
  assert.equal(findConflict([apt({ facultyId: 'F2' })], want(), NOW), null);
});
test('closed or past requests never block', () => {
  for (const status of ['REJECTED', 'COMPLETED', 'CANCELLED BY STUDENT', 'MISSED (STUDENT)']) {
    assert.equal(findConflict([apt({ status })], want(), NOW), null, status);
  }
  assert.equal(findConflict([apt({ date: '2026-11-01' })], want(), NOW), null);
});
test('populated facultyId objects are compared by _id', () => {
  assert.equal(findConflict([apt({ facultyId: { _id: 'F1', name: 'X' } })], want(), NOW).code, 'SAME_REASON');
});
