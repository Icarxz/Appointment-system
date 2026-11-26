// Official ID formats (keep in sync with backend/utils/idValidator.js).
//   Student:  YYYY-S00001 or YYYY-1234-A
//   Employee: YYYYS-00001
export const STUDENT_ID_REGEX = /^\d{4}-(S\d{5}|\d{4}-[A-Z])$/;
export const EMPLOYEE_ID_REGEX = /^\d{4}S-\d{5}$/;

export const idHint = (kind: 'STUDENT' | 'EMPLOYEE', currentYear = new Date().getFullYear()) =>
  `${kind === 'STUDENT' ? `${currentYear}-S00001 or ${currentYear}-1234-A` : `${currentYear}S-00001`}; ID year must be ${currentYear} or earlier.`;

export const isValidId = (raw: string, kind: 'STUDENT' | 'EMPLOYEE', currentYear = new Date().getFullYear()): boolean => {
  const id = raw.trim().toUpperCase();
  return (kind === 'STUDENT' ? STUDENT_ID_REGEX : EMPLOYEE_ID_REGEX).test(id)
    && Number(id.slice(0, 4)) <= currentYear;
};
