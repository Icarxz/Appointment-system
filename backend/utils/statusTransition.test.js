const test = require('node:test');
const assert = require('node:assert');
const { transition, CHANGED_MESSAGE } = require('./statusTransition');

// A tiny in-memory stand-in for the Mongoose model: supports the { _id, status: { $in } } filter we use.
function fakeModel(rows) {
  return {
    calls: [],
    async findOneAndUpdate(filter, update, opts) {
      this.calls.push({ filter, update, opts });
      const row = rows.find(r => r._id === filter._id && filter.status.$in.includes(r.status)
        && Object.entries(filter).every(([k, v]) => k === '_id' || k === 'status' || (v && v.$exists === false ? r[k] === undefined : r[k] === v)));
      if (!row) return null;
      Object.assign(row, update.$set);
      return { ...row };
    },
  };
}

test('moves an appointment that is still in the expected status', async () => {
  const rows = [{ _id: 'a1', status: 'APPROVED' }];
  const out = await transition(fakeModel(rows), 'a1', 'APPROVED', { status: 'COMPLETED' });
  assert.strictEqual(out.status, 'COMPLETED');
  assert.strictEqual(rows[0].status, 'COMPLETED');
});

test('returns null and writes nothing when the status already changed', async () => {
  const rows = [{ _id: 'a1', status: 'CANCELLED BY STUDENT' }];
  const out = await transition(fakeModel(rows), 'a1', ['PENDING', 'APPROVED'], { status: 'APPROVED' });
  assert.strictEqual(out, null);
  assert.strictEqual(rows[0].status, 'CANCELLED BY STUDENT');
});

test('the second of two competing changes loses', async () => {
  const rows = [{ _id: 'a1', status: 'APPROVED' }];
  const m = fakeModel(rows);
  const first = await transition(m, 'a1', 'APPROVED', { status: 'MISSED (FACULTY)' });
  const second = await transition(m, 'a1', ['APPROVED', 'MISSED (FACULTY)'], { status: 'COMPLETED' }, { completedAt: { $exists: false } });
  assert.strictEqual(first.status, 'MISSED (FACULTY)');
  assert.strictEqual(second.status, 'COMPLETED'); // allowed: a late sign-off from MISSED (FACULTY)
  const third = await transition(m, 'a1', 'APPROVED', { status: 'MISSED (STUDENT)' });
  assert.strictEqual(third, null);
});

test('extra conditions are applied and the id/status filter cannot be overridden', async () => {
  const m = fakeModel([{ _id: 'a1', status: 'APPROVED' }]);
  await transition(m, 'a1', 'APPROVED', { status: 'COMPLETED' }, { _id: 'other', status: 'X', facultyId: 'f1' });
  assert.strictEqual(m.calls[0].filter._id, 'a1');
  assert.deepStrictEqual(m.calls[0].filter.status, { $in: ['APPROVED'] });
  assert.strictEqual(m.calls[0].filter.facultyId, 'f1');
  assert.ok(CHANGED_MESSAGE.length > 10);
});
