const cron = require('node-cron');
const Appointment = require('../models/Appointment');
const User = require('../models/User');
const { notify, fmtDate, fmtTime } = require('../utils/notify');
const { manilaNow } = require('../utils/manilaTime');

// An APPROVED consultation that nobody completed or marked as a student
// no-show by the end of its day (Philippine time) is counted as MISSED (FACULTY).
// The faculty can still complete it late from the Consultation Log if it did take place
// (the complete route accepts MISSED (FACULTY) for exactly that reason).
async function markMissedFaculty() {
  const today = manilaNow().dateStr;
  const overdue = await Appointment.find({ status: 'APPROVED', date: { $lt: today } });
  for (const apt of overdue) {
    apt.status = 'MISSED (FACULTY)';
    apt.missedAt = new Date();
    await apt.save();

    const when = `${fmtDate(apt.date)} at ${fmtTime(apt.time)}`;
    await notify(apt.facultyId, {
      type: 'APPOINTMENT_UPDATE',
      title: 'Consultation not completed',
      message: `Your approved consultation with ${apt.studentName} on ${when} was never completed or marked as a no-show, so it is counted as missed. If it did take place, you can still complete it in your Consultation Log.`,
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
  // Every 30 minutes (cheap query; the date comparison means it only acts after midnight Manila time)
  cron.schedule('*/30 * * * *', async () => {
    try { await markMissedFaculty(); } catch (err) { console.error('Missed-appointment job failed:', err.message); }
  });
};

startMissedAppointments.markMissedFaculty = markMissedFaculty; // exported for tests / manual runs
module.exports = startMissedAppointments;
