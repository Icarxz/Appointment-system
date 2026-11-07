const FACULTY_POSITIONS = Object.freeze([
  'Faculty',
  'Librarian',
  'Program Head (BS INFO)',
  'Program Head (BS COMSCI)',
  'Program Head (BLIS)',
  'Dean',
]);

const isApprovedFacultyPosition = (value) =>
  typeof value === 'string' && FACULTY_POSITIONS.includes(value.trim());

module.exports = { FACULTY_POSITIONS, isApprovedFacultyPosition };
