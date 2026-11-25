const test = require('node:test');
const assert = require('node:assert');
const { validateProvisionRow, validateImportRows, importFieldForHeader } = require('./bulkProvision');

const domains = ['antiquespride.edu.ph'];

test('maps the prior optional-gender template header to the required gender field', () => {
  assert.equal(importFieldForHeader('Gender (optional)'), 'gender');
  assert.equal(importFieldForHeader('Gender'), 'gender');
});

test('accepts a valid student row', () => {
  const result = validateProvisionRow({
    name: '  fICTION   sTUDENT ',
    email: 'fiction.student@antiquespride.edu.ph',
    schoolId: '2025-S00001',
    program: 'BS INFO',
    year: '1',
    section: 'A',
    gender: 'Female',
  }, 'student', domains);
  assert.equal(result.valid, true);
  assert.equal(result.account.role, 'STUDENT');
  assert.equal(result.account.name, 'Fiction Student');
  assert.equal(result.account.schoolId, '2025-S00001');
});

test('rejects wrong domain, bad ID and bad cohort', () => {
  const result = validateProvisionRow({
    name: 'Bad Student',
    email: 'bad@gmail.com',
    schoolId: '123',
    program: 'UNKNOWN',
    year: '9',
    section: 'Z',
  }, 'student', domains);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /school domain/i);
  assert.match(result.errors.join(' '), /Student ID/i);
  assert.match(result.errors.join(' '), /program, year and section/i);
});

test('requires a valid gender for student, faculty, and dean imports', () => {
  const student = validateProvisionRow({
    name: 'Fiction Student',
    email: 'fiction.student@antiquespride.edu.ph',
    schoolId: '2025-S00001',
    program: 'BS INFO',
    year: '1',
    section: 'A',
  }, 'student', domains);
  assert.equal(student.valid, false);
  assert.match(student.errors.join(' '), /Gender must be Male or Female/);

  for (const role of ['Faculty', 'Dean']) {
    const result = validateProvisionRow({
      name: `Fiction ${role}`,
      email: `fiction.${role.toLowerCase()}@antiquespride.edu.ph`,
      employeeId: role === 'Dean' ? '2025S-00002' : '2025S-00003',
      position: role,
      role,
    }, 'faculty', domains);
    assert.equal(result.valid, false);
    assert.match(result.errors.join(' '), /Gender must be Male or Female/);
  }
});

test('accepts valid faculty and dean rows', () => {
  const faculty = validateProvisionRow({
    name: 'Fiction Faculty',
    email: 'fiction.faculty@antiquespride.edu.ph',
    employeeId: '2025S-00001',
    position: 'Faculty',
    program: 'BS INFO',
    role: 'Faculty',
    employmentType: 'Full-time',
    gender: 'Male',
  }, 'faculty', domains);
  assert.equal(faculty.valid, true);
  assert.equal(faculty.account.role, 'FACULTY');

  const dean = validateProvisionRow({
    name: 'Fiction Dean',
    email: 'fiction.dean@antiquespride.edu.ph',
    employeeId: '2025S-00002',
    position: 'Dean',
    role: 'Dean',
    gender: 'Female',
  }, 'faculty', domains);
  assert.equal(dean.valid, true);
  assert.equal(dean.account.role, 'DEAN');
});

test('rejects invalid position, role, employee ID and employment type', () => {
  const result = validateProvisionRow({
    name: 'Bad Faculty',
    email: 'bad.faculty@antiquespride.edu.ph',
    employeeId: 'bad',
    position: 'Invented Position',
    role: 'Admin',
    employmentType: 'Contract',
  }, 'faculty', domains);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /Role must be Faculty or Dean/i);
  assert.match(result.errors.join(' '), /Invalid faculty or Dean position/i);
  assert.match(result.errors.join(' '), /Employee ID/i);
  assert.match(result.errors.join(' '), /Employment type/i);
});

test('rejects formula-injection values', () => {
  const result = validateProvisionRow({
    name: '=HYPERLINK("x")',
    email: '@@school@antiquespride.edu.ph',
    schoolId: '2025-S00001',
    program: 'BS INFO',
    year: '1',
    section: 'A',
  }, 'student', domains);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /formula/i);
});

test('reads rich-text values and normalizes common Excel casing', () => {
  const student = validateProvisionRow({
    name: { richText: [{ text: 'Fiction ' }, { text: 'Student' }] },
    email: 'fiction.student@antiquespride.edu.ph',
    schoolId: '2025-S00001',
    program: 'bs info',
    year: 1,
    section: 'a',
    gender: 'female',
  }, 'student', domains);
  assert.equal(student.valid, true);

  const faculty = validateProvisionRow({
    name: 'Fiction Faculty',
    email: 'fiction.faculty@antiquespride.edu.ph',
    employeeId: '2025S-00001',
    position: 'faculty',
    program: 'bsinfo',
    role: 'faculty',
    employmentType: 'full time',
    gender: 'male',
  }, 'faculty', domains);
  assert.equal(faculty.valid, true);
  assert.equal(faculty.account.role, 'FACULTY');
  assert.equal(faculty.account.program, 'BS INFO');
  assert.equal(faculty.account.employmentType, 'Full-time');
});

test('marks duplicate emails and IDs within a spreadsheet', async () => {
  const fakeUser = {
    find() {
      return { select() { return { lean: async () => [] }; } };
    },
  };
  const results = await validateImportRows(fakeUser, [
    { name: 'First Student', email: 'same@antiquespride.edu.ph', schoolId: '2025-S00001', program: 'BS INFO', year: '1', section: 'A', gender: 'Female' },
    { name: 'Second Student', email: 'same@antiquespride.edu.ph', schoolId: '2025-S00001', program: 'BS INFO', year: '1', section: 'A', gender: 'Male' },
  ], 'student', { ALLOWED_EMAIL_DOMAIN: 'antiquespride.edu.ph' });
  assert.equal(results[0].valid, false);
  assert.equal(results[1].valid, false);
  assert.match(results[0].errors.join(' '), /Duplicate email within/i);
  assert.match(results[1].errors.join(' '), /Duplicate School ID within/i);
});

test('marks database email and ID duplicates', async () => {
  const fakeUser = {
    find() {
      return {
        select() {
          return {
            lean: async () => [{ email: 'existing@antiquespride.edu.ph', schoolId: '2025-S00009' }],
          };
        },
      };
    },
  };
  const results = await validateImportRows(fakeUser, [
    { name: 'Existing Student', email: 'existing@antiquespride.edu.ph', schoolId: '2025-S00009', program: 'BS INFO', year: '1', section: 'A', gender: 'Male' },
  ], 'student', { ALLOWED_EMAIL_DOMAIN: 'antiquespride.edu.ph' });
  assert.equal(results[0].valid, false);
  assert.match(results[0].errors.join(' '), /Duplicate email in the database/i);
  assert.match(results[0].errors.join(' '), /Duplicate School ID in the database/i);
});

test('revalidates edited submitted values without losing spreadsheet row numbers', async () => {
  const fakeUser = {
    find() {
      return { select() { return { lean: async () => [] }; } };
    },
  };
  const rows = await validateImportRows(fakeUser, [{
    rowNumber: 8,
    submitted: {
      name: 'Corrected Fiction Student',
      email: 'corrected.student@antiquespride.edu.ph',
      schoolId: '2025-S00008',
      program: 'BS INFO',
      year: '1',
      section: 'A',
      gender: 'Female',
    },
  }], 'student', { ALLOWED_EMAIL_DOMAIN: 'antiquespride.edu.ph' });

  assert.equal(rows[0].rowNumber, 8);
  assert.equal(rows[0].submitted.name, 'Corrected Fiction Student');
  assert.equal(rows[0].valid, true);
});
