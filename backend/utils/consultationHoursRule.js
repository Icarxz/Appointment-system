// How many official consultation minutes a person must set per week.
//   Faculty: exactly 4 hours (240 min), the university rule.
//   Dean:    any amount from 30 minutes up to 4 hours. He is not held to the four-hour rule; this is a draft decision
//            that still needs the adviser's confirmation (see docs/dean-consultations-status.md).
const FACULTY_MINUTES = 240;
const DEAN_MIN_MINUTES = 30;

// Returns an error message, or null when the total is acceptable.
function hoursTotalError(role, totalMinutes) {
  if (role === 'DEAN') {
    if (totalMinutes < DEAN_MIN_MINUTES || totalMinutes > FACULTY_MINUTES) {
      return `Consultation hours must be between 30 minutes and 4 hours per week. Currently: ${(totalMinutes / 60).toFixed(1)} hours.`;
    }
    return null;
  }
  if (totalMinutes !== FACULTY_MINUTES) {
    return `Consultation hours must total exactly 4 hours per week. Currently: ${(totalMinutes / 60).toFixed(1)} hours.`;
  }
  return null;
}

module.exports = { FACULTY_MINUTES, DEAN_MIN_MINUTES, hoursTotalError };
