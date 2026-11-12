const cron = require('node-cron');
const ScheduleImport = require('../models/ScheduleImport');
const Appointment = require('../models/Appointment');
const User = require('../models/User');
const { notify } = require('../utils/notify');
const { manilaNow } = require('../utils/manilaTime');
const { revalidate, applyImport } = require('../utils/scheduleImportService');
const { mongoStore } = require('../utils/scheduleStore');

// Every hour (and once at startup, to catch up after downtime): a staged schedule whose effectivity date has arrived is applied.
// It is checked AGAIN first, against the appointments as they are today. If it no longer passes, it is marked FAILED and the faculty is told;
// the current schedule is left alone. The claim step (SCHEDULED -> APPLYING) makes a second server instance skip it.
async function activateDueImports() {
  const today = manilaNow().dateStr;
  const due = await ScheduleImport.find({ status: 'SCHEDULED', effectivityDate: { $lte: today } }).sort({ effectivityDate: 1, createdAt: 1 });
  let applied = 0;
  for (const imp of due) {
    const claimed = await ScheduleImport.findOneAndUpdate({ _id: imp._id, status: 'SCHEDULED' }, { $set: { status: 'APPLYING' } });
    if (!claimed) continue;
    const fail = async (reason) => {
      await ScheduleImport.updateOne({ _id: imp._id }, { $set: { status: 'FAILED', failureReason: reason } });
      await notify([imp.facultyId, imp.uploadedBy], { type: 'SCHEDULE_IMPORT', title: 'Scheduled class schedule was not applied', message: `The schedule effective ${imp.effectivityDate} could not be applied: ${reason} Your current schedule was not changed.`, page: 'schedule' });
    };
    try {
      const target = await User.findOne({ _id: imp.facultyId, role: 'FACULTY' }).select('name').lean();
      if (!target) { await fail('The faculty account no longer exists.'); continue; }
      const mine = await Appointment.find({ facultyId: imp.facultyId, status: { $in: ['APPROVED', 'PENDING'] }, date: { $gte: today } }).select('date time duration status').lean();
      const stored = imp.toObject();
      const check = revalidate(
        { classes: stored.classes, consultationHours: stored.consultationHours, metadata: { term: imp.term, academicYear: imp.academicYear, effectivityDate: imp.effectivityDate } },
        { identityConfirmed: imp.identityConfirmedByReviewer, targetName: target.name, approved: mine.filter(a => a.status === 'APPROVED'), pending: mine.filter(a => a.status === 'PENDING') });
      if (!check.ok) { await fail(check.errors.map(e => e.message).join(' ')); continue; }
      const r = await applyImport({ facultyId: imp.facultyId, classes: check.rows.classes, consultationHours: check.rows.consultationHours }, { store: mongoStore, enforceBase: false });
      if (!r.ok) { await fail(r.message); continue; }
      await ScheduleImport.updateMany({ facultyId: imp.facultyId, status: 'ACTIVE' }, { $set: { status: 'SUPERSEDED' } });
      await ScheduleImport.updateOne({ _id: imp._id }, { $set: { status: 'ACTIVE', failureReason: '', activatedAt: new Date(), previousSnapshot: { classes: r.snapshot.classes, hours: r.snapshot.hours } } });
      await notify([imp.facultyId], { type: 'SCHEDULE_IMPORT', title: 'New class schedule is now in effect', message: `Your class schedule effective ${imp.effectivityDate} is now active.`, page: 'schedule' });
      applied++;
    } catch (e) {
      await fail('A server error stopped it. Nothing was changed unless the schedule page says otherwise.').catch(() => {});
      console.error('Schedule import activation failed:', e.message);
    }
  }
  return applied;
}

const startScheduleImportActivation = () => {
  console.log('Schedule Import Activation Job Initialized');
  const run = () => activateDueImports().catch(e => console.error('Schedule import activation job failed:', e.message));
  run();
  cron.schedule('5 * * * *', run);
};

module.exports = startScheduleImportActivation;
module.exports.activateDueImports = activateDueImports;
