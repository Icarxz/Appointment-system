const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const { validateId } = require('./idValidator');
const { isValidCohort, cohortLabel } = require('./studentCohort');
const { isApprovedFacultyPosition } = require('./facultyPositions');
const { isProgram, programOfPosition } = require('./programs');
const { isEmploymentType } = require('./employment');
const { parseList } = require('./signInPolicy');

const MAX_ROWS = 500;
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

const text = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && Array.isArray(value.richText)) {
    return value.richText.map(part => String(part.text || '')).join('').trim();
  }
  if (typeof value === 'object' && value.text !== undefined) return String(value.text).trim();
  return String(value).trim();
};

function formulaOrInjection(value) {
  return FORMULA_PREFIX.test(text(value));
}

function validateProvisionRow(raw, kind, allowedDomains) {
  const row = raw && typeof raw === 'object' ? raw : {};
  const name = text(row.name);
  const rawEmail = text(row.email).toLowerCase();
  const role = kind === 'student'
    ? 'STUDENT'
    : ({ faculty: 'FACULTY', dean: 'DEAN' }[text(row.role).toLowerCase()] || text(row.role).toUpperCase());
  const errors = [];

  if (!name || name.length < 2 || name.length > 100) errors.push('Full name must be 2 to 100 characters.');
  if (formulaOrInjection(name)) errors.push('Full name cannot begin with a formula or formula-injection character.');
  if (!EMAIL_REGEX.test(rawEmail)) errors.push('Enter a valid email address.');
  else {
    const domain = rawEmail.split('@')[1];
    if (!allowedDomains.length || !allowedDomains.includes(domain)) {
      errors.push(`Email must use the school domain: ${allowedDomains.map(d => '@' + d).join(', ') || 'none configured'}.`);
    }
  }

  let account = null;
  if (kind === 'student') {
    const schoolIdCheck = validateId(row.schoolId, 'STUDENT');
    if (!schoolIdCheck.ok) errors.push(schoolIdCheck.error);
    const programRaw = text(row.program).toUpperCase().replace(/\s+/g, ' ').trim();
    const program = ({ 'BSINFO': 'BS INFO', 'BS INFO': 'BS INFO', 'BSCOMSCI': 'BS COMSCI', 'BS COMSCI': 'BS COMSCI', 'BLIS': 'BLIS' }[programRaw] || programRaw);
    const year = text(row.year);
    const section = text(row.section).toUpperCase();
    if (!isValidCohort(program, year, section)) {
      errors.push('Unknown or invalid program, year and section combination.');
    }
    const genderRaw = text(row.gender).toLowerCase();
    const gender = genderRaw === 'male' ? 'Male' : genderRaw === 'female' ? 'Female' : text(row.gender);
    if (gender && !['Male', 'Female'].includes(gender)) errors.push('Gender must be Male, Female or blank.');
    if (formulaOrInjection(row.schoolId) || formulaOrInjection(program) || formulaOrInjection(year) || formulaOrInjection(section)) {
      errors.push('Student fields cannot contain formula or formula-injection values.');
    }
    if (!errors.length) {
      account = {
        name,
        email: rawEmail,
        role: 'STUDENT',
        gender: gender || undefined,
        accountStatus: 'ACTIVE',
        isVerified: false,
        onboardingComplete: false,
        currentStatus: 'OUT_OF_OFFICE',
        schoolId: schoolIdCheck.id,
        noIdYet: false,
        programPosition: cohortLabel(program, year, section),
      };
    }
  } else {
    if (!['FACULTY', 'DEAN'].includes(role)) errors.push('Role must be Faculty or Dean.');
    const positionRaw = text(row.position).trim();
    const positionAliases = {
      faculty: 'Faculty',
      librarian: 'Librarian',
      'program head (bs info)': 'Program Head (BS INFO)',
      'program head (bs comsci)': 'Program Head (BS COMSCI)',
      'program head (blis)': 'Program Head (BLIS)',
      dean: 'Dean',
    };
    const position = positionAliases[positionRaw.toLowerCase()] || positionRaw;
    if (!isApprovedFacultyPosition(position)) errors.push('Invalid faculty or Dean position.');
    const employeeIdCheck = validateId(row.employeeId, 'EMPLOYEE');
    if (!employeeIdCheck.ok) errors.push(employeeIdCheck.error);
    const genderRaw = text(row.gender).toLowerCase();
    const gender = genderRaw === 'male' ? 'Male' : genderRaw === 'female' ? 'Female' : text(row.gender);
    if (gender && !['Male', 'Female'].includes(gender)) errors.push('Gender must be Male, Female or blank.');
    const employmentRaw = text(row.employmentType).toLowerCase();
    const employmentType = employmentRaw === 'full-time' || employmentRaw === 'full time' ? 'Full-time'
      : employmentRaw === 'part-time' || employmentRaw === 'part time' ? 'Part-time'
      : text(row.employmentType);
    if (employmentType && !isEmploymentType(employmentType)) errors.push('Employment type must be Full-time or Part-time.');

    let facultyProgram = '';
    const headProgram = programOfPosition(position);
    const submittedProgramRaw = text(row.program).toUpperCase().replace(/\s+/g, ' ').trim();
    const submittedProgram = ({ 'BSINFO': 'BS INFO', 'BS INFO': 'BS INFO', 'BSCOMSCI': 'BS COMSCI', 'BS COMSCI': 'BS COMSCI', 'BLIS': 'BLIS' }[submittedProgramRaw] || submittedProgramRaw);
    if (headProgram) facultyProgram = headProgram;
    else if (submittedProgram) {
      if (!isProgram(submittedProgram)) errors.push('Program must be BS INFO, BS COMSCI or BLIS.');
      else facultyProgram = submittedProgram;
    }
    if (formulaOrInjection(row.employeeId) || formulaOrInjection(position) || formulaOrInjection(submittedProgram) || formulaOrInjection(employmentType)) {
      errors.push('Faculty fields cannot contain formula or formula-injection values.');
    }
    if (!errors.length) {
      account = {
        name,
        email: rawEmail,
        role,
        gender: gender || undefined,
        accountStatus: 'ACTIVE',
        isVerified: false,
        onboardingComplete: false,
        currentStatus: 'OUT_OF_OFFICE',
        facultyId: employeeIdCheck.id,
        noIdYet: false,
        programPosition: position,
        employmentType: employmentType || undefined,
        program: facultyProgram || undefined,
      };
    }
  }

  return { valid: errors.length === 0, errors, account };
}

async function validateImportRows(User, rows, kind, env) {
  const allowedDomains = parseList(env.ALLOWED_EMAIL_DOMAIN);
  const results = rows.map((row, index) => {
    const checked = validateProvisionRow(row, kind, allowedDomains);
    return { rowNumber: index + 2, submitted: row, ...checked };
  });

  const emailCounts = new Map();
  const idCounts = new Map();
  for (const result of results) {
    const email = text(result.submitted.email).toLowerCase();
    const id = kind === 'student'
      ? text(result.submitted.schoolId).toUpperCase()
      : text(result.submitted.employeeId).toUpperCase();
    if (email) emailCounts.set(email, (emailCounts.get(email) || 0) + 1);
    if (id) idCounts.set(id, (idCounts.get(id) || 0) + 1);
  }

  const emails = [...emailCounts.keys()];
  const ids = [...idCounts.keys()];
  const conditions = [];
  if (emails.length) conditions.push({ email: { $in: emails } });
  if (ids.length) {
    conditions.push(kind === 'student'
      ? { schoolId: { $in: ids } }
      : { facultyId: { $in: ids } });
  }
  const existing = conditions.length
    ? await User.find({ $or: conditions }).select('email schoolId facultyId').lean()
    : [];
  const existingEmails = new Set(existing.map(u => u.email));
  const existingIds = new Set(existing.map(u => kind === 'student' ? u.schoolId : u.facultyId).filter(Boolean));

  for (const result of results) {
    const email = text(result.submitted.email).toLowerCase();
    const id = kind === 'student'
      ? text(result.submitted.schoolId).toUpperCase()
      : text(result.submitted.employeeId).toUpperCase();
    if (email && emailCounts.get(email) > 1) {
      result.errors.push('Duplicate email within the spreadsheet.');
      result.valid = false;
    }
    if (id && idCounts.get(id) > 1) {
      result.errors.push(`Duplicate ${kind === 'student' ? 'School' : 'Employee'} ID within the spreadsheet.`);
      result.valid = false;
    }
    if (email && existingEmails.has(email)) {
      result.errors.push('Duplicate email in the database.');
      result.valid = false;
    }
    if (id && existingIds.has(id)) {
      result.errors.push(`Duplicate ${kind === 'student' ? 'School' : 'Employee'} ID in the database.`);
      result.valid = false;
    }
  }

  return results;
}

module.exports = {
  MAX_ROWS,
  text,
  formulaOrInjection,
  validateProvisionRow,
  validateImportRows,
};
