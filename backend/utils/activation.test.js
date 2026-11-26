const test = require('node:test');
const assert = require('node:assert/strict');
const { activationAtForNewAccount, activationAtForApproval } = require('./activation');

test('new active accounts get one activation time, while pending accounts wait for approval', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  assert.equal(activationAtForNewAccount({ isNew: true, accountStatus: 'ACTIVE', activatedAt: null }, now), now);
  assert.equal(activationAtForNewAccount({ isNew: true, accountStatus: 'PENDING_APPROVAL', activatedAt: null }, now), null);
});

test('approval sets activation once and re-enabling does not rewrite it', () => {
  const now = new Date('2026-01-02T00:00:00.000Z');
  const original = new Date('2026-01-01T00:00:00.000Z');
  assert.equal(activationAtForApproval({ previousStatus: 'PENDING_APPROVAL', currentStatus: 'ACTIVE', activatedAt: null }, now), now);
  assert.equal(activationAtForApproval({ previousStatus: 'RESTRICTED', currentStatus: 'ACTIVE', activatedAt: original }, now), original);
  assert.equal(activationAtForApproval({ previousStatus: 'RESTRICTED', currentStatus: 'ACTIVE', activatedAt: null }, now), null);
});
