// Pure slot logic (no database) so it can be unit-tested.
// A "slot" is one bookable piece of a consultation-hours block: 1 hour, or the shorter
// remainder when a block isn't a whole number of hours (e.g. 9:30-11:00 -> 9:30-10:30, 10:30-11:00).

const { timeToMinutes } = require('./timeMath');

const MAX_PENDING_PER_SLOT = 3;
const OPERATING_START = 450; // 7:30 AM: same limits the booking form always had
const OPERATING_LAST_START = 960; // 4:00 PM

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
    if (dow === 0) continue; // no Sunday consultations

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
          kind: block.kind, pending: open.pending, full: open.pending >= MAX_PENDING_PER_SLOT,
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
          kind: 'VACANT', pending: open.pending, full: open.pending >= MAX_PENDING_PER_SLOT,
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
    if (dow === 0) continue;
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

module.exports = {
  MAX_PENDING_PER_SLOT, MAX_CONSULT_MINUTES, VACANT_START, VACANT_END, splitIntoSlots, buildSlots, buildBusy, insideBookableHours, insideConsultHours, maxDurationAt, consultRuns, dayOfWeekOf, addDays, overlaps,
};
