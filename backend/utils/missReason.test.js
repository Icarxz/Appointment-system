const test = require('node:test');
const assert = require('node:assert');
const { cleanReason, MAX_REASON, REASON_NOT_SIGNED_OFF, MISSED_BY } = require('./missReason');

test('cleanReason trims, caps at 300 characters, and treats nothing as empty', () => {
  assert.strictEqual(cleanReason('  Did not arrive  '), 'Did not arrive');
  assert.strictEqual(cleanReason(undefined), '');
  assert.strictEqual(cleanReason(null), '');
  assert.strictEqual(cleanReason('   '), '');
  assert.strictEqual(cleanReason('x'.repeat(500)).length, MAX_REASON);
});

test('the system reason and the three markers are fixed', () => {
  assert.ok(/not signed off/i.test(REASON_NOT_SIGNED_OFF));
  assert.deepStrictEqual(Object.values(MISSED_BY).sort(), ['FACULTY', 'STUDENT', 'SYSTEM']);
});
