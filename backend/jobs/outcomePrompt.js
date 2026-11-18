const cron = require('node-cron');
const Appointment = require('../models/Appointment');
const User = require('../models/User');
const { notify, resolveStudentId, fmtDate, fmtTime } = require('../utils/notify');
const { manilaNow } = require('../utils/manilaTime');
const { isOutcomePromptDue } = require('../utils/appointmentTime');

// An APPROVED consultation still has no outcome 1 hour after its slot ended: ask BOTH people "Did this take place?" so
// it does not wait until midnight to be settled. The faculty member can sign it off or mark Missed by Student; the
// student can report Missed by Faculty. (If nobody acts, the midnight job in jobs/missedAppointments.js settles it.)
// In-app message plus email (every notification is also emailed). Sent once: the flag is set first, in one atomic step.
async function sendOutcomePrompts(nowMs = Date.now()) {
  const candidates = await Appointment.find({ status: 'APPROVED', outcomePromptSent: { $ne: true }, date: manilaNow(new Date(nowMs)).dateStr });
  let sent = 0;
  for (const apt of candidates) {
    if (!isOutcomePromptDue(apt, nowMs)) continue;
    // Claim it first: if two runs overlap, only one gets it, and a failed email can never cause a second reminder.
    const claimed = await Appointment.findOneAndUpdate(
      { _id: apt._id, status: 'APPROVED', outcomePromptSent: { $ne: true } },
      { $set: { outcomePromptSent: true } },
      { new: true }
    );
    if (!claimed) continue;
    sent += 1;

    const when = `${fmtDate(apt.date)} at ${fmtTime(apt.time)}`;
    await notify(apt.facultyId, {
      type: 'APPOINTMENT_UPDATE',
      title: 'Did this consultation take place?',
      message: `Your consultation with ${apt.studentName} on ${when} ended an hour ago and has no outcome yet. Please sign it off in your Consultation Log, or mark it as Missed by Student.`,
      appointmentId: apt._id,
    });
    const faculty = await User.findById(apt.facultyId).select('name');
    await notify(await resolveStudentId(apt), {
      type: 'APPOINTMENT_UPDATE',
      title: 'Did this consultation take place?',
      message: `Your consultation with ${faculty ? faculty.name : 'your instructor'} on ${when} ended an hour ago and has no outcome yet. If the instructor did not show up, you can report it as Missed by Faculty.`,
      appointmentId: apt._id,
    });
  }
  return sent;
}

const startOutcomePrompt = () => {
  console.log('Outcome Reminder Job Initialized');
  cron.schedule('* * * * *', async () => {
    try { await sendOutcomePrompts(); } catch (err) { console.error('Outcome reminder job failed:', err.message); }
  });
};

module.exports = startOutcomePrompt;
module.exports.sendOutcomePrompts = sendOutcomePrompts; // for tests / manual runs
