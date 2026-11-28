// Schedules and consultation hours are stored as plain "HH:MM" strings that mean
// Philippine time. A cloud server usually runs on UTC, so reading the server's own
// clock would be 8 hours off. These helpers always work in Asia/Manila (UTC+8, no DST).

const DAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// Current day-of-week (0 = Sunday), date ("YYYY-MM-DD") and time ("HH:MM") in Manila.
function manilaNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila',
    weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const get = (type) => parts.find((p) => p.type === type).value;
  return {
    dayOfWeek: DAYS[get('weekday')],
    dateStr: `${get('year')}-${get('month')}-${get('day')}`,
    hhmm: `${get('hour')}:${get('minute')}`,
    hour: Number(get('hour')),
  };
}

// A real Date for "that Manila date at that Manila time" (e.g. when a class block began).
function manilaDate(dateStr, hhmm) {
  return new Date(`${dateStr}T${hhmm}:00+08:00`);
}

function formatManilaDateTime(value) {
  if (value === null || value === undefined || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

module.exports = { manilaNow, manilaDate, formatManilaDateTime };
