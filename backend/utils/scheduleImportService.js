// Phase 6: the rules for APPLYING a confirmed import, kept apart from Express and Mongoose so they can be tested.
// Nothing here trusts the browser: the rows are cleaned and validated again, against the faculty's appointments as they are NOW.

const { fromOcrDraft, validateDraft, toScheduleRecord } = require('./scheduleDraft');
const { validateClassBlock } = require('./classBlock');
const { fingerprint, replaceSchedule } = require('./scheduleSwap');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (dateStr, n) => new Date(Date.parse(`${dateStr}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

// Effectivity date: a real calendar date, not older than a year (an old sheet is probably the wrong file) and not more than a year ahead.
function checkEffectivityDate(value, today) {
  if (typeof value !== 'string' || !DATE_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    return { ok: false, error: 'Enter the effectivity date as a real date (YYYY-MM-DD).' };
  }
  if (value < addDays(today, -366)) return { ok: false, error: 'That effectivity date is more than a year in the past. Check that this is the right sheet.' };
  if (value > addDays(today, 366)) return { ok: false, error: 'That effectivity date is more than a year away.' };
  return { ok: true, startsNow: value <= today };
}

// Cleans + validates stored rows again. Weekend consultation rows are kept so they stay blocking errors, as in /validate.
function revalidate({ classes, consultationHours, metadata, workload }, { identityConfirmed, targetName, approved, pending }) {
  const rows = fromOcrDraft({ classes, consultationHours, metadata, workload }, { keepWeekendConsultations: true });
  if (rows.error) return { ok: false, errors: [{ code: 'BAD_DRAFT', message: rows.error }], warnings: [], rows: null };
  const report = validateDraft(rows, { identityConfirmed, targetName, approved, pending });
  return { ...report, rows };
}

// Applies an already-validated import to the faculty's real schedule.
//   store              see scheduleSwap.js
//   enforceBase        true when confirming now: refuse if the schedule changed after the preview (compared by fingerprint)
// Returns { ok: true, snapshot, counts } or { ok: false, code, message }.
async function applyImport({ facultyId, classes, consultationHours, baseFingerprint }, { store, enforceBase }) {
  if (enforceBase) {
    const cur = await store.load(facultyId);
    if (!baseFingerprint || fingerprint(cur.classes, cur.hours) !== baseFingerprint) {
      return { ok: false, code: 'STALE', message: 'This faculty\'s schedule changed after the preview was made. Upload or check the file again so you review the current schedule.' };
    }
  }
  try {
    const r = await replaceSchedule(store, facultyId, classes.map(toScheduleRecord), consultationHours.map(h => ({ dayOfWeek: Number(h.dayOfWeek), startTime: h.startTime, endTime: h.endTime })));
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, code: e.code || 'APPLY_FAILED', message: e.message };
  }
}

// Undoing an import: the old classes must still be allowed (an appointment approved since then may now sit inside one of them).
function checkRestore(snapshot, approved) {
  const siblings = [];
  for (const c of snapshot.classes) {
    const r = validateClassBlock(c, siblings, approved);
    if (!r.ok) return { ok: false, message: `Cannot restore the previous schedule: ${r.error}` };
    siblings.push(r.value);
  }
  return { ok: true };
}

module.exports = { checkEffectivityDate, revalidate, applyImport, checkRestore, addDays };
