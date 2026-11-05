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
