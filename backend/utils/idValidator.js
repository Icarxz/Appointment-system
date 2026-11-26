// Official ID formats. One place so the User model, Admin tools and onboarding agree.
//   Student:  YYYY-S00001 or YYYY-1234-A
//   Employee: YYYYS-00001
const STUDENT_ID_REGEX = /^\d{4}-(S\d{5}|\d{4}-[A-Z])$/;
const EMPLOYEE_ID_REGEX = /^\d{4}S-\d{5}$/;

const STUDENT_ID_HINT = (year = new Date().getFullYear()) => `${year}-S00001 or ${year}-1234-A`;
const EMPLOYEE_ID_HINT = (year = new Date().getFullYear()) => `${year}S-00001`;

// Returns { ok, id, error }. kind is 'STUDENT' or 'EMPLOYEE'.
function validateId(raw, kind, currentYear = new Date().getFullYear()) {
  const id = String(raw || '').trim().toUpperCase();
  if (!id) return { ok: false, id, error: 'ID is required.' };
  const isStudent = kind === 'STUDENT';
  const hint = isStudent ? STUDENT_ID_HINT(currentYear) : EMPLOYEE_ID_HINT(currentYear);
  if (!(isStudent ? STUDENT_ID_REGEX : EMPLOYEE_ID_REGEX).test(id)) {
    return { ok: false, id, error: `Invalid ${isStudent ? 'Student' : 'Employee'} ID format. Expected: ${hint}` };
  }
  if (Number(id.slice(0, 4)) > currentYear) {
    return { ok: false, id, error: `The year in this ID must be ${currentYear} or earlier.` };
  }
  return { ok: true, id };
}

module.exports = { STUDENT_ID_REGEX, EMPLOYEE_ID_REGEX, STUDENT_ID_HINT, EMPLOYEE_ID_HINT, validateId };
