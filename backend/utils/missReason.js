// Reasons for a miss. Whoever marks a consultation as missed must give a reason, and the other person sees it
// (the same rule as cancelling). When the system marks it (nobody signed off by the end of the day) it writes the reason itself.

const MAX_REASON = 300;
const REASON_NOT_SIGNED_OFF = 'Not signed off by the faculty member by the end of the day.';

// Who marked the miss: the faculty member (Missed by Student), the student (Missed by Faculty), or the system.
const MISSED_BY = { FACULTY: 'FACULTY', STUDENT: 'STUDENT', SYSTEM: 'SYSTEM' };

// Trim and cap a reason typed or picked by a person. '' means "none given".
const cleanReason = (raw) => String(raw == null ? '' : raw).trim().slice(0, MAX_REASON);

module.exports = { MAX_REASON, REASON_NOT_SIGNED_OFF, MISSED_BY, cleanReason };
