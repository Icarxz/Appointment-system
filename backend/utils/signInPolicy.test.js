const test = require('node:test');
const assert = require('node:assert');
const { decideSignIn, isProfileComplete, requiresCredentialConfirmation, parseList } = require('./signInPolicy');

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
test('provisioning flag denies unknown users and does not create a student', () => {
  const denied = decideSignIn({ ...base, payload: ok('unknown@school.edu.ph'), requireProvisionedAccounts: true });
  assert.strictEqual(denied.action, 'DENY');
  assert.match(denied.error, /No account was found/);
});
test('provisioning flag still allows Admin and roster exceptions', () => {
  assert.strictEqual(decideSignIn({ ...base, payload: ok('Boss@school.edu.ph'), requireProvisionedAccounts: true }).role, 'ADMIN');
  assert.strictEqual(decideSignIn({ ...base, payload: ok('f@school.edu.ph'), rosterRole: 'FACULTY', requireProvisionedAccounts: true }).role, 'FACULTY');
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

test('requires first-login credential confirmation only for provisioned incomplete student and staff accounts', () => {
  assert.ok(requiresCredentialConfirmation({
    role: 'STUDENT', schoolId: '2025-S00001', programPosition: 'BS INFO 1A', onboardingComplete: false,
  }));
  for (const role of ['FACULTY', 'DEAN']) {
    assert.ok(requiresCredentialConfirmation({
      role, facultyId: '2025S-00001', programPosition: 'Faculty', onboardingComplete: false,
    }));
  }
  assert.ok(!requiresCredentialConfirmation({ role: 'STUDENT', onboardingComplete: false }));
  assert.ok(!requiresCredentialConfirmation({
    role: 'FACULTY', facultyId: '2025S-00001', programPosition: 'Faculty', onboardingComplete: true,
  }));
  assert.ok(!requiresCredentialConfirmation({
    role: 'FACULTY', facultyId: '2025S-00001', programPosition: 'Faculty',
    onboardingComplete: false, credentialsConfirmedAt: new Date(),
  }));
  assert.ok(!requiresCredentialConfirmation({
    role: 'DEAN', programPosition: 'Dean', onboardingComplete: false,
  }));
  assert.ok(!requiresCredentialConfirmation({
    role: 'ADMIN', programPosition: 'Admin', onboardingComplete: false,
  }));
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
  assert.match(audienceMismatch('STUDENT', 'FACULTY'), /choose Faculty/);
  assert.match(audienceMismatch('STAFF', 'STUDENT'), /choose Student/);
  assert.match(audienceMismatch('STAFF', 'STUDENT', true), /System Administrator/);
  assert.strictEqual(audienceMismatch('LOGIN', 'STUDENT'), null); // Log in: handled by loginNeedsAccount
  assert.match(audienceMismatch('STAFF', 'STUDENT', true), /not registered as faculty/);
  assert.strictEqual(audienceMismatch(undefined, 'STUDENT'), null); // older clients: no check
});

test('Log in never creates a student, but a roster-listed staff first sign-in still works', () => {
  const { loginNeedsAccount } = require('./signInPolicy');
  assert.match(loginNeedsAccount('LOGIN', 'CREATE', 'STUDENT'), /Sign up/);
  assert.strictEqual(loginNeedsAccount('LOGIN', 'CREATE', 'FACULTY'), null); // administrator already listed them
  assert.strictEqual(loginNeedsAccount('LOGIN', 'CREATE', 'ADMIN'), null);   // ADMIN_EMAILS
  assert.strictEqual(loginNeedsAccount('LOGIN', 'LOGIN', 'STUDENT'), null);  // existing account
  assert.strictEqual(loginNeedsAccount('STUDENT', 'CREATE', 'STUDENT'), null); // Sign up > Student creates the account
  assert.strictEqual(loginNeedsAccount(undefined, 'CREATE', 'STUDENT'), null); // older clients unchanged
});
