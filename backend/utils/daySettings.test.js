const test = require('node:test');
const assert = require('node:assert');
const { DEFAULT_VISIBLE_DAYS, CLASS_DAYS, CONSULTATION_DAYS, isClassDay, isConsultationDay, parseDay } = require('./daySettings');

test('the settings: five default days, all seven for classes, Monday to Friday for consultations', () => {
  assert.deepStrictEqual(DEFAULT_VISIBLE_DAYS, [1, 2, 3, 4, 5]);
  assert.deepStrictEqual(CLASS_DAYS, [0, 1, 2, 3, 4, 5, 6]);
  assert.deepStrictEqual(CONSULTATION_DAYS, [1, 2, 3, 4, 5]);
  for (const d of CONSULTATION_DAYS) assert.ok(CLASS_DAYS.includes(d), `consultation day ${d} is also a class day`);
});

test('classes may be on any day, including Saturday and Sunday', () => {
  for (const d of [0, 1, 2, 3, 4, 5, 6]) assert.strictEqual(isClassDay(d), true, String(d));
  for (const d of [-1, 7, 1.5, '1', null, undefined, NaN, true]) assert.strictEqual(isClassDay(d), false, String(d));
});

test('consultations are Monday to Friday only: Saturday (6) and Sunday (0) are rejected', () => {
  for (const d of [1, 2, 3, 4, 5]) assert.strictEqual(isConsultationDay(d), true, String(d));
  for (const d of [0, 6, 7, -1, 1.5, '1', null, undefined, NaN]) assert.strictEqual(isConsultationDay(d), false, String(d));
});

test('parseDay: numbers and numeric text pass through; null, empty and booleans are not Sunday', () => {
  assert.strictEqual(parseDay(0), 0);
  assert.strictEqual(parseDay('0'), 0);
  assert.strictEqual(parseDay(3), 3);
  assert.strictEqual(parseDay(' 5 '), 5);
  for (const bad of [null, undefined, '', '   ', false, true, [], {}]) assert.ok(Number.isNaN(parseDay(bad)), String(bad));
  assert.ok(Number.isNaN(parseDay('x')));
});

test('a weekend day sent as text is still rejected for consultations after parsing', () => {
  assert.strictEqual(isConsultationDay(parseDay('6')), false);
  assert.strictEqual(isConsultationDay(parseDay('0')), false);
  assert.strictEqual(isConsultationDay(parseDay('2')), true);
  assert.strictEqual(isConsultationDay(parseDay(null)), false);
});
