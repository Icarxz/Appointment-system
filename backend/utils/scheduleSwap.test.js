const test = require('node:test');
const assert = require('node:assert');
const { fingerprint, replaceSchedule } = require('./scheduleSwap');

// In-memory store with failure injection.
function makeStore(initial, { failInsert = false, failRemove = false } = {}) {
  let n = 100, removeCalls = 0;
  const db = { classes: initial.classes.map((c, i) => ({ _id: `c${i}`, ...c })), hours: initial.hours.map((h, i) => ({ _id: `h${i}`, ...h })) };
  return {
    db,
    load: async () => ({ classes: db.classes.map(c => ({ ...c })), hours: db.hours.map(h => ({ ...h })) }),
    insert: async (fid, classes, hours) => {
      if (failInsert) throw new Error('boom');
      const classIds = classes.map(c => { const _id = `c${n++}`; db.classes.push({ _id, ...c }); return _id; });
      const hourIds = hours.map(h => { const _id = `h${n++}`; db.hours.push({ _id, ...h }); return _id; });
      return { classIds, hourIds };
    },
    remove: async ({ classIds = [], hourIds = [] }) => {
      if (failRemove && removeCalls++ === 0) throw new Error('boom');   // only the first removal (of the OLD rows) fails
      db.classes = db.classes.filter(c => !classIds.includes(c._id));
      db.hours = db.hours.filter(h => !hourIds.includes(h._id));
    },
  };
}
const OLD = { classes: [{ dayOfWeek: 1, startTime: '08:00', endTime: '09:00', subject: 'Old', room: 'R1' }], hours: [{ dayOfWeek: 2, startTime: '09:00', endTime: '13:00' }] };
const NEW_C = [{ dayOfWeek: 0, startTime: '18:30', endTime: '19:00', subject: 'Sunday class', room: 'R9', extra: 'dropped' }];
const NEW_H = [{ dayOfWeek: 3, startTime: '09:00', endTime: '11:00' }, { dayOfWeek: 4, startTime: '09:00', endTime: '11:00' }];
const strip = (rows) => rows.map(({ _id, ...r }) => r);

test('fingerprint ignores order and ids but notices any change', () => {
  const a = fingerprint([{ dayOfWeek: 1, startTime: '08:00', endTime: '09:00', subject: 'A', room: 'R' }, { dayOfWeek: 2, startTime: '08:00', endTime: '09:00', subject: 'B', room: 'R' }], NEW_H);
  const b = fingerprint([{ _id: 'x', dayOfWeek: 2, startTime: '08:00', endTime: '09:00', subject: 'B', room: 'R' }, { dayOfWeek: 1, startTime: '08:00', endTime: '09:00', subject: 'A', room: 'R' }], [...NEW_H].reverse());
  assert.strictEqual(a, b);
  assert.notStrictEqual(a, fingerprint([{ dayOfWeek: 1, startTime: '08:30', endTime: '09:00', subject: 'A', room: 'R' }], NEW_H));
});

test('a successful swap replaces both lists and returns the old schedule as the snapshot', async () => {
  const store = makeStore(OLD);
  const r = await replaceSchedule(store, 'f1', NEW_C, NEW_H);
  assert.deepStrictEqual(strip(store.db.classes), [{ dayOfWeek: 0, startTime: '18:30', endTime: '19:00', subject: 'Sunday class', room: 'R9' }]);
  assert.strictEqual(store.db.hours.length, 2);
  assert.deepStrictEqual(r.snapshot, OLD);
  assert.deepStrictEqual(r.counts, { classes: 1, hours: 2, removedClasses: 1, removedHours: 1 });
});

test('if inserting fails, nothing changed', async () => {
  const store = makeStore(OLD, { failInsert: true });
  await assert.rejects(() => replaceSchedule(store, 'f1', NEW_C, NEW_H), { code: 'INSERT_FAILED' });
  assert.deepStrictEqual(strip(store.db.classes), OLD.classes);
  assert.deepStrictEqual(strip(store.db.hours), OLD.hours);
});

test('if removing the old rows fails, the new rows are taken back and the old schedule stays whole', async () => {
  const store = makeStore(OLD, { failRemove: true });
  await assert.rejects(() => replaceSchedule(store, 'f1', NEW_C, NEW_H), { code: 'REMOVE_FAILED' });
  assert.deepStrictEqual(strip(store.db.classes), OLD.classes);
  assert.deepStrictEqual(strip(store.db.hours), OLD.hours);
});

test('a faculty with no schedule yet can receive one', async () => {
  const store = makeStore({ classes: [], hours: [] });
  const r = await replaceSchedule(store, 'f1', NEW_C, NEW_H);
  assert.strictEqual(store.db.classes.length, 1);
  assert.deepStrictEqual(r.snapshot, { classes: [], hours: [] });
});
