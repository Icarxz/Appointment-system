// Pure time rules for appointments (date "YYYY-MM-DD" and time "HH:MM" are Manila time, UTC+8).

const BOOKING_LEAD_HOURS = 1;  // students may request up to 1 hour before the start
const CANCEL_CUTOFF_HOURS = 1; // students and faculty may cancel up to 1 hour before the start
const REMINDER_MINUTES = 30;   // upcoming-consultation reminder

const startMoment = (date, time) => new Date(`${date}T${time}:00+08:00`);
const minutesUntil = (date, time, nowMs = Date.now()) => (startMoment(date, time).getTime() - nowMs) / 60000;

// A request nobody answered by its start time: the system rejects it.
const isPendingExpired = (apt, nowMs = Date.now()) => apt.status === 'PENDING' && minutesUntil(apt.date, apt.time, nowMs) <= 0;

// True when the start is still ahead but at most `minutes` away (reminder window).
const inReminderWindow = (apt, nowMs = Date.now(), minutes = REMINDER_MINUTES) => {
  const m = minutesUntil(apt.date, apt.time, nowMs);
  return m > 0 && m <= minutes;
};

// Cancelling (student or faculty) is allowed until CANCEL_CUTOFF_HOURS before the start.
const canCancel = (apt, nowMs = Date.now()) => minutesUntil(apt.date, apt.time, nowMs) >= CANCEL_CUTOFF_HOURS * 60;

// ---- After a consultation: the completion confirmation, then the missed notice ----
const COMPLETION_PROMPT_MINUTES = 15; // both people are asked to confirm the consultation was completed
const MISSED_AFTER_MINUTES = 30;      // still unconfirmed: it is counted as missed
// What "after the consultation time" counts from. 'end' = the end of the booked time (start + length), so a 2-hour
// consultation is never called missed while it is still going on. 'start' = the scheduled start time.
const FOLLOW_UP_FROM = 'end';

const consultationEndMoment = (apt) => new Date(startMoment(apt.date, apt.time).getTime() + (Number(apt.duration) || 60) * 60000);
const minutesSinceConsultation = (apt, nowMs = Date.now(), from = FOLLOW_UP_FROM) =>
  (nowMs - (from === 'start' ? startMoment(apt.date, apt.time) : consultationEndMoment(apt)).getTime()) / 60000;

// What the follow-up job should do with a consultation right now: 'MISSED' (30+ minutes after and still APPROVED),
// 'PROMPT' (15 to 30 minutes after and the confirmation was not sent yet) or null. The missed check comes first, so if
// the server was down and both are overdue, only the missed notice is sent (no pointless "confirm" email).
function followUpAction(apt, nowMs = Date.now(), from = FOLLOW_UP_FROM) {
  if (!apt || apt.status !== 'APPROVED') return null;
  const m = minutesSinceConsultation(apt, nowMs, from);
  if (m >= MISSED_AFTER_MINUTES) return 'MISSED';
  if (m >= COMPLETION_PROMPT_MINUTES && !apt.completionPromptSent) return 'PROMPT';
  return null;
}

// Why an unanswered request is rejected when its start time arrives. If another student's APPROVED consultation covers
// any part of the requested time, say so; otherwise it simply was not answered. (The text is shown to the student in
// View Details; frontend/src/components/appointmentStatus.ts keeps a copy of the first one.)
const EXPIRY_REASON_TAKEN = 'Another student\'s request for this time was accepted.';
const EXPIRY_REASON_NO_RESPONSE = 'No response from the faculty member before the requested time.';
// approvedSameDay: the faculty member's APPROVED appointments on the request's date [{ time, duration }].
function expiryReason(apt, approvedSameDay = []) {
  const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
  const s = toMin(apt.time), e = s + (Number(apt.duration) || 60);
  const taken = approvedSameDay.some(a => { const as = toMin(a.time); return s < as + (Number(a.duration) || 60) && as < e; });
  return taken ? EXPIRY_REASON_TAKEN : EXPIRY_REASON_NO_RESPONSE;
}

module.exports = { EXPIRY_REASON_TAKEN, EXPIRY_REASON_NO_RESPONSE, expiryReason, BOOKING_LEAD_HOURS, CANCEL_CUTOFF_HOURS, REMINDER_MINUTES, startMoment, minutesUntil, isPendingExpired, inReminderWindow, canCancel,
  COMPLETION_PROMPT_MINUTES, MISSED_AFTER_MINUTES, FOLLOW_UP_FROM, consultationEndMoment, minutesSinceConsultation, followUpAction };
