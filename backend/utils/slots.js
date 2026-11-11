// Pure slot logic (no database) so it can be unit-tested.
// A "slot" is one bookable piece of a consultation-hours block: 1 hour, or the shorter
// remainder when a block isn't a whole number of hours (e.g. 9:30-11:00 -> 9:30-10:30, 10:30-11:00).

const { timeToMinutes } = require('./timeMath');
const { CONSULTATION_DAYS } = require('./daySettings');

const OPERATING_START = 450; // 7:30 AM: same limits the booking form always had
const OPERATING_LAST_START = 1110; // 6:30 PM: the last half hour of a block that ends at 7:00 PM
const OPERATING_LAST_END = 1140;   // 7:00 PM: consultation hours may not run later than this

const pad = (n) => String(n).padStart(2, '0');
const toHHMM = (mins) => `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;

// Day of week (0=Sun) for a "YYYY-MM-DD" date, independent of server timezone.
const dayOfWeekOf = (dateStr) => new Date(`${dateStr}T00:00:00Z`).getUTCDay();

// Add n days to a "YYYY-MM-DD" date string.
const addDays = (dateStr, n) => {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// Split "09:00"-"11:00" into hourly pieces. A remainder shorter than an hour stays as its own slot.
function splitIntoSlots(startTime, endTime) {
  const out = [];
  let s = timeToMinutes(startTime);
  const e = timeToMinutes(endTime);
  while (s < e) {
    const next = Math.min(s + 60, e);
    out.push({ start: toHHMM(s), end: toHHMM(next), duration: next - s });
    s = next;
  }
  return out;
}

const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;

// Vacant bookable window (panelist decision): Monday to Friday, 8:00 AM to 5:00 PM. Inside it, any hour that is
// not a class, not already approved for someone else and not part of the consultation hours can be requested.
const VACANT_START = 480;  // 8:00 AM
const VACANT_END = 1020;   // 5:00 PM (the last vacant slot is 4:00-5:00 PM)

// Build the bookable slots for one faculty member.
//   official:     [{dayOfWeek, startTime, endTime}]            recurring weekly
//   added:        [{dayOfWeek, startTime, endTime}]            recurring weekly, on top of the official hours
//   classes:      [{dayOfWeek, startTime, endTime}]            teaching blocks
//   appointments: [{date, time, duration, status}]             PENDING / APPROVED matter
//   today:        "YYYY-MM-DD" (Manila)   nowMs: epoch ms   flaggedDate: date the faculty is out
// Slot kinds: OFFICIAL and ADDED (consultation hours) and VACANT (any other free hour, Mon-Fri 8 AM-5 PM).
// Set includeVacant to false to get the consultation-hour slots only.
function buildSlots({ official, added, classes, appointments, today, nowMs, weeks = 4, leadHours = 1, flaggedDate = '', includeVacant = true }) {
  const slots = [];
  const days = weeks * 7;

  for (let i = 0; i < days; i++) {
    const date = addDays(today, i);
    if (date === flaggedDate) continue;
    const dow = dayOfWeekOf(date);
    if (!CONSULTATION_DAYS.includes(dow)) continue; // no weekend consultation or vacant slots, even where a weekend class exists

    const blocks = [
      ...official.filter(h => h.dayOfWeek === dow).map(h => ({ ...h, kind: 'OFFICIAL' })),
      ...added.filter(h => h.dayOfWeek === dow).map(h => ({ ...h, kind: 'ADDED' })),
    ];
    const dayClasses = classes.filter(c => c.dayOfWeek === dow);
    const dayApts = appointments.filter(a => a.date === date);

    // Is [s, e) open on this date? Returns { pending } or null (too soon, in class, or already approved).
    const evaluate = (s, e, startTime) => {
      const startMs = new Date(`${date}T${startTime}:00+08:00`).getTime();
      if ((startMs - nowMs) / 36e5 < leadHours) return null;
      if (dayClasses.some(c => overlaps(s, e, timeToMinutes(c.startTime), timeToMinutes(c.endTime)))) return null;
      const hit = dayApts.filter(a => {
        const as = timeToMinutes(a.time);
        return overlaps(s, e, as, as + (Number(a.duration) || 60));
      });
      if (hit.some(a => a.status === 'APPROVED')) return null; // already taken
      return { pending: hit.filter(a => a.status === 'PENDING').length };
    };

    for (const block of blocks) {
      for (const piece of splitIntoSlots(block.startTime, block.endTime)) {
        const s = timeToMinutes(piece.start);
        const e = timeToMinutes(piece.end);
        if (s < OPERATING_START || s > OPERATING_LAST_START) continue;
        const open = evaluate(s, e, piece.start);
        if (!open) continue;

        // The same time can be both official and added hours; keep one slot.
        if (slots.some(x => x.date === date && x.start === piece.start)) continue;
        slots.push({
          date, start: piece.start, end: piece.end, duration: piece.duration,
          kind: block.kind, pending: open.pending,
        });
      }
    }

    if (includeVacant && dow >= 1 && dow <= 5) {
      const consult = blocks.map(b => [timeToMinutes(b.startTime), timeToMinutes(b.endTime)]);
      for (let s = VACANT_START; s + 60 <= VACANT_END; s += 60) {
        const e = s + 60;
        if (consult.some(([bs, be]) => overlaps(s, e, bs, be))) continue; // a consultation hour, shown as one
        const start = toHHMM(s);
        const open = evaluate(s, e, start);
        if (!open) continue;
        slots.push({
          date, start, end: toHHMM(e), duration: 60,
          kind: 'VACANT', pending: open.pending,
        });
      }
    }
  }
  return slots.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}

// What blocks the calendar cells that are not bookable, so students can see WHY (class or already booked).
// Only times: no student names, and no appointment details (the class schedule is already public).
//   returns [{ date, start, end, type: 'CLASS' | 'BOOKED' }] for the next `weeks` weeks.
function buildBusy({ classes, appointments, today, weeks = 4, flaggedDate = '' }) {
  const busy = [];
  for (let i = 0; i < weeks * 7; i++) {
    const date = addDays(today, i);
    const dow = dayOfWeekOf(date);
    if (!CONSULTATION_DAYS.includes(dow)) continue; // weekends are not shown to students
    if (date === flaggedDate) continue; // the whole day is closed, nothing to explain cell by cell
    for (const c of classes.filter(x => x.dayOfWeek === dow)) {
      busy.push({ date, start: c.startTime, end: c.endTime, type: 'CLASS' });
    }
    for (const a of appointments.filter(x => x.date === date && x.status === 'APPROVED')) {
      const s = timeToMinutes(a.time);
      busy.push({ date, start: a.time, end: toHHMM(s + (Number(a.duration) || 60)), type: 'BOOKED' });
    }
  }
  return busy;
}

// Consultation blocks for a date's weekday, merged so back-to-back blocks (e.g. official 9-10 then added
// 10-11) count as one continuous run. Returns [[startMin, endMin], ...] sorted.
function consultRuns({ date, official, added }) {
  const dow = dayOfWeekOf(date);
  if (!CONSULTATION_DAYS.includes(dow)) return []; // weekend consultation hours never count, even if old rows exist
  const spans = [...official, ...added]
    .filter(h => h.dayOfWeek === dow)
    .map(h => [timeToMinutes(h.startTime), timeToMinutes(h.endTime)])
    .sort((a, b) => a[0] - b[0]);
  const runs = [];
  for (const [s, e] of spans) {
    const last = runs[runs.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else runs.push([s, e]);
  }
  return runs;
}

// Is [time, time+duration) fully inside one continuous run of official + added consultation hours?
function insideConsultHours({ date, time, duration, official, added }) {
  const s = timeToMinutes(time);
  const e = s + duration;
  return consultRuns({ date, official, added }).some(([rs, re]) => s >= rs && e <= re);
}

// May an appointment be approved at this time? Either fully inside the consultation hours, or fully inside the
// vacant window (Monday to Friday, 8 AM to 5 PM). Classes and other approved appointments are checked separately.
function insideBookableHours({ date, time, duration, official, added }) {
  const dow = dayOfWeekOf(date);
  const s = timeToMinutes(time);
  const e = s + duration;
  if (dow >= 1 && dow <= 5 && s >= VACANT_START && e <= VACANT_END) return true;
  return insideConsultHours({ date, time, duration, official, added });
}

// The longest a consultation starting at `time` can be: up to the end of the continuous run it sits in,
// capped at MAX_CONSULT_MINUTES. Returns 0 when `time` is outside consultation hours.
const MAX_CONSULT_MINUTES = 120;
function maxDurationAt({ date, time, official, added }) {
  const s = timeToMinutes(time);
  const run = consultRuns({ date, official, added }).find(([rs, re]) => s >= rs && s < re);
  return run ? Math.min(run[1] - s, MAX_CONSULT_MINUTES) : 0;
}

const fmt12 = (mins) => {
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${((h + 11) % 12) + 1}:${pad(m)} ${h >= 12 ? 'PM' : 'AM'}`;
};
const fmtLength = (mins) => {
  const h = Math.floor(mins / 60), m = mins % 60;
  return [h ? `${h} hr${h > 1 ? 's' : ''}` : '', m ? `${m} mins` : ''].filter(Boolean).join(' ') || '0 mins';
};

// How much uninterrupted bookable time is there from a requested start time?
// Bookable time = the consultation hours (official + added) joined with the vacant window (Mon-Fri 8 AM-5 PM). The
// window runs from `time` until the first thing that blocks it: the end of the bookable time, a class, or an APPROVED
// appointment. Other PENDING requests never block it (they are only asked for, not given), and `excludeId` leaves
// the request being looked at out of the approved list.
//   returns { start, end, minutes, maxMinutes, label }   minutes is 0 when `time` itself is not available.
// maxMinutes is minutes capped at MAX_CONSULT_MINUTES, the longest one consultation may be.
function availableWindow({ date, time, official = [], added = [], classes = [], appointments = [], excludeId = null }) {
  const dow = dayOfWeekOf(date);
  const s = timeToMinutes(time);
  const none = { start: toHHMM(s), end: toHHMM(s), minutes: 0, maxMinutes: 0, label: 'No time available' };

  const spans = consultRuns({ date, official, added }).map(r => [...r]);
  if (dow >= 1 && dow <= 5) spans.push([VACANT_START, VACANT_END]);
  spans.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [a, b] of spans) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  const span = merged.find(([a, b]) => s >= a && s < b);
  if (!span) return none;

  const blockers = [
    ...classes.filter(c => c.dayOfWeek === dow).map(c => [timeToMinutes(c.startTime), timeToMinutes(c.endTime)]),
    ...appointments
      .filter(a => a.date === date && a.status === 'APPROVED' && String(a._id) !== String(excludeId))
      .map(a => { const as = timeToMinutes(a.time); return [as, as + (Number(a.duration) || 60)]; }),
  ];
  if (blockers.some(([bs, be]) => s >= bs && s < be)) return none; // the start itself is already taken

  let end = span[1];
  for (const [bs] of blockers) if (bs > s && bs < end) end = bs;
  const minutes = end - s;
  return {
    start: toHHMM(s), end: toHHMM(end), minutes, maxMinutes: Math.min(minutes, MAX_CONSULT_MINUTES),
    label: `${fmt12(s)} - ${fmt12(end)} (${fmtLength(minutes)} total)`,
  };
}

// The free time a PENDING request can still be given. Like availableWindow, but when the requested start is already
// covered by APPROVED appointments (another student got 8:00-8:30), the window starts where they end (8:30), so a second
// student asking for 8:00 can be given 8:30 onward. Classes never move the start; a class at the start means no time.
//   returns { start, end, minutes, maxMinutes, label }   minutes is 0 when nothing is left.
function openWindow(args) {
  const { date, time, appointments = [], excludeId = null } = args;
  const taken = appointments
    .filter(a => a.date === date && a.status === 'APPROVED' && String(a._id) !== String(excludeId))
    .map(a => { const as = timeToMinutes(a.time); return [as, as + (Number(a.duration) || 60)]; });
  let s = timeToMinutes(time);
  for (let moved = true; moved;) {
    moved = false;
    for (const [bs, be] of taken) if (s >= bs && s < be) { s = be; moved = true; }
  }
  return availableWindow({ ...args, time: toHHMM(s) });
}

module.exports = {
  MAX_CONSULT_MINUTES, VACANT_START, VACANT_END, OPERATING_START, OPERATING_LAST_START, OPERATING_LAST_END, splitIntoSlots, buildSlots, buildBusy, insideBookableHours, insideConsultHours, maxDurationAt, availableWindow, openWindow, consultRuns, dayOfWeekOf, addDays, overlaps,
};
