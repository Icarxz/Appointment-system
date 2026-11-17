const test = require('node:test');
const assert = require('node:assert');
const { endFromChoice } = require('./statusDuration');
const at = (hhmm) => new Date(`2026-11-17T${hhmm}:00+08:00`);

test('minutes add to now', () => {
  assert.equal(endFromChoice(30, null, at('09:00')).endAt.getTime(), at('09:30').getTime());
  assert.equal(endFromChoice('60', null, at('09:00')).endAt.getTime(), at('10:00').getTime());
});
test('unknown minutes rejected', () => assert.equal(endFromChoice(45, null, at('09:00')).ok, false));
test('end of day is midnight Manila', () => {
  assert.equal(endFromChoice('EOD', null, at('09:00')).endAt.getTime(), new Date('2026-11-18T00:00:00+08:00').getTime());
});
test('until: valid, past and malformed', () => {
  assert.equal(endFromChoice('UNTIL', '15:00', at('09:00')).endAt.getTime(), at('15:00').getTime());
  assert.equal(endFromChoice('UNTIL', '08:00', at('09:00')).ok, false);
  assert.equal(endFromChoice('UNTIL', '25:99', at('09:00')).ok, false);
  assert.equal(endFromChoice('UNTIL', '', at('09:00')).ok, false);
});
