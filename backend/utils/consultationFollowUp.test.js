const test = require('node:test');
const assert = require('node:assert');
const t = require('./appointmentTime');
const followUps = require('../jobs/missedAppointments');

// A 60-minute consultation on Tue 2026-11-10 at 10:00 Manila time: it ends at 11:00.
const at = (hhmm, date = '2026-11-10') => new Date(`${date}T${hhmm}:00+08:00`).getTime();
const base = { date: '2026-11-10', time: '10:00', duration: 60, status: 'APPROVED' };

test('the settings: confirm at 15 minutes, missed at 30, counted from the end of the booked time', () => {
  assert.strictEqual(t.COMPLETION_PROMPT_MINUTES, 15);
  assert.strictEqual(t.MISSED_AFTER_MINUTES, 30);
  assert.strictEqual(t.FOLLOW_UP_FROM, 'end');
});

test('counted from the end: nothing before 15 minutes, a prompt from 15, missed from 30', () => {
  const a = (hhmm) => t.followUpAction(base, at(hhmm));
  assert.strictEqual(a('09:00'), null);   // before the consultation
  assert.strictEqual(a('10:30'), null);   // in the middle of it: never missed while it is going on
  assert.strictEqual(a('11:00'), null);   // it just ended
  assert.strictEqual(a('11:14'), null);
  assert.strictEqual(a('11:15'), 'PROMPT');
  assert.strictEqual(a('11:29'), 'PROMPT');
  assert.strictEqual(a('11:30'), 'MISSED');
  assert.strictEqual(a('18:00'), 'MISSED');
});

test('counted from the start (the alternative setting): prompt at 10:15, missed at 10:30', () => {
  const a = (hhmm) => t.followUpAction(base, at(hhmm), 'start');
  assert.strictEqual(a('10:14'), null);
  assert.strictEqual(a('10:15'), 'PROMPT');
  assert.strictEqual(a('10:29'), 'PROMPT');
  assert.strictEqual(a('10:30'), 'MISSED');
});

test('the length of the consultation moves the end: 30 minutes and 2 hours, and 60 when it is missing', () => {
  assert.strictEqual(t.followUpAction({ ...base, duration: 30 }, at('10:44')), null);
  assert.strictEqual(t.followUpAction({ ...base, duration: 30 }, at('10:45')), 'PROMPT');
  assert.strictEqual(t.followUpAction({ ...base, duration: 120 }, at('12:14')), null);
  assert.strictEqual(t.followUpAction({ ...base, duration: 120 }, at('12:15')), 'PROMPT');
  for (const duration of [undefined, 0, null]) assert.strictEqual(t.followUpAction({ ...base, duration }, at('11:15')), 'PROMPT', String(duration));
});

test('only APPROVED consultations get a follow-up', () => {
  for (const status of ['PENDING', 'REJECTED', 'COMPLETED', 'CANCELLED BY STUDENT', 'CANCELLED BY FACULTY', 'MISSED (STUDENT)', 'MISSED (FACULTY)']) {
    assert.strictEqual(t.followUpAction({ ...base, status }, at('11:20')), null, status);
    assert.strictEqual(t.followUpAction({ ...base, status }, at('12:00')), null, status);
  }
  assert.strictEqual(t.followUpAction(null, at('11:20')), null);
});

test('a prompt already sent is not sent again, but the missed step still happens', () => {
  const sent = { ...base, completionPromptSent: true };
  assert.strictEqual(t.followUpAction(sent, at('11:20')), null);
  assert.strictEqual(t.followUpAction(sent, at('11:30')), 'MISSED');
});

test('if the server was down and both are overdue, only the missed notice is sent (no pointless "confirm" email)', () => {
  assert.strictEqual(t.followUpAction(base, at('14:00')), 'MISSED');
  assert.strictEqual(t.followUpAction({ ...base, date: '2026-11-09' }, at('08:00')), 'MISSED'); // yesterday
});

// ---- the job itself, run with fakes (no database) ----
function fakes(appointments) {
  const store = appointments.map(a => ({ ...a }));
  const sent = [];
  const deps = {
    Appointment: {
      find: async (f) => store.filter(a => a.status === f.status && a.date <= f.date.$lte).map(a => ({ ...a })),
      findOneAndUpdate: async (f, u) => {
        const hit = store.find(a => a._id === f._id && (f.status === undefined || a.status === f.status)
          && (!f.completionPromptSent || !(f.completionPromptSent.$ne === true && a.completionPromptSent === true)));
        if (!hit) return null;
        Object.assign(hit, u.$set);
        return { ...hit };
      },
    },
    User: { findById: () => ({ select: async () => ({ name: 'Prof. Cruz' }) }) },
    notify: async (userId, payload) => { sent.push({ userId, ...payload }); },
    resolveStudentId: async (apt) => apt.studentId,
    manilaNow: (d) => ({ dateStr: new Date(d.getTime() + 8 * 3600e3).toISOString().slice(0, 10) }),
  };
  return { store, sent, deps };
}
const apt = (over = {}) => ({ _id: 'a1', ...base, studentId: 'stu1', facultyId: 'fac1', studentName: 'Maria Santos', studentSection: 'BS INFO 4D', ...over });

test('job, 15 minutes after: both people get the confirmation, the status is unchanged, and it is sent only once', async () => {
  const { store, sent, deps } = fakes([apt()]);
  assert.deepStrictEqual(await followUps.runFollowUps(at('11:15'), deps), { prompted: 1, missed: 0 });
  assert.deepStrictEqual(sent.map(s => s.userId), ['fac1', 'stu1']);
  assert.match(sent[0].title, /Confirm your consultation with Maria Santos/);
  assert.match(sent[0].message, /Consultation Log/);
  assert.match(sent[0].message, /15 minutes/);
  assert.match(sent[1].message, /Prof\. Cruz/);
  assert.strictEqual(sent[0].appointmentId, 'a1');
  assert.strictEqual(store[0].status, 'APPROVED');
  assert.strictEqual(store[0].completionPromptSent, true);
  assert.deepStrictEqual(await followUps.runFollowUps(at('11:16'), deps), { prompted: 0, missed: 0 });
  assert.strictEqual(sent.length, 2); // nothing new
});

test('job, 30 minutes after and still unconfirmed: marked missed and both people are told', async () => {
  const { store, sent, deps } = fakes([apt({ completionPromptSent: true })]);
  assert.deepStrictEqual(await followUps.runFollowUps(at('11:30'), deps), { prompted: 0, missed: 1 });
  assert.strictEqual(store[0].status, 'MISSED (FACULTY)');
  assert.ok(store[0].missedAt instanceof Date);
  assert.deepStrictEqual(sent.map(s => s.userId), ['fac1', 'stu1']);
  assert.match(sent[0].title, /not signed off/);
  assert.match(sent[0].message, /still log it/);
  assert.match(sent[1].title, /not held/);
  assert.deepStrictEqual(await followUps.runFollowUps(at('11:31'), deps), { prompted: 0, missed: 0 }); // never twice
});

test('job, the whole story: prompt at 11:15, then missed at 11:30, four emails in total', async () => {
  const { sent, deps } = fakes([apt()]);
  await followUps.runFollowUps(at('11:14'), deps);
  assert.strictEqual(sent.length, 0);
  await followUps.runFollowUps(at('11:15'), deps);
  assert.strictEqual(sent.length, 2);
  await followUps.runFollowUps(at('11:30'), deps);
  assert.strictEqual(sent.length, 4);
});

test('job: a consultation signed off in time is left alone', async () => {
  const { sent, deps } = fakes([apt({ status: 'COMPLETED' }), apt({ _id: 'a2', status: 'MISSED (STUDENT)' })]);
  assert.deepStrictEqual(await followUps.runFollowUps(at('11:45'), deps), { prompted: 0, missed: 0 });
  assert.strictEqual(sent.length, 0);
});

test('job: a sign-off a moment before the job writes is never overwritten', async () => {
  const { store, sent, deps } = fakes([apt()]);
  const realFind = deps.Appointment.find;
  deps.Appointment.find = async (f) => { const rows = await realFind(f); store[0].status = 'COMPLETED'; return rows; }; // signed off right after the list was read
  assert.deepStrictEqual(await followUps.runFollowUps(at('11:30'), deps), { prompted: 0, missed: 0 });
  assert.strictEqual(store[0].status, 'COMPLETED');
  assert.strictEqual(sent.length, 0);
});

test('job: one failing record never stops the others', async () => {
  const { sent, deps } = fakes([apt({ _id: 'bad', facultyId: 'boom' }), apt({ _id: 'good', facultyId: 'fac2', studentId: 'stu2' })]);
  const realNotify = deps.notify;
  deps.notify = async (userId, p) => { if (userId === 'boom') throw new Error('mailbox exploded'); return realNotify(userId, p); };
  const origError = console.error; console.error = () => {};
  try { assert.deepStrictEqual(await followUps.runFollowUps(at('11:15'), deps), { prompted: 1, missed: 0 }); } finally { console.error = origError; }
  assert.deepStrictEqual(sent.map(s => s.userId), ['fac2', 'stu2']);
});

test('job: a consultation from an earlier day is marked missed at once', async () => {
  const { store, deps } = fakes([apt({ date: '2026-11-09' })]);
  assert.deepStrictEqual(await followUps.runFollowUps(at('08:00'), deps), { prompted: 0, missed: 1 });
  assert.strictEqual(store[0].status, 'MISSED (FACULTY)');
});
