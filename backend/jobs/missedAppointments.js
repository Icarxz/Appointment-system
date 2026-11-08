const cron = require('node-cron');
const Appointment = require('../models/Appointment');
const User = require('../models/User');
const { notify, fmtDate, fmtTime } = require('../utils/notify');
const { manilaNow } = require('../utils/manilaTime');
const { isAutoMissedDue } = require('../utils/consultationEnd');

// An APPROVED consultation that nobody confirmed (completed) or reported as missed within 3 hours of its start is
// counted as MISSED (FACULTY): nobody signed it off. Faculty can still log it late from the Consultation Log if it did
// take place (the complete route accepts MISSED (FACULTY) set by the system for exactly that reason).
// Rules: utils/consultationEnd.js (isAutoMissedDue).
async function markMissedFaculty() {
  const today = manilaNow().dateStr;
  const candidates = await Appointment.find({ status: 'APPROVED', date: { $lte: today } });
  const overdue = candidates.filter((apt) => isAutoMissedDue(apt));
  for (const apt of overdue) {
    apt.status = 'MISSED (FACULTY)';
    apt.missedAt = new Date();
    await apt.save(); // no missedBy: the system marked it

    const when = `${fmtDate(apt.date)} at ${fmtTime(apt.time)}`;
    await notify(apt.facultyId, {
      type: 'APPOINTMENT_UPDATE',
      title: 'Consultation not signed off',
      message: `Your approved consultation with ${apt.studentName} on ${when} was not confirmed within 3 hours of its start, so it is counted as missed. If it did take place, you can still log it in your Consultation Log.`,
      appointmentId: apt._id,
    });
    const student = apt.studentId || (await User.findOne({ role: 'STUDENT', name: apt.studentName }).select('_id'))?._id;
    await notify(student, {
      type: 'APPOINTMENT_UPDATE',
      title: 'Consultation not held',
      message: `Your consultation on ${when} was not completed by your instructor.`,
      appointmentId: apt._id,
    });
  }
  return overdue.length;
}

const startMissedAppointments = () => {
  console.log('Missed Appointment Job Initialized');
  // Every 5 minutes (cheap query: only approved consultations dated today or earlier)
  cron.schedule('*/5 * * * *', async () => {
    try { await markMissedFaculty(); } catch (err) { console.error('Missed-appointment job failed:', err.message); }
  });
};

startMissedAppointments.markMissedFaculty = markMissedFaculty; // exported for tests / manual runs
module.exports = startMissedAppointments;
