// Phase 6 of the Faculty Schedule PDF Importer: replace a faculty's class schedule and official consultation hours with the
// confirmed import, safely. Pure logic over a small "store" so it can be tested without a database.
//
// Why not a Mongo transaction: transactions need a replica set, and the deployment's topology is unconfirmed (plan section 14).
// This order works on any MongoDB and never leaves the faculty without a schedule:
//   1. read the current rows (they become the snapshot),
//   2. INSERT the new rows (own ids made up front, so a failed insert can be cleaned up exactly),
//   3. DELETE the old rows by id.
// A failure at step 2 removes whatever was inserted; a failure at step 3 removes the NEW rows, so the old schedule stays whole.
// Only Schedule and ConsultationHours are touched: added consultation hours, notes, appointments and statuses are never read here.
//
// store: {
//   load(facultyId)                          -> { classes: [{ _id, dayOfWeek, startTime, endTime, subject, room }], hours: [{ _id, dayOfWeek, startTime, endTime }] }
//   insert(facultyId, classes, hours)        -> { classIds: [], hourIds: [] }   (throws after cleaning up if it cannot insert everything)
//   remove({ classIds, hourIds })            -> void
// }

const crypto = require('crypto');

const classKey = (c) => [Number(c.dayOfWeek), c.startTime, c.endTime, String(c.subject || '').trim(), String(c.room || '').trim()].join('|');
const hourKey = (h) => [Number(h.dayOfWeek), h.startTime, h.endTime].join('|');

// Same schedule => same fingerprint, whatever the order. Used to refuse a confirmation when the schedule changed after the preview.
function fingerprint(classes = [], hours = []) {
  const text = JSON.stringify({ c: classes.map(classKey).sort(), h: hours.map(hourKey).sort() });
  return crypto.createHash('sha256').update(text).digest('hex');
}

const plain = (c) => ({ dayOfWeek: c.dayOfWeek, startTime: c.startTime, endTime: c.endTime, subject: c.subject, room: c.room });
const plainHour = (h) => ({ dayOfWeek: h.dayOfWeek, startTime: h.startTime, endTime: h.endTime });

async function replaceSchedule(store, facultyId, newClasses, newHours) {
  const before = await store.load(facultyId);
  const snapshot = { classes: before.classes.map(plain), hours: before.hours.map(plainHour) };
  const oldIds = { classIds: before.classes.map(c => c._id), hourIds: before.hours.map(h => h._id) };   // fixed BEFORE inserting, so the new rows can never be in this list

  let created;
  try {
    created = await store.insert(facultyId, newClasses.map(plain), newHours.map(plainHour));
  } catch (e) {
    throw Object.assign(new Error('Could not save the new schedule. The previous schedule was not changed.'), { cause: e, code: 'INSERT_FAILED' });
  }
  try {
    await store.remove(oldIds);
  } catch (e) {
    try { await store.remove(created); } catch (_) { /* the old rows are still there either way */ }
    throw Object.assign(new Error('Could not remove the old schedule. The previous schedule was kept.'), { cause: e, code: 'REMOVE_FAILED' });
  }
  return { snapshot, counts: { classes: newClasses.length, hours: newHours.length, removedClasses: oldIds.classIds.length, removedHours: oldIds.hourIds.length } };
}

module.exports = { fingerprint, replaceSchedule };
