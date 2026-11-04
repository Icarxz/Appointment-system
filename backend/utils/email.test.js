const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mailer = require('./mailer');
const { sendEmailCopies } = require('./emailDispatch');

// No real email is ever sent here: a fake transport records what would have been sent.
const KEYS = ['EMAIL_USER', 'EMAIL_APP_PASSWORD', 'EMAIL_HOST', 'EMAIL_PORT', 'EMAIL_SECURE', 'EMAIL_NOTIFICATIONS', 'FRONTEND_URL', 'NODE_ENV'];
function withEnv(env, fn) {
  const saved = {};
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  Object.assign(process.env, env);
  return Promise.resolve().then(fn).finally(() => {
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    mailer._setTransportForTests(undefined);
  });
}
const fake = (over = {}) => {
  const calls = [];
  return { calls, sendMail: async (m) => { calls.push(m); return { messageId: 'id-1' }; }, verify: async () => true, ...over };
};
const OK_ENV = { EMAIL_USER: 'sender@gmail.com', EMAIL_APP_PASSWORD: 'abcd efgh ijkl mnop', FRONTEND_URL: 'https://consult.example.edu' };
const ID = '65f1c2a3b4d5e6f708192a3b';

test('REGRESSION: server.js loads .env before anything that needs it', () => {
  // The mailer used to read its settings when first loaded, and server.js loaded it (through the cron jobs)
  // before dotenv ran, so no email was ever sent. dotenv must be the first require.
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const firstRequire = src.split('\n').find((l) => /\brequire\(/.test(l) && !l.trim().startsWith('//'));
  assert.match(firstRequire, /require\('dotenv'\)\.config\(\)/);
});

test('mail settings are read when sending, so a .env loaded after this file still counts', () => withEnv({}, () => {
  assert.equal(mailer.mailerStatus().configured, false);   // nothing set yet
  process.env.EMAIL_USER = 'sender@gmail.com';             // ...dotenv runs later...
  process.env.EMAIL_APP_PASSWORD = 'abcdefghijklmnop';
  assert.equal(mailer.mailerStatus().configured, true);    // ...and the mailer notices
}));

test('settings: Gmail defaults, spaces in the app password are ignored, and the password is never exposed', () => withEnv(OK_ENV, () => {
  const st = mailer.mailerStatus();
  assert.deepEqual([st.host, st.port, st.secure], ['smtp.gmail.com', 465, true]);
  assert.equal(st.passwordLength, 16);
  assert.ok(!JSON.stringify(st).includes('abcd'));
}));

test('settings: port 587 defaults to STARTTLS, and host/port/secure can be overridden', () => withEnv({ ...OK_ENV, EMAIL_PORT: '587' }, () => {
  assert.equal(mailer.mailerStatus().secure, false);
  process.env.EMAIL_SECURE = 'true'; process.env.EMAIL_HOST = 'smtp.example.edu';
  assert.deepEqual([mailer.mailerStatus().host, mailer.mailerStatus().secure], ['smtp.example.edu', true]);
}));

test('with no credentials nothing is sent and nothing throws; local runs report a preview', () => withEnv({}, async () => {
  const log = console.log; const warn = console.warn; console.log = () => {}; console.warn = () => {};
  try {
    assert.deepEqual(await mailer.sendMail({ to: 'a@b.c', subject: 's', html: '<p>x</p>' }), { preview: true });
    process.env.NODE_ENV = 'production';
    assert.deepEqual(await mailer.sendMail({ to: 'a@b.c', subject: 's', html: '<p>x</p>' }), { preview: false });
  } finally { console.log = log; console.warn = warn; }
}));

test('a send goes out with the sender name, recipient, subject, html and a plain-text twin', () => withEnv(OK_ENV, async () => {
  const t = fake(); mailer._setTransportForTests(t);
  const r = await mailer.sendNotificationEmail('student@antiquespride.edu.ph', { type: 'APPOINTMENT_UPDATE', title: 'Consultation approved', message: 'Your request was approved.', link: `/student-dashboard?page=requests&apt=${ID}` });
  assert.equal(r.preview, false);
  const m = t.calls[0];
  assert.equal(m.from, '"CCIS Sync" <sender@gmail.com>');
  assert.equal(m.to, 'student@antiquespride.edu.ph');
  assert.equal(m.subject, 'CCIS Sync: Consultation approved');
  assert.ok(m.html.includes(`href="https://consult.example.edu/student-dashboard?page=requests&amp;apt=${ID}"`) || m.html.includes(`https://consult.example.edu/student-dashboard?page=requests&amp;apt=${ID}`));
  assert.ok(m.html.includes('View in CCIS Sync'));
  assert.ok(m.text.includes('Your request was approved.') && m.text.includes(`https://consult.example.edu/student-dashboard?page=requests&apt=${ID}`));
}));

// The events in the handoff, with the titles the app really uses. Every one is the same email shape.
const SCENARIOS = [
  ['request created (to faculty)', 'APPOINTMENT_REQUEST', 'New consultation request'],
  ['approved (to student)', 'APPOINTMENT_UPDATE', 'Consultation approved'],
  ['declined (to student)', 'APPOINTMENT_UPDATE', 'Consultation declined'],
  ['expired (to student)', 'APPOINTMENT_UPDATE', 'Consultation request expired'],
  ['30-minute reminder (to student)', 'CONSULTATION_UPCOMING', 'Your consultation starts in 30 minutes'],
  ['30-minute reminder (to faculty)', 'CONSULTATION_UPCOMING', 'Upcoming consultation in 30 minutes'],
  ['bulk cancel (to faculty)', 'APPOINTMENT_UPDATE', 'Consultation cancelled by student'],
  ['bulk cancel (to student)', 'APPOINTMENT_UPDATE', 'Consultation cancelled'],
  ['Dean broadcast', 'DEAN_BROADCAST', "Dean's Office: Enrollment reminder"],
];
for (const [name, type, title] of SCENARIOS) {
  test(`email shape: ${name}`, () => withEnv(OK_ENV, async () => {
    const t = fake(); mailer._setTransportForTests(t);
    await mailer.sendNotificationEmail('x@antiquespride.edu.ph', { type, title, message: 'Details here.', link: type === 'DEAN_BROADCAST' ? null : `/faculty-dashboard?page=requests&apt=${ID}` });
    const m = t.calls[0];
    assert.equal(m.subject, `CCIS Sync: ${title}`);
    assert.ok(m.html.includes('Details here.') && m.text.includes('Details here.'));
    assert.ok(m.html.includes(type === 'DEAN_BROADCAST' ? 'Open CCIS Sync' : 'View in CCIS Sync'));
  }));
}

test('typed text cannot inject HTML into an email (names, reasons, broadcasts)', () => withEnv(OK_ENV, async () => {
  const t = fake(); mailer._setTransportForTests(t);
  await mailer.sendNotificationEmail('x@a.b', { type: 'APPOINTMENT_REQUEST', title: '<b>hi</b>', message: `<script>alert("x")</script> & 'quote'`, link: null });
  const html = t.calls[0].html;
  assert.ok(!html.includes('<script>') && !html.includes('<b>hi</b>'));
  assert.ok(html.includes('&lt;script&gt;') && html.includes('&amp;') && html.includes('&#39;quote&#39;'));
}));

test('an unsafe link never reaches an email: it falls back to the app home page', () => withEnv(OK_ENV, async () => {
  const t = fake(); mailer._setTransportForTests(t);
  await mailer.sendNotificationEmail('x@a.b', { type: 'X', title: 't', message: 'm', link: 'https://evil.example/phish' });
  assert.ok(!t.calls[0].html.includes('evil.example') && !t.calls[0].text.includes('evil.example'));
  assert.ok(t.calls[0].text.includes('https://consult.example.edu'));
}));

test('errors explain themselves: wrong password, unreachable server', () => withEnv(OK_ENV, async () => {
  mailer._setTransportForTests(fake({ sendMail: async () => { const e = new Error('Invalid login: 535-5.7.8 Username and Password not accepted'); e.code = 'EAUTH'; throw e; } }));
  await assert.rejects(() => mailer.sendMail({ to: 'a@b.c', subject: 's', html: 'h' }), (e) => e.code === 'EAUTH' && /App Password/.test(e.message) && /sender@gmail\.com/.test(e.message));
  mailer._setTransportForTests(fake({ sendMail: async () => { const e = new Error('connect ETIMEDOUT 142.250.0.0:465'); e.code = 'ETIMEDOUT'; throw e; } }));
  await assert.rejects(() => mailer.sendMail({ to: 'a@b.c', subject: 's', html: 'h' }), (e) => e.code === 'ETIMEDOUT' && /smtp\.gmail\.com:465/.test(e.message) && /587/.test(e.message));
}));

test('verifyMailer: not configured, working, and rejected', () => withEnv({}, async () => {
  const r0 = await mailer.verifyMailer();
  assert.deepEqual([r0.ok, r0.configured], [false, false]);
  process.env.EMAIL_USER = 'sender@gmail.com'; process.env.EMAIL_APP_PASSWORD = 'abcdefghijklmnop';
  mailer._setTransportForTests(fake());
  assert.deepEqual(await mailer.verifyMailer(), { ok: true, configured: true });
  mailer._setTransportForTests(fake({ verify: async () => { const e = new Error('Invalid login'); e.code = 'EAUTH'; throw e; } }));
  const bad = await mailer.verifyMailer();
  assert.equal(bad.ok, false); assert.match(bad.reason, /App Password/);
}));

// ---- the dispatch used by notify() ----
const quiet = () => { const lines = []; return { lines, error: (m) => lines.push(['error', m]), warn: (m) => lines.push(['warn', m]) }; };
const docs = [
  { userId: 'u1', type: 'APPOINTMENT_UPDATE', title: 'T1', message: 'm', link: null },
  { userId: 'u2', type: 'APPOINTMENT_UPDATE', title: 'T2', message: 'm', link: null },
  { userId: 'u3', type: 'APPOINTMENT_UPDATE', title: 'T3', message: 'm', link: null },
  { userId: 'u4', type: 'APPOINTMENT_UPDATE', title: 'T4', message: 'm', link: null },
];
const users = new Map([
  ['u1', { email: 'one@a.b', accountStatus: 'ACTIVE' }],
  ['u2', { email: 'two@a.b', accountStatus: 'ACTIVE' }],
  ['u3', { email: 'three@a.b', accountStatus: 'RESTRICTED' }],
  ['u4', { email: '', accountStatus: 'ACTIVE' }],
]);

test('dispatch: emails active people with an address, skips the rest, and keeps going after a failure', async () => {
  const sent = []; const log = quiet();
  const send = async (to, p) => { if (to === 'one@a.b') { const e = new Error('Invalid login'); e.code = 'EAUTH'; throw e; } sent.push([to, p.title]); };
  const r = await sendEmailCopies(docs, users, send, { log });
  assert.deepEqual(r, { sent: 1, failed: 1, skipped: 2 });
  assert.deepEqual(sent, [['two@a.b', 'T2']]);                       // the second person still got theirs
  const err = log.lines.find(([k]) => k === 'error')[1];
  assert.ok(err.includes('one@a.b') && err.includes('T1') && err.includes('EAUTH') && err.includes('Invalid login')); // a failure is never silent
  assert.ok(log.lines.some(([k, m]) => k === 'warn' && m.includes('2 of 4')));
});

test('dispatch: EMAIL_NOTIFICATIONS=off sends nothing', async () => {
  let n = 0;
  const r = await sendEmailCopies(docs, users, async () => { n += 1; }, { enabled: false, log: quiet() });
  assert.equal(n, 0); assert.deepEqual(r, { sent: 0, failed: 0, skipped: 4 });
});

test('dispatch: a Dean broadcast to many people is sent one at a time', async () => {
  const many = Array.from({ length: 5 }, (_, i) => ({ userId: `p${i}`, type: 'DEAN_BROADCAST', title: "Dean's Office: Hi", message: 'm', link: null }));
  const map = new Map(many.map((d, i) => [d.userId, { email: `p${i}@a.b`, accountStatus: 'ACTIVE' }]));
  let running = 0, peak = 0;
  const r = await sendEmailCopies(many, map, async () => { running += 1; peak = Math.max(peak, running); await new Promise((res) => setImmediate(res)); running -= 1; }, { log: quiet() });
  assert.equal(r.sent, 5); assert.equal(peak, 1);
});
