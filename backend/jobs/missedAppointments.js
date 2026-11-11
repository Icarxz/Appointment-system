const cron = require('node-cron');
const Appointment = require('../models/Appointment');
const User = require('../models/User');
const { notify, resolveStudentId, fmtDate, fmtTime } = require('../utils/notify');
const { manilaNow } = require('../utils/manilaTime');
const { followUpAction, COMPLETION_PROMPT_MINUTES, MISSED_AFTER_MINUTES } = require('../utils/appointmentTime');

// What happens after an APPROVED consultation that nobody has signed off yet. The minutes are counted by
// utils/appointmentTime.js (from the END of the booked time by default: FOLLOW_UP_FROM):
//   15 minutes after: both people get "confirm this consultation" (the faculty signs it off or marks a no-show).
//   30 minutes after, still unconfirmed: it is counted as MISSED (FACULTY) and both people are told.
// The faculty can still log a missed one late from the Consultation Log if it did take place
// (the complete route accepts MISSED (FACULTY) for exactly that reason).
// Every notification below is also emailed to the person's school address (utils/notify.js).
//
// Both steps are claimed with one atomic database update, so two overlapping runs, or a faculty sign-off a moment
// earlier, can never produce a second email or overwrite a status that just changed.

const defaultDeps = { Appointment, User, notify, resolveStudentId, manilaNow };
const whenOf = (apt) => `${fmtDate(apt.date)} at ${fmtTime(apt.time)}`;

async function sendCompletionPrompt(apt, d) {
  const claimed = await d.Appointment.findOneAndUpdate(
    { _id: apt._id, status: 'APPROVED', completionPromptSent: { $ne: true } },
    { $set: { completionPromptSent: true } },
  );
  if (!claimed) return false;

  const when = whenOf(apt);
  const wait = MISSED_AFTER_MINUTES - COMPLETION_PROMPT_MINUTES;
  const faculty = await d.User.findById(apt.facultyId).select('name');
  await d.notify(apt.facultyId, {
    type: 'APPOINTMENT_UPDATE',
    title: `Confirm your consultation with ${apt.studentName}`,
    message: `Your consultation on ${when} should be over. Please sign it off in your Consultation Log, or mark the student as a no-show. If it is not confirmed within ${wait} minutes, it will be counted as missed.`,
    appointmentId: apt._id,
  });
  await d.notify(await d.resolveStudentId(apt), {
    type: 'APPOINTMENT_UPDATE',
    title: 'Consultation completed?',
    message: `Your consultation with ${faculty ? faculty.name : 'your instructor'} on ${when} should be over. Your instructor will confirm that it took place. If it is not confirmed within ${wait} minutes, it will be recorded as missed.`,
    appointmentId: apt._id,
  });
  return true;
}

async function markMissed(apt, d) {
  const updated = await d.Appointment.findOneAndUpdate(
    { _id: apt._id, status: 'APPROVED' },
    { $set: { status: 'MISSED (FACULTY)', missedAt: new Date() } },
  );
  if (!updated) return false; // signed off, marked as a no-show or cancelled a moment ago

  const when = whenOf(apt);
  await d.notify(apt.facultyId, {
    type: 'APPOINTMENT_UPDATE',
    title: 'Consultation not signed off',
    message: `Your approved consultation with ${apt.studentName} on ${when} was never completed or marked as a no-show, so it is counted as missed. If it did take place, you can still log it in your Consultation Log.`,
    appointmentId: apt._id,
  });
  await d.notify(await d.resolveStudentId(apt), {
    type: 'APPOINTMENT_UPDATE',
    title: 'Consultation not held',
    message: `Your consultation on ${when} was not completed by your instructor.`,
    appointmentId: apt._id,
  });
  return true;
}

// One pass over every APPROVED consultation up to today. `deps` lets the tests run it with fakes (no database).
async function runFollowUps(nowMs = Date.now(), d = defaultDeps) {
  const today = d.manilaNow(new Date(nowMs)).dateStr;
  const candidates = await d.Appointment.find({ status: 'APPROVED', date: { $lte: today } });
  let prompted = 0, missed = 0;
  for (const apt of candidates) {
    try {
      const action = followUpAction(apt, nowMs);
      if (action === 'MISSED') { if (await markMissed(apt, d)) missed += 1; }
      else if (action === 'PROMPT') { if (await sendCompletionPrompt(apt, d)) prompted += 1; }
    } catch (err) {
      console.error(`[follow-up] consultation ${apt._id} failed:`, err && err.message ? err.message : err); // one bad record never stops the rest
    }
  }
  return { prompted, missed };
}

const startMissedAppointments = () => {
  console.log('Consultation follow-up job (completion prompt + missed) initialized');
  // Every minute, so the 15- and 30-minute steps are on time (the reminder job runs every minute too).
  cron.schedule('* * * * *', async () => {
    try { await runFollowUps(); } catch (err) { console.error('Consultation follow-up job failed:', err.message); }
  });
};

startMissedAppointments.runFollowUps = runFollowUps;       // exported for tests / manual runs
startMissedAppointments.markMissedFaculty = runFollowUps;  // the old name, kept in case a script still uses it
module.exports = startMissedAppointments;
