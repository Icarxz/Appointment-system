const test = require('node:test');
const assert = require('node:assert');
const { validateId } = require('./idValidator');

test('accepts both student formats', () => {
  assert.ok(validateId('2025-S00001', 'STUDENT').ok);
  assert.ok(validateId('2025-1234-a', 'STUDENT').ok); // lowercase is normalised
});
test('accepts employee format', () => assert.ok(validateId('2025S-00001', 'EMPLOYEE').ok));
test('allows IDs from the current year and earlier', () => {
  for (const id of ['2026-S00001', '2025-1234-A']) {
    assert.ok(validateId(id, 'STUDENT', 2026).ok);
  }
  assert.ok(validateId('2026S-00001', 'EMPLOYEE', 2026).ok);
  assert.ok(validateId('2027-S00001', 'STUDENT', 2027).ok);
  assert.ok(validateId('2027S-00001', 'EMPLOYEE', 2027).ok);
});
test('rejects IDs from a future year and reports the current limit', () => {
  for (const [id, kind] of [['2027-S00001', 'STUDENT'], ['2027S-00001', 'EMPLOYEE']]) {
    const result = validateId(id, kind, 2026);
    assert.ok(!result.ok);
    assert.match(result.error, /2026 or earlier/);
  }
});
test('rejects employee ID typed as student and vice versa', () => {
  assert.ok(!validateId('2025S-00001', 'STUDENT').ok);
  assert.ok(!validateId('2025-S00001', 'EMPLOYEE').ok);
});
test('rejects empty and malformed IDs', () => {
  assert.ok(!validateId('', 'STUDENT').ok);
  assert.ok(!validateId('2025-S0001', 'STUDENT').ok);
  assert.ok(!validateId('UA-COSFM-2022-1234', 'EMPLOYEE').ok);
});
