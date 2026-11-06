// Rules for a student who sends more than one consultation request (project decision, Nov 5):
//  1. Same professor and the same reason: refused while the first request is still open (any date or time).
//  2. Any OVERLAPPING time with a DIFFERENT professor on the same date: refused, because one student cannot be in two
//     places (12:00-13:00 and 12:30-13:30 overlap; 12:00-13:00 and 13:00-14:00 do not).
//  Same professor, same hour, DIFFERENT reason: allowed (a student may ask about two topics).
// "Open" means PENDING or APPROVED and not yet started. Declined, cancelled, expired, missed and completed
// requests never block a new one.
const { minutesUntil } = require('./appointmentTime');

const OPEN = ['PENDING', 'APPROVED'];

// "Thesis  help" and "thesis help." count as the same reason.
const normalizeReason = (r) => String(r || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();

const DEFAULT_MINUTES = 60;
const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
const overlaps = (a, b) => {
  const as = toMin(a.time), bs = toMin(b.time);
  return as < bs + (b.duration || DEFAULT_MINUTES) && bs < as + (a.duration || DEFAULT_MINUTES);
};

const isOpen = (apt, nowMs) => OPEN.includes(apt.status) && minutesUntil(apt.date, apt.time, nowMs) > 0;

/**
 * @param existing  the student's own appointments ({ facultyId, date, time, reason, status, facultyName? })
 * @param wanted    { facultyId, date, time, duration, reason }
 * @returns null when allowed, otherwise { code: 'SAME_REASON' | 'SAME_TIME', appointment }
 */
function findConflict(existing, wanted, nowMs = Date.now()) {
  const open = existing.filter(a => isOpen(a, nowMs));
  const sameFaculty = (a) => String(a.facultyId?._id || a.facultyId) === String(wanted.facultyId);
  const reason = normalizeReason(wanted.reason);

  const sameReason = open.find(a => sameFaculty(a) && normalizeReason(a.reason) === reason);
  if (sameReason) return { code: 'SAME_REASON', appointment: sameReason };

  const sameTime = open.find(a => !sameFaculty(a) && a.date === wanted.date && overlaps(a, wanted));
  if (sameTime) return { code: 'SAME_TIME', appointment: sameTime };

  return null;
}

function conflictMessage(conflict, facultyName = 'this professor') {
  if (conflict.code === 'SAME_REASON') {
    return `You already have an open request to ${facultyName} with this reason. Cancel it first, or use a different reason.`;
  }
  return 'You already have a request with another professor that overlaps this time. Cancel it first, or choose a different time.';
}

module.exports = { findConflict, conflictMessage, normalizeReason, isOpen };
