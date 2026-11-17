// The programs a faculty member can belong to. Same names as the student programs in the frontend's cohortConfig.
const PROGRAMS = Object.freeze(['BS INFO', 'BS COMSCI', 'BLIS']);

const isProgram = (value) => typeof value === 'string' && PROGRAMS.includes(value.trim());

// A Program Head already says which program they lead: "Program Head (BS COMSCI)" -> "BS COMSCI". Any other position -> ''.
const programOfPosition = (position) => {
  const m = typeof position === 'string' ? position.trim().match(/^Program Head \((.+)\)$/) : null;
  return m && PROGRAMS.includes(m[1]) ? m[1] : '';
};

// What a faculty account's program is: the one saved on it, else the one its Program Head position implies, else ''.
const effectiveProgram = (user) => (user && isProgram(user.program) ? user.program.trim() : programOfPosition(user && user.programPosition));

module.exports = { PROGRAMS, isProgram, programOfPosition, effectiveProgram };
