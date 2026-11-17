const test = require('node:test');
const assert = require('node:assert');
const { PROGRAMS, isProgram, programOfPosition, effectiveProgram } = require('./programs');
const { FACULTY_POSITIONS } = require('./facultyPositions');

test('the three programs, and only they are valid', () => {
  assert.deepStrictEqual([...PROGRAMS], ['BS INFO', 'BS COMSCI', 'BLIS']);
  PROGRAMS.forEach(p => assert.ok(isProgram(p)));
  ['', 'bs info', 'BSIT', 'Faculty', null, undefined, 5, {}, ['BLIS']].forEach(v => assert.strictEqual(isProgram(v), false, String(v)));
});

test('a Program Head position implies its program; every other approved position implies none', () => {
  assert.strictEqual(programOfPosition('Program Head (BS INFO)'), 'BS INFO');
  assert.strictEqual(programOfPosition('Program Head (BS COMSCI)'), 'BS COMSCI');
  assert.strictEqual(programOfPosition('Program Head (BLIS)'), 'BLIS');
  FACULTY_POSITIONS.filter(p => !p.startsWith('Program Head')).forEach(p => assert.strictEqual(programOfPosition(p), '', p));
  ['Program Head (Nursing)', 'Program Head ()', '', null, undefined, 3].forEach(v => assert.strictEqual(programOfPosition(v), '', String(v)));
});

test('the saved program wins; otherwise a Program Head position decides; otherwise none', () => {
  assert.strictEqual(effectiveProgram({ program: 'BLIS', programPosition: 'Faculty' }), 'BLIS');
  assert.strictEqual(effectiveProgram({ program: 'BS INFO', programPosition: 'Program Head (BLIS)' }), 'BS INFO');
  assert.strictEqual(effectiveProgram({ programPosition: 'Program Head (BLIS)' }), 'BLIS');
  assert.strictEqual(effectiveProgram({ program: 'junk', programPosition: 'Program Head (BS COMSCI)' }), 'BS COMSCI');
  assert.strictEqual(effectiveProgram({ programPosition: 'Faculty' }), '');
  assert.strictEqual(effectiveProgram(null), '');
});
