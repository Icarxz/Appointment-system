// Pure rules for finishing a consultation (no database, so they can be unit-tested).
// date "YYYY-MM-DD" and time "HH:MM" are Manila time, like everywhere else (see utils/appointmentTime.js).
//
//   Mark Completed   student or faculty, once the consultation has ENDED (start + length), never before.
//   Mark Missed      student or faculty, from 2 hours after the START. Faculty reports a student no-show, the student
//                    reports that the faculty member did not show up.
//   Automatic        nobody confirmed anything by 3 hours after the start: the system marks it MISSED (FACULTY),
//                    the same outcome the old end-of-day job gave (a consultation nobody signed off).
//   First confirmation wins. Repeating the same action is accepted without changing anything; the opposite action
//   is refused and says who got there first.
const { startMoment } = require('./appointmentTime');

const MISSED_AFTER_START_HOURS = 2;
const AUTO_MISSED_AFTER_START_HOURS = 3;
const DEFAULT_LENGTH_MINUTES = 60;

const lengthOf = (apt) => Number(apt.duration) || DEFAULT_LENGTH_MINUTES;
const endMoment = (apt) => new Date(startMoment(apt.date, apt.time).getTime() + lengthOf(apt) * 60000);
const missedFrom = (apt) => new Date(startMoment(apt.date, apt.time).getTime() + MISSED_AFTER_START_HOURS * 3600000);
const autoMissedAt = (apt) => new Date(startMoment(apt.date, apt.time).getTime() + AUTO_MISSED_AFTER_START_HOURS * 3600000);

const pad = (n) => String(n).padStart(2, '0');
// "13:30" clock text of a moment in Manila time (UTC+8), for messages like "Available when the consultation ends at 2:30 PM".
const manilaClock = (d) => {
  const m = new Date(d.getTime() + 8 * 3600000);
  const h = m.getUTCHours();
  return `${((h + 11) % 12) + 1}:${pad(m.getUTCMinutes())} ${h >= 12 ? 'PM' : 'AM'}`;
};

const who = (role) => (role === 'FACULTY' ? 'the faculty member' : 'the student');

// Decide what a "complete" or "missed" click does. apt: { status, date, time, duration, completedBy?, missedBy? }.
// action: 'COMPLETE' | 'MISSED'.  role: 'STUDENT' | 'FACULTY'.  Returns
//   { ok: true, change: true }                       do it
//   { ok: true, change: false, reason }              already done the same way, change nothing
//   { ok: false, status, error }                     refuse
function decideFinish(apt, action, role, nowMs = Date.now()) {
  const done = apt.status === 'COMPLETED';
  const missed = apt.status === 'MISSED (STUDENT)' || apt.status === 'MISSED (FACULTY)';

  if (action === 'COMPLETE') {
    if (done) return { ok: true, change: false, reason: `Already confirmed as completed${apt.completedBy ? ` by ${who(apt.completedBy)}` : ''}.` };
    if (missed) {
      // The automatic Missed (faculty) can still be turned into a late sign-off by the faculty member (the log was never written).
      if (apt.status === 'MISSED (FACULTY)' && role === 'FACULTY' && apt.missedBy === undefined) return finishWindow(apt, nowMs, true);
      return { ok: false, status: 409, error: `This consultation was already marked as missed${apt.missedBy ? ` by ${who(apt.missedBy)}` : ' by the system'}.` };
    }
    if (apt.status !== 'APPROVED') return { ok: false, status: 400, error: 'Only approved consultations can be completed.' };
    return finishWindow(apt, nowMs, true);
  }

  // MISSED
  if (missed) {
    return { ok: true, change: false, reason: `Already marked as missed${apt.missedBy ? ` by ${who(apt.missedBy)}` : ' by the system'}.` };
  }
  if (done) return { ok: false, status: 409, error: `This consultation was already confirmed as completed${apt.completedBy ? ` by ${who(apt.completedBy)}` : ''}.` };
  if (apt.status !== 'APPROVED') return { ok: false, status: 400, error: 'Only approved consultations can be marked as missed.' };
  if (nowMs < missedFrom(apt).getTime()) {
    return { ok: false, status: 400, error: `This can be marked as missed from ${manilaClock(missedFrom(apt))}, 2 hours after the start.` };
  }
  return { ok: true, change: true };
}

function finishWindow(apt, nowMs) {
  if (nowMs < endMoment(apt).getTime()) {
    return { ok: false, status: 400, error: `This consultation has not ended yet. It can be confirmed from ${manilaClock(endMoment(apt))}.` };
  }
  return { ok: true, change: true };
}

// Approved consultations nobody confirmed by 3 hours after the start (the cron job marks these Missed (faculty)).
const isAutoMissedDue = (apt, nowMs = Date.now()) => apt.status === 'APPROVED' && nowMs >= autoMissedAt(apt).getTime();

module.exports = {
  MISSED_AFTER_START_HOURS, AUTO_MISSED_AFTER_START_HOURS,
  endMoment, missedFrom, autoMissedAt, manilaClock, decideFinish, isAutoMissedDue,
};
