const Notification = require('../models/Notification');
const User = require('../models/User');
const { sendNotificationEmail } = require('./mailer');
const { sendEmailCopies } = require('./emailDispatch');
const { buildLink } = require('./notifyLink');

// Every notification is also emailed to the person's school address (panelist rule 5.1), Dean broadcasts
// included. Gmail allows about 500 messages a day from a personal sender, which is plenty for a small
// user base. Set EMAIL_NOTIFICATIONS=off to disable emailing (for example in local tests).
// The sending itself, and its logging of every failure, is in utils/emailDispatch.js.

// Fire-and-forget: a slow or failing mailbox must never delay or break the action that triggered it.
// Each email carries that person's own link (their dashboard differs by role).
function emailCopies(docs, usersById) {
  sendEmailCopies(docs, usersById, sendNotificationEmail, { enabled: process.env.EMAIL_NOTIFICATIONS !== 'off' })
    .catch(err => console.error('[email] dispatch crashed:', err && err.message ? err.message : err));
}

// Create a notification for one or many users. Never throws:
// a failed notification must never break the action that triggered it.
// Pass `appointmentId` to make the message open that appointment's details, or `page` to open a dashboard
// page. The link itself is built here from the recipient's role (utils/notifyLink.js), never taken from the caller.
async function notify(userIds, { type, title, message, appointmentId, page }) {
  try {
    const ids = [...new Set((Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean).map(String))];
    if (!ids.length) return;
    const users = await User.find({ _id: { $in: ids } }).select('role email accountStatus').lean();
    const usersById = new Map(users.map(u => [String(u._id), u]));
    const docs = ids.map(userId => {
      const u = usersById.get(userId);
      return { userId, type, title, message, link: u ? buildLink(u.role, { appointmentId, page }) : null };
    });
    await Notification.insertMany(docs);
    emailCopies(docs, usersById);
  } catch (err) {
    console.error('notify() failed:', err.message);
  }
}

// Notify every active user with a given role (e.g. all ADMINs)
async function notifyRole(role, payload) {
  try {
    const users = await User.find({ role, accountStatus: 'ACTIVE' }).select('_id');
    await notify(users.map(u => u._id), payload);
  } catch (err) {
    console.error('notifyRole() failed:', err.message);
  }
}

// Older appointments have no studentId, so fall back to matching the student by name
async function resolveStudentId(apt) {
  if (apt.studentId) return apt.studentId;
  const u = await User.findOne({ role: 'STUDENT', name: apt.studentName }).select('_id');
  return u ? u._id : null;
}

const fmtDate = (d) =>
  new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

const fmtTime = (t) => {
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

module.exports = { notify, notifyRole, resolveStudentId, fmtDate, fmtTime };
