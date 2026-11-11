// Phase 4 of the Faculty Schedule PDF Importer: turn the OCR draft into rows a person can review, and check them against
// the plan's rules (section 7). Pure functions, no database and no file access: the route loads the appointments and passes them in.
// Nothing here activates a schedule. A draft that passes is only "ready to confirm" (confirmation and replacement come in a later phase).
//
// Input contract = what backend/ocr/schedule_extractor.py writes (draft JSON): { parserVersion, document, classes[], consultationHours[],
// warnings[], status }. If the OCR output changes shape, only fromOcrDraft() needs to change.

const { validateClassBlock, FIRST_MINUTE, LAST_MINUTE, STEP } = require('./classBlock');
const { isConsultationDay, parseDay } = require('./daySettings');
const { timeToMinutes } = require('./timeMath');

const REQUIRED_WEEKLY_CONSULT_MINUTES = 240; // the existing rule in routes/faculty.js: exactly 4 hours a week
const MAX_ROWS = 200;                        // a real load has about 15 rows; this only stops absurd uploads
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const clean = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const fmt12 = (t) => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };
const where = (r) => `${DAY_NAMES[r.dayOfWeek] || 'Unknown day'} ${TIME_RE.test(r.startTime) ? fmt12(r.startTime) : r.startTime || '?'}`;

// The class a Schedule record stores: subject and section live in one text field ("LIS 6 (BLIS 2-A)").
const subjectWithSection = (subject, section) => {
  const s = clean(subject, 100), sec = clean(section, 40);
  return sec && !s.toLowerCase().includes(sec.toLowerCase()) ? `${s} (${sec})`.slice(0, 100) : s;
};

// Draft JSON -> editable rows. Weekend consultation entries are left out with a warning (they are never allowed).
function fromOcrDraft(draft, { keepWeekendConsultations = false } = {}) {
  if (!draft || typeof draft !== 'object' || !Array.isArray(draft.classes) || !Array.isArray(draft.consultationHours)) {
    return { error: 'This is not a schedule draft (it needs "classes" and "consultationHours" lists).' };
  }
  if (draft.classes.length + draft.consultationHours.length > MAX_ROWS) return { error: `The draft has too many rows (more than ${MAX_ROWS}).` };

  const warnings = [];
  const row = (r, id, extra) => ({
    id, dayOfWeek: parseDay(r && r.dayOfWeek), startTime: clean(r && r.startTime, 5), endTime: clean(r && r.endTime, 5),
    confidence: Number.isFinite(r && r.confidence) ? r.confidence : null,
    needsReview: Boolean(r && r.needsReview), reviewReasons: Array.isArray(r && r.reviewReasons) ? r.reviewReasons.map(x => clean(x, 200)) : [],
    rawText: clean(r && r.rawText, 300), ...extra,
  });
  const classes = draft.classes.map((c, i) => row(c, `c${i + 1}`, { subject: clean(c && c.subject, 100), section: clean(c && c.section, 40), room: clean(c && c.room, 60) }));
  const all = draft.consultationHours.map((h, i) => row(h, `h${i + 1}`, { label: clean(h && h.label, 80) }));

  // The first read of an OCR draft leaves weekend consultations out (with a warning). When re-checking rows a browser sent back,
  // they are kept so validateDraft reports them as errors instead of silently dropping them.
  const isWeekend = (h) => h.dayOfWeek === 0 || h.dayOfWeek === 6;
  const weekend = keepWeekendConsultations ? [] : all.filter(isWeekend);
  const consultationHours = keepWeekendConsultations ? all : all.filter(h => !isWeekend(h));
  if (weekend.length) {
    warnings.push({ code: 'WEEKEND_CONSULTATION_EXCLUDED', severity: 'warning',
      message: `Weekend consultation entries detected and excluded (${weekend.map(where).join(', ')}). Consultations are not available on Saturday or Sunday.` });
  }
  // Carry the OCR's own warnings. The faculty-identity one is turned into a blocking check in validateDraft.
  for (const w of Array.isArray(draft.warnings) ? draft.warnings : []) {
    if (w && w.code !== 'FACULTY_IDENTITY') warnings.push({ code: clean(w.code, 40) || 'OCR', severity: 'warning', message: clean(w.message, 300) });
  }
  const d = draft.document || {};
  return {
    parserVersion: clean(draft.parserVersion, 40),
    document: {
      term: clean(d.term, 60), academicYear: clean(d.academicYear, 30), effectivityDate: clean(d.effectivityDate, 30),
      facultyNameHint: clean(d.facultyNameHint, 80),
    },
    classes, consultationHours, excludedWeekendConsultations: weekend.length, warnings,
  };
}

// A row exactly as the Schedule model stores it.
const toScheduleRecord = (c) => ({ dayOfWeek: c.dayOfWeek, startTime: c.startTime, endTime: c.endTime, subject: subjectWithSection(c.subject, c.section), room: clean(c.room, 60) });

// Checks the (possibly edited) rows. Returns { ok, errors[], warnings[], summary }.
//   errors   block confirmation; each points at a row by id ("ref") so the screen can mark it.
//   warnings need a look but do not block.
// options: identityConfirmed (the person confirmed the faculty is the selected account), approved / pending (appointments of that
// faculty dated today or later), requireFourHours (default true, plan section 7; set false to downgrade it to a warning).
function validateDraft({ classes = [], consultationHours = [] }, { identityConfirmed = false, approved = [], pending = [], requireFourHours = true } = {}) {
  const errors = [], warnings = [];
  const err = (code, message, ref) => errors.push({ code, message, ref: ref || null });
  const warn = (code, message, ref) => warnings.push({ code, message, ref: ref || null });

  if (!identityConfirmed) err('IDENTITY_NOT_CONFIRMED', 'Confirm that this document belongs to the selected faculty account. The name on the form is covered by a signature, so it cannot be checked automatically.');

  // Teaching classes: the same rules as adding a class by hand (subject, room, day, 30-minute grid, 7 AM-7 PM, overlaps, approved consultations)
  const record = classes.map(c => ({ c, rec: toScheduleRecord(c) }));
  for (const { c, rec } of record) {
    const siblings = record.filter(o => o.c.id !== c.id).map(o => o.rec);
    const r = validateClassBlock(rec, siblings, approved);
    if (!r.ok) err('CLASS_INVALID', `${where(rec)}: ${r.error}`, { type: 'class', id: c.id });
    if (c.needsReview) warn('REVIEW_ROW', `${where(rec)}: ${c.reviewReasons.join(' ') || 'Check this row against the scan.'}`, { type: 'class', id: c.id });
  }

  // Official consultation hours: Monday-Friday, 30-minute grid, 7 AM-7 PM, no overlap with each other or with a class
  const hoursRows = consultationHours.map(h => ({ h, day: Number(h.dayOfWeek) }));
  for (const { h } of hoursRows) {
    const ref = { type: 'consult', id: h.id }, at = where(h);
    if (!isConsultationDay(h.dayOfWeek)) { err('CONSULT_DAY', `${at}: consultation hours are only available Monday to Friday.`, ref); continue; }
    if (!TIME_RE.test(h.startTime) || !TIME_RE.test(h.endTime)) { err('CONSULT_TIME', `${at}: start and end must be times like 09:30.`, ref); continue; }
    const s = timeToMinutes(h.startTime), e = timeToMinutes(h.endTime);
    if (s % STEP || e % STEP) err('CONSULT_TIME', `${at}: times must be on the hour or half hour.`, ref);
    else if (s < FIRST_MINUTE || e > LAST_MINUTE) err('CONSULT_RANGE', `${at}: consultation hours must fall between 7:00 AM and 7:00 PM.`, ref);
    else if (e <= s) err('CONSULT_ORDER', `${at}: the end time must be after the start time.`, ref);
    if (h.needsReview) warn('REVIEW_ROW', `${at}: ${h.reviewReasons.join(' ') || 'Check this row against the scan.'}`, ref);
  }
  const okHours = hoursRows.filter(({ h }) => isConsultationDay(h.dayOfWeek) && TIME_RE.test(h.startTime) && TIME_RE.test(h.endTime));
  const overlap = (a, b) => a.dayOfWeek === b.dayOfWeek && timeToMinutes(a.startTime) < timeToMinutes(b.endTime) && timeToMinutes(b.startTime) < timeToMinutes(a.endTime);
  okHours.forEach(({ h }, i) => {
    okHours.slice(i + 1).forEach(({ h: o }) => { if (overlap(h, o)) err('CONSULT_OVERLAP', `${where(h)}: overlaps another consultation block.`, { type: 'consult', id: h.id }); });
    record.forEach(({ c, rec }) => { if (overlap(h, rec)) err('CONSULT_CLASS_OVERLAP', `${where(h)}: overlaps the class "${rec.subject}".`, { type: 'consult', id: h.id }); });
  });

  // Weekly total
  const totalMinutes = okHours.reduce((sum, { h }) => sum + Math.max(0, timeToMinutes(h.endTime) - timeToMinutes(h.startTime)), 0);
  if (totalMinutes !== REQUIRED_WEEKLY_CONSULT_MINUTES) {
    const msg = `Official consultation hours must total exactly 4 hours a week. This draft has ${(totalMinutes / 60).toFixed(1)}.`;
    if (requireFourHours) err('CONSULT_TOTAL', msg); else warn('CONSULT_TOTAL', msg);
  }

  // Pending requests that a class would sit on top of: review only, never cancelled or moved automatically
  for (const { c, rec } of record) {
    const dow = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();
    const hit = pending.filter(p => dow(p.date) === rec.dayOfWeek && TIME_RE.test(rec.startTime) && timeToMinutes(rec.startTime) < timeToMinutes(p.time) + (Number(p.duration) || 60) && timeToMinutes(p.time) < timeToMinutes(rec.endTime));
    if (hit.length) warn('PENDING_OVERLAP', `${where(rec)}: ${hit.length} pending request(s) fall in this class time. They will not be changed automatically.`, { type: 'class', id: c.id });
  }

  return {
    ok: errors.length === 0, errors, warnings,
    summary: { classBlocks: classes.length, consultationBlocks: consultationHours.length, weeklyConsultationMinutes: totalMinutes, errorCount: errors.length, warningCount: warnings.length },
  };
}

// Who may import for whom. Faculty: only their own account. Admin: any faculty account. Dean and Student: never.
// Returns 'self' | 'admin' | null. (The route still checks that an admin's target really is a FACULTY account.)
function importAccess(user, facultyId) {
  if (!user || !facultyId) return null;
  if (user.role === 'ADMIN') return 'admin';
  if (user.role === 'FACULTY' && String(user.userId) === String(facultyId)) return 'self';
  return null;
}

module.exports = { importAccess, fromOcrDraft, validateDraft, toScheduleRecord, subjectWithSection, REQUIRED_WEEKLY_CONSULT_MINUTES, MAX_ROWS };
