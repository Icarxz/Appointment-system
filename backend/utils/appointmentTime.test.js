const test = require('node:test');
const assert = require('node:assert');
const t = require('./appointmentTime');

const apt = { status: 'PENDING', date: '2026-11-03', time: '10:00' };
const at = (hhmm) => new Date(`2026-11-03T${hhmm}:00+08:00`).getTime();

test('limits are 1 hour to book / cancel and a 30-minute reminder', () => {
  assert.strictEqual(t.BOOKING_LEAD_HOURS, 1);
  assert.strictEqual(t.CANCEL_CUTOFF_HOURS, 1);
  assert.strictEqual(t.REMINDER_MINUTES, 30);
});

test('a pending request expires exactly when the start time is reached', () => {
  assert.strictEqual(t.isPendingExpired(apt, at('09:59')), false);
  assert.strictEqual(t.isPendingExpired(apt, at('10:00')), true);
  assert.strictEqual(t.isPendingExpired(apt, at('11:30')), true);
  assert.strictEqual(t.isPendingExpired({ ...apt, status: 'APPROVED' }, at('11:30')), false);
});

test('cancel stays open until 1 hour before the start', () => {
  assert.strictEqual(t.canCancel(apt, at('09:00')), true);
  assert.strictEqual(t.canCancel(apt, at('09:01')), false);
  assert.strictEqual(t.canCancel(apt, at('10:00')), false);
});

test('reminder window is the last 30 minutes before the start', () => {
  assert.strictEqual(t.inReminderWindow(apt, at('09:29')), false);
  assert.strictEqual(t.inReminderWindow(apt, at('09:30')), true);
  assert.strictEqual(t.inReminderWindow(apt, at('09:59')), true);
  assert.strictEqual(t.inReminderWindow(apt, at('10:00')), false);
});

// ---- why an unanswered request was rejected ----
const { expiryReason, EXPIRY_REASON_TAKEN, EXPIRY_REASON_NO_RESPONSE } = require('./appointmentTime');
test('expiryReason: another student\'s approved time over the request gives the "accepted" text', () => {
  const apt = { time: '08:00', duration: 60 };
  assert.strictEqual(expiryReason(apt, [{ time: '08:00', duration: 30 }]), EXPIRY_REASON_TAKEN);
  assert.strictEqual(expiryReason(apt, [{ time: '08:45', duration: 60 }]), EXPIRY_REASON_TAKEN);
  assert.strictEqual(expiryReason(apt, [{ time: '07:30', duration: 45 }]), EXPIRY_REASON_TAKEN);
  assert.strictEqual(EXPIRY_REASON_TAKEN, "Another student's request for this time was accepted.");
});
test('expiryReason: nothing overlapping (or only touching) means it simply was not answered', () => {
  const apt = { time: '08:00', duration: 60 };
  assert.strictEqual(expiryReason(apt, []), EXPIRY_REASON_NO_RESPONSE);
  assert.strictEqual(expiryReason(apt), EXPIRY_REASON_NO_RESPONSE);
  assert.strictEqual(expiryReason(apt, [{ time: '09:00', duration: 60 }]), EXPIRY_REASON_NO_RESPONSE);
  assert.strictEqual(expiryReason(apt, [{ time: '07:00', duration: 60 }]), EXPIRY_REASON_NO_RESPONSE);
  assert.strictEqual(expiryReason({ time: '08:00' }, [{ time: '08:50', duration: 30 }]), EXPIRY_REASON_TAKEN); // default length 60
});

// ---- grace period before a miss can be marked ----
test('the grace period is 30 minutes', () => {
  assert.strictEqual(t.MISS_GRACE_MINUTES, 30);
});

test('a miss can be marked only from 30 minutes after the start', () => {
  const approved = { status: 'APPROVED', date: '2026-11-03', time: '10:00' };
  assert.strictEqual(t.canMarkMissed(approved, at('09:00')), false);   // before the start
  assert.strictEqual(t.canMarkMissed(approved, at('10:00')), false);   // at the start
  assert.strictEqual(t.canMarkMissed(approved, at('10:29')), false);   // still in the grace period
  assert.strictEqual(t.canMarkMissed(approved, at('10:30')), true);    // exactly 30 minutes
  assert.strictEqual(t.canMarkMissed(approved, at('13:00')), true);
});

test('missOpensAt is the start plus 30 minutes', () => {
  const opens = t.missOpensAt({ date: '2026-11-03', time: '10:00' });
  assert.strictEqual(opens.getTime(), at('10:30'));
});

// ---- 24-hour correction of a marked miss ----
test('a marked miss can be corrected for 24 hours', () => {
  assert.strictEqual(t.CORRECTION_HOURS, 24);
  const missedAt = new Date('2026-11-03T11:00:00+08:00');
  const missed = { status: 'MISSED (STUDENT)', missedAt };
  assert.strictEqual(t.canCorrectMiss(missed, missedAt.getTime() + 23 * 3600000), true);
  assert.strictEqual(t.canCorrectMiss(missed, missedAt.getTime() + 24 * 3600000), true);
  assert.strictEqual(t.canCorrectMiss(missed, missedAt.getTime() + 24 * 3600000 + 1), false);
  assert.strictEqual(t.canCorrectMiss({ ...missed, status: 'MISSED (FACULTY)' }, missedAt.getTime() + 3600000), true);
});

test('only missed statuses can be corrected; older records use updatedAt', () => {
  const now = new Date('2026-11-03T12:00:00+08:00').getTime();
  assert.strictEqual(t.canCorrectMiss({ status: 'APPROVED', missedAt: new Date(now) }, now), false);
  assert.strictEqual(t.canCorrectMiss({ status: 'COMPLETED', missedAt: new Date(now) }, now), false);
  assert.strictEqual(t.canCorrectMiss({ status: 'MISSED (FACULTY)', updatedAt: new Date(now - 3600000) }, now), true);
  assert.strictEqual(t.canCorrectMiss({ status: 'MISSED (FACULTY)' }, now), false); // no date at all: not correctable
});

// ---- "Did this take place?" reminder ----
test('the outcome reminder is due 1 hour after the slot ends, once', () => {
  const approved = { status: 'APPROVED', date: '2026-11-03', time: '10:00', duration: 60 }; // ends 11:00
  assert.strictEqual(t.OUTCOME_PROMPT_HOURS, 1);
  assert.strictEqual(t.endMoment(approved).getTime(), at('11:00'));
  assert.strictEqual(t.isOutcomePromptDue(approved, at('11:59')), false);
  assert.strictEqual(t.isOutcomePromptDue(approved, at('12:00')), true);
  assert.strictEqual(t.isOutcomePromptDue({ ...approved, outcomePromptSent: true }, at('13:00')), false);
  assert.strictEqual(t.isOutcomePromptDue({ ...approved, status: 'COMPLETED' }, at('13:00')), false);
  assert.strictEqual(t.isOutcomePromptDue({ ...approved, status: 'MISSED (STUDENT)' }, at('13:00')), false);
});

test('the outcome reminder uses the booked length, 60 minutes when none is saved', () => {
  const short = { status: 'APPROVED', date: '2026-11-03', time: '10:00', duration: 30 };
  assert.strictEqual(t.isOutcomePromptDue(short, at('11:30')), true);
  assert.strictEqual(t.isOutcomePromptDue(short, at('11:29')), false);
  const noLength = { status: 'APPROVED', date: '2026-11-03', time: '10:00' };
  assert.strictEqual(t.isOutcomePromptDue(noLength, at('12:00')), true);
  assert.strictEqual(t.isOutcomePromptDue(noLength, at('11:59')), false);
});

test('hasStarted: a consultation can be signed off only from its start time', () => {
  const { hasStarted } = require('./appointmentTime');
  const apt = { date: '2026-11-19', time: '10:00' };
  const start = new Date('2026-11-19T10:00:00+08:00').getTime();
  assert.strictEqual(hasStarted(apt, start - 60000), false);
  assert.strictEqual(hasStarted(apt, start), true);
  assert.strictEqual(hasStarted(apt, start + 3600000), true);
});
