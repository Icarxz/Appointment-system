const test = require('node:test');
const assert = require('node:assert/strict');
const { buildLink, isSafeLink, emailLink, ROOTS, PAGES } = require('./notifyLink');
const { canViewAppointment } = require('./appointmentAccess');

const ID = '65f1c2a3b4d5e6f708192a3b';

test('buildLink: appointment links go to the right dashboard and page for each role', () => {
  assert.equal(buildLink('STUDENT', { appointmentId: ID }), `/student-dashboard?page=requests&apt=${ID}`);
  assert.equal(buildLink('FACULTY', { appointmentId: ID }), `/faculty-dashboard?page=requests&apt=${ID}`);
  assert.equal(buildLink('DEAN', { appointmentId: ID }), `/dean-dashboard?page=records&apt=${ID}`);
});

test('buildLink: Admin has no mailbox, so no appointment link', () => {
  assert.equal(buildLink('ADMIN', { appointmentId: ID }), null);
});

test('buildLink: page-only links use the allowlisted page names', () => {
  assert.equal(buildLink('FACULTY', { page: 'schedule' }), '/faculty-dashboard?page=schedule');
  assert.equal(buildLink('FACULTY', { page: 'nope' }), null);
  assert.equal(buildLink('STUDENT', { page: 'schedule' }), null); // a faculty page, not a student one
});

test('buildLink: nothing to link to gives null (not a made-up link)', () => {
  assert.equal(buildLink('STUDENT'), null);
  assert.equal(buildLink('STUDENT', {}), null);
  assert.equal(buildLink('UNKNOWN', { appointmentId: ID }), null);
});

test('buildLink: a bad appointment id is refused, never put into a link', () => {
  for (const bad of ['abc', '65f1c2a3b4d5e6f708192a3', `${ID}x`, '../../etc/passwd', `${ID}&x=1`, '<script>', '65F1C2A3B4D5E6F708192A3B']) {
    assert.equal(buildLink('STUDENT', { appointmentId: bad }), null, bad);
  }
});

test('buildLink: accepts an ObjectId-like value by its string form', () => {
  const fake = { toString: () => ID };
  assert.equal(buildLink('STUDENT', { appointmentId: fake }), `/student-dashboard?page=requests&apt=${ID}`);
});

test('isSafeLink: accepts every link buildLink can produce', () => {
  for (const role of Object.keys(ROOTS)) {
    assert.ok(isSafeLink(ROOTS[role]), `${role} root`);
    for (const page of PAGES[role]) assert.ok(isSafeLink(buildLink(role, { page })), `${role} ${page}`);
    const apt = buildLink(role, { appointmentId: ID });
    if (apt) assert.ok(isSafeLink(apt), `${role} appointment`);
  }
});

test('isSafeLink: rejects open-redirect and injection attempts', () => {
  const bad = [
    'https://evil.com', 'http://evil.com/student-dashboard', '//evil.com', '///evil.com', '\\\\evil.com',
    'javascript:alert(1)', 'data:text/html,hi', '', ' /student-dashboard', '/student-dashboard ',
    '/student-dashboard/../admin-dashboard', '/student-dashboard?page=requests&apt=x',
    `/student-dashboard?page=requests&apt=${ID}&redirect=https://evil.com`,
    `/student-dashboard?apt=${ID}`,                       // apt without a page
    `/student-dashboard?page=requests&apt=${ID}#x`,
    `/student-dashboard?page=schedule`,                   // a faculty page on the student dashboard
    `/dean-dashboard?page=appeals&apt=${ID}`,             // the old Faculty Reasons page no longer exists
    `/admin-dashboard?page=home&apt=${ID}`,
    '/Student-Dashboard', '/login', '/', null, undefined, 42, {}, ['/student-dashboard'],
    `/student-dashboard?page=requests&apt=${ID.toUpperCase()}`,
    '/student-dashboard?page=' + 'a'.repeat(200),
  ];
  for (const link of bad) assert.equal(isSafeLink(link), false, String(link));
});

test('emailLink: full address for a safe link, plain app address otherwise', () => {
  const old = process.env.FRONTEND_URL;
  process.env.FRONTEND_URL = 'https://consult.example.edu/, http://localhost:5173';
  try {
    assert.equal(emailLink(`/student-dashboard?page=requests&apt=${ID}`), `https://consult.example.edu/student-dashboard?page=requests&apt=${ID}`);
    assert.equal(emailLink('https://evil.com'), 'https://consult.example.edu');
    assert.equal(emailLink(null), 'https://consult.example.edu');
    delete process.env.FRONTEND_URL;
    assert.equal(emailLink(null), 'http://localhost:5173');
  } finally {
    if (old === undefined) delete process.env.FRONTEND_URL; else process.env.FRONTEND_URL = old;
  }
});

test('canViewAppointment: students see only their own, faculty only theirs, Dean and Admin all', () => {
  const apt = { studentId: 'S1', facultyId: { _id: 'F1', name: 'Prof' } };
  assert.equal(canViewAppointment({ role: 'STUDENT', userId: 'S1' }, apt), true);
  assert.equal(canViewAppointment({ role: 'STUDENT', userId: 'S2' }, apt), false);
  assert.equal(canViewAppointment({ role: 'FACULTY', userId: 'F1' }, apt), true);
  assert.equal(canViewAppointment({ role: 'FACULTY', userId: 'F2' }, apt), false);
  assert.equal(canViewAppointment({ role: 'DEAN', userId: 'D1' }, apt), true);
  assert.equal(canViewAppointment({ role: 'ADMIN', userId: 'A1' }, apt), true);
});

test('canViewAppointment: plain ids work, and missing data is a no', () => {
  assert.equal(canViewAppointment({ role: 'FACULTY', userId: 'F1' }, { facultyId: 'F1' }), true);
  assert.equal(canViewAppointment({ role: 'STUDENT', userId: 'S1' }, { facultyId: 'F1' }), false); // old record without studentId
  assert.equal(canViewAppointment({ role: 'STUDENT', userId: '' }, { studentId: '' }), false);
  assert.equal(canViewAppointment(null, { studentId: 'S1' }), false);
  assert.equal(canViewAppointment({ role: 'STUDENT', userId: 'S1' }, null), false);
  assert.equal(canViewAppointment({ role: 'GUEST', userId: 'S1' }, { studentId: 'S1' }), false);
});
