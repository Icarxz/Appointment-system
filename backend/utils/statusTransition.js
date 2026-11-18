// Move an appointment to a new status in ONE database step, only if it is still in one of the expected statuses.
//
// Why: the routes used to read an appointment, check its status, then save it. Two people acting at the same moment
// (for example the faculty member signing off while the midnight job marks it missed, or a student cancelling while the
// faculty member approves) could both pass the check and the last save would silently win. With this helper the
// database itself refuses the second change: it returns null and the caller answers "someone just changed it".
//
// Model:    the Mongoose model (anything with findOneAndUpdate, so it can be tested with a fake).
// from:     one status or a list of statuses the appointment must be in right now.
// set:      the fields to write (the new status goes in here too).
// extra:    optional more conditions (for example { completedAt: { $exists: false } }).
// Returns the updated document, or null when the appointment was not in an expected status.
async function transition(Model, id, from, set, extra = {}) {
  const statuses = Array.isArray(from) ? from : [from];
  return Model.findOneAndUpdate(
    { ...extra, _id: id, status: { $in: statuses } },
    { $set: set },
    { new: true }
  );
}

const CHANGED_MESSAGE = 'This consultation was just updated by someone else. Please refresh and check its status.';

module.exports = { transition, CHANGED_MESSAGE };
