// Which semester does a date belong to? Pure functions (no database), dates are Manila calendar days as 'YYYY-MM-DD'.
//
// Default calendar (used when the Admin has not defined a term that covers the date):
//   Aug 1  - Dec 31  -> First Semester of the academic year that STARTS that year   (Aug 2025 -> "2025-2026")
//   Jan 1  - Apr 30  -> Second Semester of the academic year that started LAST year (Jan 2026 -> "2025-2026")
//   May 1  - Jul 31  -> no term (null). The Admin can add a Summer term for these dates.
// An Admin-defined term always wins over the default.

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isValidDateString(value) {
  const m = DATE_RE.exec(String(value || ''));
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function academicYearLabel(startYear) {
  return `${startYear}-${startYear + 1}`;
}

function defaultTermForDate(dateString) {
  if (!isValidDateString(dateString)) return null;
  const year = Number(dateString.slice(0, 4));
  const month = Number(dateString.slice(5, 7));
  if (month >= 8) return { academicYear: academicYearLabel(year), name: 'First Semester', source: 'default' };
  if (month <= 4) return { academicYear: academicYearLabel(year - 1), name: 'Second Semester', source: 'default' };
  return null;
}

// terms: Admin-defined [{ academicYear, name, startDate, endDate }]. Returns { academicYear, name, source } or null.
function termForDate(dateString, terms = []) {
  if (!isValidDateString(dateString)) return null;
  const hit = terms.find(t => isValidDateString(t.startDate) && isValidDateString(t.endDate)
    && t.startDate <= dateString && dateString <= t.endDate);
  if (hit) return { academicYear: hit.academicYear, name: hit.name, source: 'admin' };
  return defaultTermForDate(dateString);
}

// Returns { ok:true } or { ok:false, error } with a plain sentence for the Admin.
// existing: the other Admin-defined terms (leave out the one being edited).
function validateTerm(term, existing = []) {
  const name = String(term && term.name || '').trim();
  const academicYear = String(term && term.academicYear || '').trim();
  if (!name) return { ok: false, error: 'Enter a name for the term, for example "Summer".' };
  if (!/^\d{4}-\d{4}$/.test(academicYear) || Number(academicYear.slice(5)) !== Number(academicYear.slice(0, 4)) + 1) {
    return { ok: false, error: 'The academic year must look like 2025-2026.' };
  }
  if (!isValidDateString(term.startDate) || !isValidDateString(term.endDate)) {
    return { ok: false, error: 'Enter the start and end dates of the term.' };
  }
  if (term.startDate > term.endDate) return { ok: false, error: 'The start date must be before the end date.' };
  const clash = existing.find(t => term.startDate <= t.endDate && t.startDate <= term.endDate);
  if (clash) {
    return { ok: false, error: `These dates overlap "${clash.name} ${clash.academicYear}" (${clash.startDate} to ${clash.endDate}).` };
  }
  return { ok: true, value: { name: name.slice(0, 60), academicYear, startDate: term.startDate, endDate: term.endDate } };
}

// The term name used for filtering ("All" means no filter).
function matchesTermFilter(termInfo, { academicYear, term } = {}) {
  if (academicYear && academicYear !== 'ALL') {
    if (!termInfo || termInfo.academicYear !== academicYear) return false;
  }
  if (term && term !== 'ALL') {
    if (term === 'NONE') return !termInfo;
    if (!termInfo || termInfo.name !== term) return false;
  }
  return true;
}

module.exports = { isValidDateString, defaultTermForDate, termForDate, validateTerm, matchesTermFilter, academicYearLabel };
