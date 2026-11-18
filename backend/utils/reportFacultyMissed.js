// Pure rule for "the instructor did not show up": a STUDENT reports it, and the consultation becomes MISSED (FACULTY).
// Appointment date/time are Philippine local time strings. Mirrors utils/bulkCancel.js (a decision function the route calls).
const { canMarkMissed, missOpensAt, MISS_GRACE_MINUTES } = require('./appointmentTime');
const { cleanReason } = require('./missReason');

// apt: the appointment; userId / userName: the logged-in student (older appointments have no studentId, so the name is the fallback).
// Returns { ok: true, reason } or { ok: false, status, error, opensAt? }.
function reportDecision({ apt, userId, userName, reason, nowMs = Date.now() }) {
  if (!apt) return { ok: false, status: 404, error: 'Appointment not found.' };
  const mine = apt.studentId ? String(apt.studentId) === String(userId) : apt.studentName === userName;
  if (!mine) return { ok: false, status: 403, error: 'Forbidden' };
  if (apt.status !== 'APPROVED') return { ok: false, status: 400, error: 'Only an approved consultation can be reported as Missed by Faculty.' };
  if (!canMarkMissed(apt, nowMs)) {
    return { ok: false, status: 400, error: `You can report this ${MISS_GRACE_MINUTES} minutes after the start time.`, opensAt: missOpensAt(apt) };
  }
  const clean = cleanReason(reason);
  if (!clean) return { ok: false, status: 400, error: 'Please select or enter a reason.' };
  return { ok: true, reason: clean };
}

module.exports = { reportDecision };
