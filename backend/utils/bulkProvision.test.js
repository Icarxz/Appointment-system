const test = require('node:test');
const assert = require('node:assert');
const { validateProvisionRow, validateImportRows } = require('./bulkProvision');

const domains = ['antiquespride.edu.ph'];

test('accepts a valid student row', () => {
  const result = validateProvisionRow({
    name: 'Fiction Student',
    email: 'fiction.student@antiquespride.edu.ph',
    schoolId: '2025-S00001',
    program: 'BS INFO',
    year: '1',
    section: 'A',
  }, 'student', domains);
  assert.equal(result.valid, true);
  assert.equal(result.account.role, 'STUDENT');
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

test('accepts valid faculty and dean rows', () => {
  const faculty = validateProvisionRow({
    name: 'Fiction Faculty',
    email: 'fiction.faculty@antiquespride.edu.ph',
    employeeId: '2025S-00001',
    position: 'Faculty',
    program: 'BS INFO',
    role: 'Faculty',
    employmentType: 'Full-time',
  }, 'faculty', domains);
  assert.equal(faculty.valid, true);
  assert.equal(faculty.account.role, 'FACULTY');

  const dean = validateProvisionRow({
    name: 'Fiction Dean',
    email: 'fiction.dean@antiquespride.edu.ph',
    employeeId: '2025S-00002',
    position: 'Dean',
    role: 'Dean',
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

test('marks duplicate emails and IDs within a spreadsheet', async () => {
  const fakeUser = {
    find() {
      return { select() { return { lean: async () => [] }; } };
    },
  };
  const results = await validateImportRows(fakeUser, [
    { name: 'First Student', email: 'same@antiquespride.edu.ph', schoolId: '2025-S00001', program: 'BS INFO', year: '1', section: 'A' },
    { name: 'Second Student', email: 'same@antiquespride.edu.ph', schoolId: '2025-S00001', program: 'BS INFO', year: '1', section: 'A' },
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
    { name: 'Existing Student', email: 'existing@antiquespride.edu.ph', schoolId: '2025-S00009', program: 'BS INFO', year: '1', section: 'A' },
  ], 'student', { ALLOWED_EMAIL_DOMAIN: 'antiquespride.edu.ph' });
  assert.equal(results[0].valid, false);
  assert.match(results[0].errors.join(' '), /Duplicate email in the database/i);
  assert.match(results[0].errors.join(' '), /Duplicate School ID in the database/i);
});
