// Rules for a student who sends more than one consultation request (project decision, Nov 5):
//  1. Same professor and the same reason: refused while the first request is still open (any date or time).
//  2. Same date and same hour with a DIFFERENT professor: refused, because one student cannot be in two places.
//  Same professor, same hour, DIFFERENT reason: allowed (a student may ask about two topics).
// "Open" means PENDING or APPROVED and not yet started. Declined, cancelled, expired, missed and completed
// requests never block a new one.
const { minutesUntil } = require('./appointmentTime');

const OPEN = ['PENDING', 'APPROVED'];

// "Thesis  help" and "thesis help." count as the same reason.
const normalizeReason = (r) => String(r || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();

const isOpen = (apt, nowMs) => OPEN.includes(apt.status) && minutesUntil(apt.date, apt.time, nowMs) > 0;

/**
 * @param existing  the student's own appointments ({ facultyId, date, time, reason, status, facultyName? })
 * @param wanted    { facultyId, date, time, reason }
 * @returns null when allowed, otherwise { code: 'SAME_REASON' | 'SAME_TIME', appointment }
 */
function findConflict(existing, wanted, nowMs = Date.now()) {
  const open = existing.filter(a => isOpen(a, nowMs));
  const sameFaculty = (a) => String(a.facultyId?._id || a.facultyId) === String(wanted.facultyId);
  const reason = normalizeReason(wanted.reason);

  const sameReason = open.find(a => sameFaculty(a) && normalizeReason(a.reason) === reason);
  if (sameReason) return { code: 'SAME_REASON', appointment: sameReason };

  const sameTime = open.find(a => !sameFaculty(a) && a.date === wanted.date && a.time === wanted.time);
  if (sameTime) return { code: 'SAME_TIME', appointment: sameTime };

  return null;
}

function conflictMessage(conflict, facultyName = 'this professor') {
  if (conflict.code === 'SAME_REASON') {
    return `You already have an open request to ${facultyName} with this reason. Cancel it first, or use a different reason.`;
  }
  return 'You already have a request at this same date and time with another professor. Cancel it first, or choose a different time.';
}

module.exports = { findConflict, conflictMessage, normalizeReason, isOpen };
