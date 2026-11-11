// Which days of the week the schedule allows: one place, shared by the booking code, the routes and the validators.
// (The browser copy is frontend/src/utils/daySettings.ts: change both together.)
// Days use the JavaScript / database convention: Sunday = 0 ... Saturday = 6.

const DEFAULT_VISIBLE_DAYS = [1, 2, 3, 4, 5];       // the columns every schedule view shows
const CLASS_DAYS = [0, 1, 2, 3, 4, 5, 6];           // a class may be on any day (weekend classes are rare, but real)
const CONSULTATION_DAYS = [1, 2, 3, 4, 5];          // consultation hours, vacant hours and student requests: Monday to Friday only

const isClassDay = (d) => Number.isInteger(d) && CLASS_DAYS.includes(d);
const isConsultationDay = (d) => Number.isInteger(d) && CONSULTATION_DAYS.includes(d);

// Reads a day sent by the browser. 0 is a real day (Sunday), so null, '' and false must not turn into 0 the way
// Number() would turn them. Returns NaN when there is no usable number.
function parseDay(raw) {
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string' && raw.trim() !== '') return Number(raw);
  return NaN;
}

module.exports = { DEFAULT_VISIBLE_DAYS, CLASS_DAYS, CONSULTATION_DAYS, isClassDay, isConsultationDay, parseDay };
