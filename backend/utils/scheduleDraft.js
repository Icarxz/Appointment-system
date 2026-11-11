// Phase 4 of the Faculty Schedule PDF Importer: turns an OCR draft (ocr/schedule_ocr.py) into a REVIEW REPORT.
// Pure: no database, no OCR. It never activates anything; it only says what is blocking and what needs a look.
// The rules come from the plan (section 7) and reuse the ones the app already enforces:
//   - every teaching block passes validateClassBlock (day 0-6, 07:00-19:00, 30-min grid, subject+room, same-day overlaps,
//     approved future consultations),
//   - official consultation hours total exactly 4 hours and may not overlap a class (POST /consultation-hours),
//   - the printed faculty name must match the selected account, otherwise nothing can be confirmed.
// A pending request that overlaps a class is only a WARNING (never auto-cancelled or moved).

const { validateClassBlock } = require('./classBlock');
const { timeToMinutes } = require('./timeMath');

const REQUIRED_CONSULT_MINUTES = 240;
const LOW_CONFIDENCE = 75;
const NAME_TRUST = 90;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TITLES = new Set(['MIT', 'MSIT', 'MS', 'MBA', 'MAED', 'DIT', 'LPT', 'PHD', 'DBA', 'EDD', 'DR', 'MR', 'MS.', 'MRS', 'ENGR', 'PROF']);

// Compare names conservatively: case, punctuation, titles and middle initials are ignored; a different surname or first
// name is a mismatch. Returns 'match' | 'mismatch' | 'unknown' (nothing to compare).
const nameTokens = (s) => String(s || '').toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/).filter(t => t.length > 1 && !TITLES.has(t));
function compareNames(extracted, accountName) {
  const a = nameTokens(extracted), b = nameTokens(accountName);
  if (!a.length || !b.length) return 'unknown';
  const A = new Set(a), B = new Set(b);
  // every word of the shorter name must appear in the longer one ("CARL SPENCE PERCY" vs "Percy, Carl Spence D.")
  const [small, big] = A.size <= B.size ? [A, B] : [B, A];
  return [...small].every(t => big.has(t)) ? 'match' : 'mismatch';
}

const issue = (code, message, extra = {}) => ({ code, message, ...extra });
const label = (b) => `${DAY_NAMES[b.dayOfWeek]} ${b.startTime}-${b.endTime}`;

// draft: parsed JSON of schedule_ocr.py, possibly edited by the reviewer (same shape).
// options: { target: { name }, approved: [{ date, time, duration }], pending: [{ date, time, duration }],
//            nameVerifiedByReviewer: boolean }
function reviewScheduleDraft(draft, options = {}) {
  const { target = {}, approved = [], pending = [], nameVerifiedByReviewer = false } = options;
  const blocking = [], warnings = [];
  if (!draft || draft.status === 'FAILED' || !Array.isArray(draft.classes) || !Array.isArray(draft.consultationHours)) {
    return { canConfirm: false, blocking: [issue('unsupported-document', (draft && draft.error) || 'The document could not be read as a Faculty Individual Load.')], warnings, classes: [], consultationHours: [] };
  }

  // ---- identity ----
  const md = draft.metadata || {};
  const cmp = compareNames(md.facultyName, target.name);
  if (cmp === 'mismatch') {
    blocking.push(issue('identity-mismatch', `The printed name "${md.facultyName}" does not match the selected account "${target.name}".`));
  } else if (!nameVerifiedByReviewer && (cmp === 'unknown' || md.facultyNameNeedsReview || !(md.facultyNameConfidence >= NAME_TRUST))) {
    blocking.push(issue('identity-unverified', 'The printed faculty name is missing, low-confidence or covered by a signature. A person must confirm it belongs to the selected account.'));
  }
  for (const k of ['term', 'academicYear', 'effectivityDate']) {
    if (!md[k]) warnings.push(issue('metadata-missing', `${k} was not read from the document.`, { field: k }));
  }

  // ---- teaching blocks (each one goes through the same rules as the manual editor) ----
  const classes = [];
  const accepted = [];
  draft.classes.forEach((raw, index) => {
    const res = validateClassBlock(raw, accepted, approved);
    const flags = Array.isArray(raw.flags) ? raw.flags : [];
    const entry = { index, ...raw, errors: [], warnings: [] };
    if (!res.ok) {
      entry.errors.push(res.error);
      blocking.push(issue('invalid-class', `${label(raw)}: ${res.error}`, { index }));
    } else {
      accepted.push(res.value);
    }
    if (typeof raw.confidence === 'number' && raw.confidence < LOW_CONFIDENCE) flags.includes('low-confidence') || flags.push('low-confidence');
    for (const f of flags) {
      entry.warnings.push(f);
      warnings.push(issue('review-field', `${label(raw)} (${raw.subject || 'no subject'}): ${f}`, { index, flag: f }));
    }
    classes.push(entry);
  });

  // ---- consultation hours ----
  const consults = draft.consultationHours.map((c, index) => ({ index, ...c, errors: [] }));
  let total = 0;
  for (const c of consults) {
    const s = timeToMinutes(c.startTime), e = timeToMinutes(c.endTime);
    if (!(e > s) || s % 30 || e % 30 || s < 7 * 60 || e > 19 * 60 || !(c.dayOfWeek >= 0 && c.dayOfWeek <= 6)) {
      c.errors.push('Invalid day or time.');
      blocking.push(issue('invalid-consultation', `Consultation ${label(c)} is outside Sunday-Saturday, 7:00 AM-7:00 PM on the 30-minute grid.`, { index: c.index }));
      continue;
    }
    total += e - s;
    const clash = accepted.find(k => k.dayOfWeek === c.dayOfWeek && s < timeToMinutes(k.endTime) && timeToMinutes(k.startTime) < e);
    if (clash) blocking.push(issue('consultation-overlaps-class', `Consultation ${label(c)} overlaps ${clash.subject}.`, { index: c.index }));
  }
  if (total !== REQUIRED_CONSULT_MINUTES) {
    blocking.push(issue('consultation-total', `Official consultation hours must total exactly 4 hours per week; the document has ${(total / 60).toFixed(1)}.`));
  }

  // ---- pending requests that would sit inside a class: review only ----
  for (const p of pending) {
    const day = new Date(`${p.date}T00:00:00Z`).getUTCDay();
    const ps = timeToMinutes(p.time), pe = ps + (Number(p.duration) || 60);
    const hit = accepted.find(k => k.dayOfWeek === day && ps < timeToMinutes(k.endTime) && timeToMinutes(k.startTime) < pe);
    if (hit) warnings.push(issue('pending-overlap', `A pending request on ${p.date} at ${p.time} overlaps ${hit.subject}. It will not be cancelled or moved automatically.`, { date: p.date }));
  }

  // ---- workload cross-check ----
  const w = draft.workload || {};
  const hours = accepted.reduce((n, k) => n + (timeToMinutes(k.endTime) - timeToMinutes(k.startTime)), 0) / 60;
  if (typeof w.lectureHours === 'number' && typeof w.laboratoryHours === 'number' && Math.abs(hours - (w.lectureHours + w.laboratoryHours)) > 0.01) {
    warnings.push(issue('workload-mismatch', `Teaching blocks add up to ${hours} h but the sheet says ${w.lectureHours + w.laboratoryHours} h (lecture + laboratory).`));
  }
  for (const w2 of draft.warnings || []) {
    if (w2.code !== 'faculty-name-needs-review') warnings.push(issue(w2.code || 'ocr-warning', w2.message || String(w2)));
  }

  return { canConfirm: blocking.length === 0, blocking, warnings, classes, consultationHours: consults, teachingHours: hours };
}

module.exports = { reviewScheduleDraft, compareNames, REQUIRED_CONSULT_MINUTES };
