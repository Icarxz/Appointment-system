// Decides the start time and length a faculty member may give a pending request when approving it.
// Pure: the route passes in the window computed by openWindow() (utils/slots.js).
//
//   window:  { start, end, minutes }  the free time left for this request ("HH:MM"); minutes 0 = nothing left
//   apt:     { time, duration }       the request as the student made it
//   body:    { time?, duration? }     what the faculty member chose (both optional)
//
// Rules: start and length are multiples of 15 minutes; the start is not before the window start; the whole consultation
// ends inside the window; the length is 15 minutes to 2 hours. Leaving both out keeps the requested start and length,
// which must still fit.
const { timeToMinutes } = require('./timeMath');

const STEP = 15;
const MAX_MINUTES = 120;
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const clock = (t) => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${pad(m)} ${h >= 12 ? 'PM' : 'AM'}`; };

function planApproval({ window, apt, body = {} }) {
  if (!window || !(window.minutes > 0)) {
    return { ok: false, status: 409, error: 'There is no free time left for this request. Decline it, or free up time first.' };
  }
  const winStart = timeToMinutes(window.start), winEnd = timeToMinutes(window.end);
  const wantsTime = body.time !== undefined && body.time !== null && body.time !== '';
  const wantsLength = body.duration !== undefined && body.duration !== null && body.duration !== '';

  let start = timeToMinutes(apt.time);
  if (wantsTime) {
    if (typeof body.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.time)) return { ok: false, status: 400, error: 'Start time must look like 09:30.' };
    start = timeToMinutes(body.time);
    if (start % STEP) return { ok: false, status: 400, error: 'Start time must be on a 15-minute mark.' };
  }
  let length = Number(apt.duration) || 60;
  if (wantsLength) {
    length = Number(body.duration);
    if (!Number.isInteger(length) || length < STEP || length > MAX_MINUTES || length % STEP) {
      return { ok: false, status: 400, error: 'Length must be 15 minutes to 2 hours, in 15-minute steps.' };
    }
  }

  const range = `${clock(window.start)} - ${clock(window.end)}`;
  if (start < winStart || start >= winEnd) {
    return { ok: false, status: 400, error: `Choose a start inside the free time: ${range}.` };
  }
  if (start + length > winEnd) {
    const room = Math.min(winEnd - start, MAX_MINUTES);
    return { ok: false, status: 400, error: `Only ${room} minutes are free from ${clock(hhmm(start))} (free time ends ${clock(window.end)}). Choose a shorter length or an earlier start.` };
  }
  return { ok: true, time: hhmm(start), duration: length, moved: hhmm(start) !== apt.time, lengthChanged: length !== (Number(apt.duration) || 60) };
}

module.exports = { planApproval, STEP, MAX_MINUTES };
