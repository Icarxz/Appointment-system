// The programs, year levels and sections a student account can belong to. Keep in step with frontend/src/data/cohortConfig.ts.
// A student's programPosition is stored as "<program> <year><section>", for example "BS INFO 3A".
const COHORTS = Object.freeze({
  'BS INFO': { 1: 'ABCDE', 2: 'ABCD', 3: 'ABCD', 4: 'ABCD' },
  'BS COMSCI': { 1: 'AB', 2: 'AB', 3: 'AB', 4: 'AB' },
  BLIS: { 1: 'AB', 2: 'AB', 3: 'AB', 4: 'AB' },
});

const isValidCohort = (program, year, section) => {
  if (typeof program !== 'string' || !Object.prototype.hasOwnProperty.call(COHORTS, program)) return false;
  const sections = COHORTS[program][String(year)];
  return typeof sections === 'string' && typeof section === 'string' && section.length === 1 && sections.includes(section);
};

const cohortLabel = (program, year, section) => `${program} ${year}${section}`;

module.exports = { COHORTS, isValidCohort, cohortLabel };
