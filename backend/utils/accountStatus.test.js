const test = require('node:test');
const assert = require('node:assert');
const {
  isDisabledAccountStatus,
  canDisableRole,
  canEnableAccountStatus,
} = require('./accountStatus');

test('restricted and archived accounts are disabled', () => {
  assert.equal(isDisabledAccountStatus('RESTRICTED'), true);
  assert.equal(isDisabledAccountStatus('ARCHIVED'), true);
  assert.equal(isDisabledAccountStatus('ACTIVE'), false);
  assert.equal(isDisabledAccountStatus('PENDING_APPROVAL'), false);
});

test('student, faculty and dean accounts can be disabled', () => {
  assert.equal(canDisableRole('STUDENT'), true);
  assert.equal(canDisableRole('FACULTY'), true);
  assert.equal(canDisableRole('DEAN'), true);
  assert.equal(canDisableRole('ADMIN'), false);
});

test('restricted and archived accounts can be restored', () => {
  assert.equal(canEnableAccountStatus('RESTRICTED'), true);
  assert.equal(canEnableAccountStatus('ARCHIVED'), true);
  assert.equal(canEnableAccountStatus('ACTIVE'), false);
});
