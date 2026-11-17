import { cohortConfig } from '../data/cohortConfig';

// The programs a faculty member can belong to: the same three as the student programs (BS INFO, BS COMSCI, BLIS).
export const PROGRAMS: string[] = Object.keys(cohortConfig);
export const PROGRAM_OPTIONS = PROGRAMS.map(p => ({ value: p, label: p }));

// "Program Head (BS COMSCI)" -> "BS COMSCI". Any other position -> ''. Same rule as the server (utils/programs.js).
export const programOfPosition = (position?: string): string => {
  const m = (position || '').trim().match(/^Program Head \((.+)\)$/);
  return m && PROGRAMS.includes(m[1]) ? m[1] : '';
};

// A Program Head's program is always the one in the position; anyone else has the one saved on the account, else ''. Same rule as the server.
export const facultyProgram = (f: { program?: string; programPosition?: string }): string =>
  programOfPosition(f.programPosition) || (f.program && PROGRAMS.includes(f.program) ? f.program : '');
