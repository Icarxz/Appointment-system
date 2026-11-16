// Matches a scanned schedule PDF to a faculty account by its FILE NAME. Pure functions, no imports (testable on their own).
// The name printed inside the PDF is still checked later by the importer's own identity check; this only proposes the account.

export const normalizeFacultyName = (name: string): string =>
  String(name || '')
    .replace(/\.pdf$/i, '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Peña -> Pena
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const TITLES = new Set(['dr', 'engr', 'prof', 'mr', 'mrs', 'ms', 'atty']);
const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);

// Every key a faculty name can be found by. "Carl M. Spence" gives carlmspence (all parts), carlspence (middle initial dropped)
// and spencecarl (last name first). A name with a single word gives just that word.
export function facultyKeys(name: string): string[] {
  const parts = String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/,/g, ' ').split(/\s+/).map(p => p.replace(/[^a-z0-9]/g, '')).filter(Boolean)
    .filter(p => !TITLES.has(p));
  const core = parts.filter(p => !SUFFIXES.has(p));
  const noInitials = core.filter(p => p.length > 1);
  const keys = new Set<string>();
  const add = (list: string[]) => { const k = list.join(''); if (k) keys.add(k); };
  add(parts); add(core); add(noInitials);
  if (noInitials.length >= 2) {
    const first = noInitials[0], last = noInitials[noInitials.length - 1];
    add([first, last]);                                  // Carl Percy
    add([last, ...noInitials.slice(0, -1)]);             // Percy Carl Spence
    add([last, first]);                                  // Percy Carl
    // A schedule file is often named with only the given names ("Carl Spence.pdf" for Carl Spence Percy): the leading words of the name, on word
    // boundaries, two words or more. If two accounts share them the file is "ambiguous" and the admin picks, so it is never chosen silently.
    for (let n = 2; n < noInitials.length; n++) add(noInitials.slice(0, n));
  }
  return [...keys];
}

export interface FacultyLite { _id: string; name: string }
export type MatchStatus = 'matched' | 'ambiguous' | 'unmatched';
export interface FileMatch { key: string; status: MatchStatus; candidates: FacultyLite[] }

// Scans are named like NIEGO-RINABELLE-FEB-2.pdf or EGUALAN-ROLEN-FEB-2-UPDATED.pdf: the name, then a date or a note. Those trailing parts are
// not part of the name. Numbers and words like "updated" go; a month goes only when something after it was removed too (so a first name
// such as April, as in REYES-APRIL.pdf, is kept).
const NOISE = new Set(['updated', 'update', 'new', 'old', 'final', 'copy', 'revised', 'rev', 'latest', 'schedule', 'sched', 'load', 'fil']);
const MONTHS = new Set(['jan', 'january', 'feb', 'february', 'mar', 'march', 'apr', 'april', 'may', 'jun', 'june', 'jul', 'july', 'aug', 'august',
  'sep', 'sept', 'september', 'oct', 'october', 'nov', 'november', 'dec', 'december']);
export function filenameKey(fileName: string): string {
  const tokens = String(fileName || '').replace(/\.pdf$/i, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .split(/[^a-z0-9]+/).filter(Boolean);
  let removed = 0;
  while (tokens.length > 1) {
    const t = tokens[tokens.length - 1];
    if (/^\d+$/.test(t) || NOISE.has(t) || (removed > 0 && MONTHS.has(t))) { tokens.pop(); removed++; } else break;
  }
  return tokens.join('');
}

// Exact comparison only (never includes()): a similar or partial name must not pick the wrong person.
export function matchFacultyByFilename(fileName: string, faculty: FacultyLite[]): FileMatch {
  const key = filenameKey(fileName);
  if (!key) return { key, status: 'unmatched', candidates: [] };
  const candidates = faculty.filter(f => facultyKeys(f.name).includes(key));
  return { key, status: candidates.length === 1 ? 'matched' : candidates.length > 1 ? 'ambiguous' : 'unmatched', candidates };
}
