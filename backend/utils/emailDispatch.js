// Sends the email copy of notifications, one person at a time. No database here: the caller hands in the
// notification rows, the recipients and the function that actually sends, so it can be tested on its own.
//
// A failure is never thrown (an email problem must not break the booking that triggered it) but it is never
// silent either: every failed email is logged with the address, the notification and the real reason.

/**
 * @param docs       [{ userId, type, title, message, link }]
 * @param usersById  Map of userId (string) -> { email, accountStatus }
 * @param send       async (to, { type, title, message, link }) => any   (throws when sending fails)
 * @param enabled    false when EMAIL_NOTIFICATIONS=off
 * @returns          { sent, failed, skipped }
 */
async function sendEmailCopies(docs, usersById, send, { enabled = true, log = console } = {}) {
  const result = { sent: 0, failed: 0, skipped: 0 };
  if (!enabled) { result.skipped = docs.length; return result; }

  // One at a time, so a broadcast does not hit Gmail with a burst of simultaneous messages.
  for (const d of docs) {
    const u = usersById.get(String(d.userId));
    if (!u || !u.email || u.accountStatus !== 'ACTIVE') { result.skipped += 1; continue; }
    try {
      await send(u.email, { type: d.type, title: d.title, message: d.message, link: d.link });
      result.sent += 1;
    } catch (err) {
      result.failed += 1;
      log.error(`[email] FAILED to ${u.email} (${d.type}: "${d.title}"): ${err && err.code ? `${err.code}: ` : ''}${err && err.message ? err.message : err}`);
    }
  }
  if (result.skipped) log.warn(`[email] ${result.skipped} of ${docs.length} email(s) skipped (no email address, or the account is not ACTIVE).`);
  return result;
}

module.exports = { sendEmailCopies };
