// Phase 4 of the Faculty Schedule PDF Importer: turn the OCR draft into rows a person can review, and check them against
// the plan's rules (section 7). Pure functions, no database and no file access: the route loads the appointments and passes them in.
// Nothing here activates a schedule. A draft that passes is only "ready to confirm" (confirmation and replacement come in a later phase).
//
// Input contract = what ocr/schedule_ocr.py writes (draft JSON, example: ocr/fixtures/percy.extracted.json): { parserVersion, status,
// metadata{ term, academicYear, effectivityDate, facultyName, facultyNameConfidence, facultyNameNeedsReview }, workload{}, classes[] (with
// flags[] and confidence), consultationHours[], warnings[] }. If the OCR output changes shape, only fromOcrDraft() needs to change.

const { validateClassBlock, FIRST_MINUTE, LAST_MINUTE, STEP } = require('./classBlock');
const { isConsultationDay, parseDay } = require('./daySettings');
const { timeToMinutes } = require('./timeMath');

const REQUIRED_WEEKLY_CONSULT_MINUTES = 240; // the existing rule in routes/faculty.js: exactly 4 hours a week
const LOW_CONFIDENCE = 75;                   // a block read below this is flagged for a second look
const NAME_TRUST = 90;                       // the printed name is trusted only at or above this confidence (and not flagged by the OCR)
const MAX_ROWS = 200;                        // a real load has about 15 rows; this only stops absurd uploads
const TITLES = new Set(['MIT', 'MSIT', 'MS', 'MBA', 'MAED', 'DIT', 'LPT', 'PHD', 'DBA', 'EDD', 'DR', 'MR', 'MRS', 'ENGR', 'PROF']);
const FLAG_TEXT = {
  'room-prefix-check': 'The room starts with "ICT": the scan may have misread "IICT". Check it against the scan.',
  'low-confidence': 'Low OCR confidence. Check this row against the scan.',
};
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const clean = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const fmt12 = (t) => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };
const where = (r) => `${DAY_NAMES[r.dayOfWeek] || 'Unknown day'} ${TIME_RE.test(r.startTime) ? fmt12(r.startTime) : r.startTime || '?'}`;

// Compare a printed name with the account's name. Case, punctuation, titles and middle initials are ignored; every word of the shorter
// name must appear in the longer one. Returns 'match' | 'mismatch' | 'unknown' (nothing to compare).
const nameTokens = (n) => String(n || '').toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/).filter(t => t.length > 1 && !TITLES.has(t));
function compareNames(read, account) {
  const a = nameTokens(read), b = nameTokens(account);
  if (!a.length || !b.length) return 'unknown';
  const A = new Set(a), B = new Set(b);
  const [small, big] = A.size <= B.size ? [A, B] : [B, A];
  return [...small].every(t => big.has(t)) ? 'match' : 'mismatch';
}

// Is the name the OCR read good enough to compare? A garbled read (a signature over the name) is NOT a mismatch: it is unreadable, and a
// person confirms it. Only a clear read that names someone else is a mismatch.
//   -> { status: 'match' | 'mismatch' | 'unreadable', read }
function identityOf(metadata, accountName) {
  const m = metadata || {};
  const trusted = Number(m.facultyNameConfidence) >= NAME_TRUST && !m.facultyNameNeedsReview && nameTokens(m.facultyName).length > 0;
  if (!trusted) return { status: 'unreadable', read: m.facultyName || '' };
  const cmp = compareNames(m.facultyName, accountName);
  return { status: cmp === 'unknown' ? 'unreadable' : cmp, read: m.facultyName };
}

// The class a Schedule record stores: subject and section live in one text field ("LIS 6 (BLIS 2-A)").
const subjectWithSection = (subject, section) => {
  const s = clean(subject, 100), sec = clean(section, 40);
  return sec && !s.toLowerCase().includes(sec.toLowerCase()) ? `${s} (${sec})`.slice(0, 100) : s;
};

// Draft JSON -> editable rows. Weekend consultation entries are left out with a warning (they are never allowed).
function fromOcrDraft(draft, { keepWeekendConsultations = false } = {}) {
  // The OCR reports an unrecognised layout as { status: 'FAILED', error } with no rows: say so before complaining about the shape
  if (draft && typeof draft === 'object' && draft.status === 'FAILED') return { error: `This PDF could not be read as a Faculty Individual Load form (${clean(draft.error, 160) || 'layout not recognised'}). Upload the scanned one-page form.` };
  if (!draft || typeof draft !== 'object' || !Array.isArray(draft.classes) || !Array.isArray(draft.consultationHours)) {
    return { error: 'This is not a schedule draft (it needs "classes" and "consultationHours" lists).' };
  }
  if (draft.classes.length + draft.consultationHours.length > MAX_ROWS) return { error: `The draft has too many rows (more than ${MAX_ROWS}).` };

  const warnings = [];
  const row = (r, id, extra) => {
    const confidence = Number.isFinite(r && r.confidence) ? r.confidence : null;
    const flags = Array.isArray(r && r.flags) ? r.flags.map(f => clean(f, 40)).filter(Boolean) : [];
    if (confidence !== null && confidence < LOW_CONFIDENCE && !flags.includes('low-confidence')) flags.push('low-confidence');
    return {
      id, dayOfWeek: parseDay(r && r.dayOfWeek), startTime: clean(r && r.startTime, 5), endTime: clean(r && r.endTime, 5),
      confidence, flags, needsReview: Boolean(r && r.needsReview) || flags.length > 0,
      reviewReasons: flags.map(f => FLAG_TEXT[f] || f),
      rawText: clean(r && r.rawText, 300), ...extra,
    };
  };
  const classes = draft.classes.map((c, i) => row(c, `c${i + 1}`, { subject: clean((c && (c.courseTitle || c.subject)), 100), section: clean(c && c.section, 40), room: clean(c && c.room, 60) }));
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
  // Carry the OCR's own warnings. Its faculty-name one is replaced by the identity check in validateDraft.
  for (const w of Array.isArray(draft.warnings) ? draft.warnings : []) {
    if (w && w.code !== 'faculty-name-needs-review') warnings.push({ code: clean(w.code, 40) || 'ocr-warning', severity: 'warning', message: clean(w.message, 300) });
  }
  const md = draft.metadata || {}, wl = draft.workload || {};
  const num = (v) => (Number.isFinite(v) ? v : null);
  return {
    parserVersion: clean(draft.parserVersion, 40),
    metadata: {
      formId: clean(md.formId, 30), term: clean(md.term, 60), academicYear: clean(md.academicYear, 30), effectivityDate: clean(md.effectivityDate, 30),
      facultyName: clean(md.facultyName, 120), facultyNameConfidence: num(md.facultyNameConfidence), facultyNameNeedsReview: Boolean(md.facultyNameNeedsReview),
    },
    workload: { lectureHours: num(wl.lectureHours), laboratoryHours: num(wl.laboratoryHours) },
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
function validateDraft({ classes = [], consultationHours = [], metadata = {}, workload = {} }, { identityConfirmed = false, targetName = '', approved = [], pending = [], requireFourHours = true } = {}) {
  const errors = [], warnings = [];
  const err = (code, message, ref) => errors.push({ code, message, ref: ref || null });
  const warn = (code, message, ref) => warnings.push({ code, message, ref: ref || null });

  // Identity: a clear read of the printed name must match the selected account; an unreadable one (signature over it) needs a person to confirm.
  const identity = identityOf(metadata, targetName);
  if (identity.status === 'mismatch') {
    err('IDENTITY_MISMATCH', `The printed name "${identity.read}" does not match the selected account "${targetName}". Choose the right faculty account or a different document.`);
  } else if (identity.status === 'unreadable' && !identityConfirmed) {
    err('IDENTITY_NOT_CONFIRMED', 'The printed faculty name is missing, low-confidence or covered by a signature, so it cannot be checked automatically. Compare the scan with the selected account and confirm it belongs to them.');
  }
  for (const k of ['term', 'academicYear', 'effectivityDate']) {
    if (!metadata[k]) warn('METADATA_MISSING', `${k === 'academicYear' ? 'Academic year' : k === 'effectivityDate' ? 'Effectivity date' : 'Term'} was not read from the document. Enter it when confirming.`);
  }

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

  // Workload cross-check: the teaching hours in the blocks should equal lecture + laboratory hours printed on the sheet
  const teachingHours = record.reduce((n, { rec }) => (TIME_RE.test(rec.startTime) && TIME_RE.test(rec.endTime) ? n + Math.max(0, timeToMinutes(rec.endTime) - timeToMinutes(rec.startTime)) : n), 0) / 60;
  if (Number.isFinite(workload.lectureHours) && Number.isFinite(workload.laboratoryHours) && Math.abs(teachingHours - (workload.lectureHours + workload.laboratoryHours)) > 0.01) {
    warn('WORKLOAD_MISMATCH', `The teaching blocks add up to ${teachingHours} hours but the sheet says ${workload.lectureHours + workload.laboratoryHours} (lecture + laboratory).`);
  }

  return {
    ok: errors.length === 0, errors, warnings, identity,
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

module.exports = { importAccess, compareNames, identityOf, fromOcrDraft, validateDraft, toScheduleRecord, subjectWithSection, REQUIRED_WEEKLY_CONSULT_MINUTES, MAX_ROWS };
