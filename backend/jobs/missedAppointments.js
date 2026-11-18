const cron = require('node-cron');
const Appointment = require('../models/Appointment');
const User = require('../models/User');
const { notify, fmtDate, fmtTime } = require('../utils/notify');
const { manilaNow } = require('../utils/manilaTime');
const { transition } = require('../utils/statusTransition');

// An APPROVED consultation that nobody signed off (completed) or marked as a student
// Missed by Student by the end of its day (Philippine time) is counted as MISSED (FACULTY) (shown as Missed by Faculty).
// The faculty can still log it late from the Consultation Log if it did take place
// (the complete route accepts MISSED (FACULTY) for exactly that reason).
async function markMissedFaculty() {
  const today = manilaNow().dateStr;
  const overdue = await Appointment.find({ status: 'APPROVED', date: { $lt: today } });
  let marked = 0;
  for (const apt of overdue) {
    // Only if it is still APPROVED right now: the faculty member may have signed it off a moment ago.
    const updated = await transition(Appointment, apt._id, 'APPROVED', { status: 'MISSED (FACULTY)', missedAt: new Date() });
    if (!updated) continue;
    marked += 1;

    const when = `${fmtDate(apt.date)} at ${fmtTime(apt.time)}`;
    await notify(apt.facultyId, {
      type: 'APPOINTMENT_UPDATE',
      title: 'Consultation not signed off',
      message: `Your approved consultation with ${apt.studentName} on ${when} was never completed or marked as Missed by Student, so it is now shown as Missed by Faculty. If it did take place, you can still log it in your Consultation Log.`,
      appointmentId: apt._id,
    });
    const student = apt.studentId || (await User.findOne({ role: 'STUDENT', name: apt.studentName }).select('_id'))?._id;
    await notify(student, {
      type: 'APPOINTMENT_UPDATE',
      title: 'Consultation marked Missed by Faculty',
      message: `Your consultation on ${when} was not completed by your instructor, so it is shown as Missed by Faculty.`,
      appointmentId: apt._id,
    });
  }
  return marked;
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
