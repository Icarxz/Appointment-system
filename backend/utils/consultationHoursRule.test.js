const test = require('node:test');
const assert = require('node:assert/strict');
const { hoursTotalError } = require('./consultationHoursRule');

test('faculty must total exactly 240 minutes', () => {
  assert.equal(hoursTotalError('FACULTY', 240), null);
  for (const m of [0, 210, 239, 241, 300]) assert.match(hoursTotalError('FACULTY', m), /exactly 4 hours/);
});
test('the Dean may set 30 minutes to 4 hours', () => {
  for (const m of [30, 60, 120, 240]) assert.equal(hoursTotalError('DEAN', m), null);
  for (const m of [0, 15, 241, 480]) assert.match(hoursTotalError('DEAN', m), /between 30 minutes and 4 hours/);
});
