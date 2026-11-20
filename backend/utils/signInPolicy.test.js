const test = require('node:test');
const assert = require('node:assert');
const { decideSignIn, isProfileComplete, parseList } = require('./signInPolicy');

const base = { allowedDomains: ['school.edu.ph'], adminEmails: ['boss@school.edu.ph'], existingUser: null, rosterRole: null };
const ok = (email) => ({ email, email_verified: true });

test('rejects unverified email', () => {
  assert.strictEqual(decideSignIn({ ...base, payload: { email: 'a@school.edu.ph', email_verified: false } }).action, 'DENY');
});
test('rejects other domains', () => {
  assert.strictEqual(decideSignIn({ ...base, payload: ok('a@gmail.com') }).action, 'DENY');
});
test('rejects lookalike domain', () => {
  assert.strictEqual(decideSignIn({ ...base, payload: ok('a@evil-school.edu.ph') }).action, 'DENY');
});
test('unknown school email becomes STUDENT', () => {
  assert.deepStrictEqual(decideSignIn({ ...base, payload: ok('a@school.edu.ph') }), { action: 'CREATE', role: 'STUDENT' });
});
test('roster gives faculty role', () => {
  assert.strictEqual(decideSignIn({ ...base, payload: ok('f@school.edu.ph'), rosterRole: 'FACULTY' }).role, 'FACULTY');
});
test('ADMIN_EMAILS bootstrap wins', () => {
  assert.strictEqual(decideSignIn({ ...base, payload: ok('Boss@school.edu.ph'), rosterRole: 'FACULTY' }).role, 'ADMIN');
});
test('existing active user logs in', () => {
  assert.strictEqual(decideSignIn({ ...base, payload: ok('a@school.edu.ph'), existingUser: { accountStatus: 'ACTIVE' } }).action, 'LOGIN');
});
test('archived user denied', () => {
  assert.strictEqual(decideSignIn({ ...base, payload: ok('a@school.edu.ph'), existingUser: { accountStatus: 'ARCHIVED' } }).action, 'DENY');
});
test('restricted and pending-approval users denied, a new student is still created', () => {
  for (const accountStatus of ['RESTRICTED', 'PENDING_APPROVAL']) {
    assert.strictEqual(decideSignIn({ ...base, payload: ok('a@school.edu.ph'), existingUser: { accountStatus } }).action, 'DENY');
  }
  const created = decideSignIn({ ...base, payload: ok('new@school.edu.ph'), existingUser: null, rosterRole: null });
  assert.deepStrictEqual([created.action, created.role], ['CREATE', 'STUDENT']);
});
test('no domain configured denies everyone', () => {
  assert.strictEqual(decideSignIn({ ...base, allowedDomains: [], payload: ok('a@school.edu.ph') }).action, 'DENY');
});

test('profile completeness', () => {
  assert.ok(isProfileComplete({ role: 'STUDENT', schoolId: '2025-S00001' }));
  assert.ok(!isProfileComplete({ role: 'STUDENT', schoolId: undefined }));        // legacy "no ID yet"
  assert.ok(!isProfileComplete({ role: 'STUDENT', schoolId: 'X', onboardingComplete: false }));
  assert.ok(isProfileComplete({ role: 'ADMIN' }));
});

test('ADMIN_EMAILS promotes an existing non-admin account', () => {
  const d = decideSignIn({ ...base, payload: ok('boss@school.edu.ph'), existingUser: { role: 'STUDENT', accountStatus: 'ACTIVE' } });
  assert.deepStrictEqual(d, { action: 'LOGIN', promoteTo: 'ADMIN' });
});
test('parseList ignores angle brackets, quotes and spaces', () => {
  assert.deepStrictEqual(parseList('<A@x.ph>, "b@x.ph" ,'), ['a@x.ph', 'b@x.ph']);
});

test('wrong-tab check: student vs faculty & staff', () => {
  const { audienceMismatch } = require('./signInPolicy');
  assert.strictEqual(audienceMismatch('STUDENT', 'STUDENT'), null);
  assert.strictEqual(audienceMismatch('STAFF', 'FACULTY'), null);
  assert.strictEqual(audienceMismatch('STAFF', 'DEAN'), null);
  assert.strictEqual(audienceMismatch('STAFF', 'ADMIN'), null);
  assert.match(audienceMismatch('STUDENT', 'FACULTY'), /Faculty & Staff tab/);
  assert.match(audienceMismatch('STAFF', 'STUDENT'), /Student tab/);
  assert.match(audienceMismatch('STAFF', 'STUDENT', true), /not registered as faculty/);
  assert.strictEqual(audienceMismatch(undefined, 'STUDENT'), null); // older clients: no check
});
