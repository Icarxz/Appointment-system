// A faculty member is either full-time or part-time (part-timers carry fewer consultation hours: see docs/importer-status.md).
const EMPLOYMENT_TYPES = Object.freeze(['Full-time', 'Part-time']);

const isEmploymentType = (value) => typeof value === 'string' && EMPLOYMENT_TYPES.includes(value);

module.exports = { EMPLOYMENT_TYPES, isEmploymentType };
