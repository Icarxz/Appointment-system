// Turns the "My Status" duration choice into an end time (Manila time).
const { manilaNow, manilaDate } = require('./manilaTime');

const MINUTE_CHOICES = [15, 30, 60, 120];

// choice: a number of minutes, 'EOD' (end of today) or 'UNTIL' (with untilTime "HH:MM", today).
// Returns { ok: true, endAt: Date } or { ok: false, error }.
function endFromChoice(choice, untilTime, now = new Date()) {
  const today = manilaNow(now).dateStr;
  if (choice === 'EOD') return { ok: true, endAt: new Date(manilaDate(today, '00:00').getTime() + 24 * 3600000) };
  if (choice === 'UNTIL') {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(untilTime || ''))) return { ok: false, error: 'Choose a valid end time.' };
    const end = manilaDate(today, untilTime);
    if (end <= now) return { ok: false, error: 'Choose an end time later than now.' };
    return { ok: true, endAt: end };
  }
  const m = Number(choice);
  if (!MINUTE_CHOICES.includes(m)) return { ok: false, error: 'Choose how long this status lasts.' };
  return { ok: true, endAt: new Date(now.getTime() + m * 60000) };
}

module.exports = { endFromChoice, MINUTE_CHOICES };
