// Works out a faculty member's status at a given moment.
// Pure: no database, no clock. Callers pass in the data and "now" (a Date).
//
// Scheduled statuses (never set by hand):  IN_CLASS, IN_CONSULTATION, CONSULTATION_HOURS, VACANT
// Manual statuses (set by faculty, always with an end time):  IN_MEETING, ON_BREAK, OUT_OF_OFFICE, ON_LEAVE
//
// Precedence, highest first:
//   active manual status > IN_CONSULTATION > IN_CLASS > CONSULTATION_HOURS > VACANT
//
// Scheduled day window: VACANT only exists from 7:00 AM until the end of that day's last class or
// consultation-hours block (whichever ends later). Outside it, and on a day with no blocks at all, the
// scheduled status is NONE, shown as "--". A manual status still shows whenever it is active.

const { manilaNow, manilaDate } = require('./manilaTime');

const MANUAL_STATUSES = ['IN_MEETING', 'ON_BREAK', 'OUT_OF_OFFICE', 'ON_LEAVE'];
const SCHEDULED_STATUSES = ['IN_CLASS', 'IN_CONSULTATION', 'CONSULTATION_HOURS', 'VACANT', 'NONE'];
// Vacant starts at 7:00 AM (minutes after midnight).
const DAY_WINDOW_START_MIN = 7 * 60;
// Manual statuses that stop students from booking inside their window.
const BOOKING_BLOCKING = ['IN_MEETING', 'ON_LEAVE'];

const STATUS_LABELS = {
  IN_CLASS: 'In Class',
  IN_CONSULTATION: 'In Consultation',
  CONSULTATION_HOURS: 'Consultation Hours',
  VACANT: 'Vacant',
  NONE: '--', // outside the scheduled day window: no scheduled status
  IN_MEETING: 'In a Meeting',
  ON_BREAK: 'On Break',
  OUT_OF_OFFICE: 'Out of Office',
  ON_LEAVE: 'On Leave',
};

// Reasons offered in the Post a Notice dropdown. "Other" asks for one short text.
const NOTICE_REASONS = {
  IN_MEETING: ['Faculty meeting', 'Department meeting', 'Seminar / training', 'Official school activity', 'Other'],
  ON_LEAVE: ['Sick leave', 'Vacation leave', 'Official business', 'Emergency', 'Study leave', 'Other'],
};

const toMinutes = (t) => {
  if (!t || typeof t !== 'string') return 0;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

const covers = (b, nowMin) => toMinutes(b.startTime) <= nowMin && nowMin < toMinutes(b.endTime);
// The day's scheduled window ends when the later of the last class and the last consultation-hours block ends.
// Returns minutes after midnight, or null when the day has no blocks.
function dayWindowEndMin(classBlocks = [], consultBlocks = []) {
  const ends = [...classBlocks, ...consultBlocks].map((b) => toMinutes(b.endTime)).filter((n) => n > 0);
  return ends.length ? Math.max(...ends) : null;
}
const asDate = (d) => (d instanceof Date ? d : new Date(d));

// An entry is active when startAt <= now < endAt.
function isActive(entry, now) {
  return asDate(entry.startAt) <= now && now < asDate(entry.endAt);
}

// Date at which a same-day block ends, for the "until" text.
function blockEnd(block, now) {
  return manilaDate(manilaNow(now).dateStr, block.endTime);
}

/**
 * @param {object} input
 * @param {Array}  input.entries        manual status entries ({ type, startAt, endAt, reason })
 * @param {Array}  input.classBlocks    today's classes ({ startTime, endTime, room })
 * @param {Array}  input.consultBlocks  today's consultation hours ({ startTime, endTime })
 * @param {boolean} input.hasBooking    true while an accepted consultation is running right now
 * @param {Date}   now
 * @returns {{ status, label, until: Date|null, source: 'manual'|'scheduled', reason? }}
 */
function resolveFacultyStatus(input, now = new Date()) {
  const { entries = [], classBlocks = [], consultBlocks = [], hasBooking = false } = input || {};
  const nowMin = toMinutes(manilaNow(now).hhmm);

  // 1. Manual: if several are active, the one that ends last wins (leave beats a short break).
  const active = entries
    .filter((e) => MANUAL_STATUSES.includes(e.type) && isActive(e, now))
    .sort((a, b) => asDate(b.endAt) - asDate(a.endAt))[0];
  if (active) {
    return {
      status: active.type, label: STATUS_LABELS[active.type], until: asDate(active.endAt),
      entryId: active._id ? String(active._id) : null, source: 'manual', reason: active.reason || '',
    };
  }

  // 2. Scheduled
  const consultNow = consultBlocks.find((b) => covers(b, nowMin));
  const classNow = classBlocks.find((b) => covers(b, nowMin));

  if (hasBooking) {
    return { status: 'IN_CONSULTATION', label: STATUS_LABELS.IN_CONSULTATION, until: consultNow ? blockEnd(consultNow, now) : null, source: 'scheduled' };
  }
  if (classNow) {
    return { status: 'IN_CLASS', label: STATUS_LABELS.IN_CLASS, until: blockEnd(classNow, now), source: 'scheduled' };
  }
  if (consultNow) {
    return { status: 'CONSULTATION_HOURS', label: STATUS_LABELS.CONSULTATION_HOURS, until: blockEnd(consultNow, now), source: 'scheduled' };
  }
  // Nothing running now. Vacant only inside the scheduled day window (7:00 AM to the end of the last block).
  const endMin = dayWindowEndMin(classBlocks, consultBlocks);
  if (endMin !== null && nowMin >= DAY_WINDOW_START_MIN && nowMin < endMin) {
    return { status: 'VACANT', label: STATUS_LABELS.VACANT, until: null, source: 'scheduled' };
  }
  return { status: 'NONE', label: STATUS_LABELS.NONE, until: null, source: 'scheduled' };
}

/**
 * Validates a new manual entry. Returns { ok: true } or { ok: false, error }.
 * existing = the faculty's other not-yet-ended entries.
 */
function validateEntry(entry, existing = [], now = new Date(), opts = {}) {
  if (!MANUAL_STATUSES.includes(entry.type)) return { ok: false, error: 'Choose a valid status.' };
  const start = asDate(entry.startAt);
  const end = asDate(entry.endAt);
  if (isNaN(start) || isNaN(end)) return { ok: false, error: 'Choose a valid start and end.' };
  if (end <= start) return { ok: false, error: 'The end must be after the start.' };
  if (end <= now) return { ok: false, error: 'The end time has already passed.' };

  const reasons = NOTICE_REASONS[entry.type];
  if (reasons && opts.requireReason !== false) {
    if (!entry.reason || !reasons.includes(entry.reason)) return { ok: false, error: 'Choose a reason.' };
    if (entry.reason === 'Other' && !String(entry.reasonOther || '').trim()) return { ok: false, error: 'Please type the reason for "Other".' };
  }
  const clash = existing.find((e) => asDate(e.startAt) < end && start < asDate(e.endAt));
  if (clash) return { ok: false, error: 'This overlaps another status you already set. Clear it first.' };
  return { ok: true };
}

/** Does this meeting/leave window block a booking at [bookStart, bookEnd)? */
function blocksBooking(entries, bookStart, bookEnd) {
  return entries.find((e) => BOOKING_BLOCKING.includes(e.type) && asDate(e.startAt) < bookEnd && bookStart < asDate(e.endAt)) || null;
}

/** Removes bookable slots ({ date, start, end }) that fall inside a meeting or leave window. */
function dropBlockedSlots(slots, entries) {
  const blocking = entries.filter((e) => BOOKING_BLOCKING.includes(e.type));
  if (!blocking.length) return slots;
  return slots.filter((s) => !blocksBooking(blocking, manilaDate(s.date, s.start), manilaDate(s.date, s.end)));
}

module.exports = {
  dropBlockedSlots, MANUAL_STATUSES, SCHEDULED_STATUSES, BOOKING_BLOCKING, STATUS_LABELS, NOTICE_REASONS, DAY_WINDOW_START_MIN, dayWindowEndMin,
  resolveFacultyStatus, validateEntry, blocksBooking,
};
