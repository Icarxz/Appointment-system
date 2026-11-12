const test = require('node:test');
const assert = require('node:assert');
const draft = require('../../ocr/fixtures/percy.extracted.json');
const { fromOcrDraft } = require('./scheduleDraft');
const { fingerprint } = require('./scheduleSwap');
const { checkEffectivityDate, revalidate, applyImport, checkRestore } = require('./scheduleImportService');

const rows = fromOcrDraft(draft);
const ctx = (extra = {}) => ({ identityConfirmed: true, targetName: 'Carl Spence D. Percy', approved: [], pending: [], ...extra });
const input = () => ({ classes: rows.classes, consultationHours: rows.consultationHours, metadata: rows.metadata, workload: rows.workload });

function memStore(classes = [], hours = []) {
  const db = { classes: classes.map((c, i) => ({ _id: `c${i}`, ...c })), hours: hours.map((h, i) => ({ _id: `h${i}`, ...h })) };
  return { db, load: async () => ({ classes: db.classes, hours: db.hours }),
    insert: async (f, c, h) => ({ classIds: c.map((x, i) => { db.classes.push({ _id: `n${i}`, ...x }); return `n${i}`; }), hourIds: h.map((x, i) => { db.hours.push({ _id: `m${i}`, ...x }); return `m${i}`; }) }),
    remove: async ({ classIds, hourIds }) => { db.classes = db.classes.filter(c => !classIds.includes(c._id)); db.hours = db.hours.filter(h => !hourIds.includes(h._id)); } };
}

test('effectivity date must be a real date within a year of today', () => {
  const today = '2026-11-12';
  assert.deepStrictEqual(checkEffectivityDate('2026-03-09', today), { ok: true, startsNow: true });
  assert.deepStrictEqual(checkEffectivityDate('2026-11-12', today), { ok: true, startsNow: true });
  assert.deepStrictEqual(checkEffectivityDate('2027-01-05', today), { ok: true, startsNow: false });
  for (const bad of ['2026-02-30', '2026-13-01', 'March 9, 2026', '', null, '2024-01-01', '2029-01-01']) assert.strictEqual(checkEffectivityDate(bad, today).ok, false, String(bad));
});

test('revalidate: the real Percy rows pass once the reviewer confirms the covered name', () => {
  assert.strictEqual(revalidate(input(), ctx({ identityConfirmed: true })).ok, true);
  assert.strictEqual(revalidate(input(), ctx({ identityConfirmed: false })).ok, false);
});

test('revalidate: stored rows are checked again, so a tampered row or a new approved appointment blocks', () => {
  const bad = input(); bad.classes = [...bad.classes, { ...bad.classes[0], id: 'zz', startTime: '11:45' }];
  assert.strictEqual(revalidate(bad, ctx()).ok, false);
  const monday = revalidate(input(), ctx({ approved: [{ date: '2026-11-16', time: '12:00', duration: 60 }] }));
  assert.strictEqual(monday.ok, false);
});

test('applyImport replaces the schedule and refuses a stale preview', async () => {
  const old = [{ dayOfWeek: 1, startTime: '08:00', endTime: '09:00', subject: 'Old', room: 'R1' }];
  const store = memStore(old, []);
  const base = fingerprint(old, []);
  const r = await applyImport({ facultyId: 'f', ...input(), baseFingerprint: base }, { store, enforceBase: true });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(store.db.classes.length, 14);
  assert.strictEqual(store.db.hours.length, 2);
  assert.deepStrictEqual(r.snapshot.classes, old);

  const store2 = memStore(old, []);
  const stale = await applyImport({ facultyId: 'f', ...input(), baseFingerprint: fingerprint([], []) }, { store: store2, enforceBase: true });
  assert.strictEqual(stale.ok, false); assert.strictEqual(stale.code, 'STALE');
  assert.strictEqual(store2.db.classes.length, 1);                      // untouched
  const missing = await applyImport({ facultyId: 'f', ...input() }, { store: memStore(), enforceBase: true });
  assert.strictEqual(missing.code, 'STALE');                            // no fingerprint at all is never accepted
});

test('a staged import applied later does not need the preview fingerprint', async () => {
  const store = memStore([{ dayOfWeek: 2, startTime: '08:00', endTime: '09:00', subject: 'Edited since', room: 'R' }], []);
  assert.strictEqual((await applyImport({ facultyId: 'f', ...input() }, { store, enforceBase: false })).ok, true);
});

test('checkRestore blocks restoring an old class that now covers an approved appointment', () => {
  const snap = { classes: [{ dayOfWeek: 1, startTime: '10:00', endTime: '12:00', subject: 'Old class', room: 'R1' }], hours: [] };
  assert.strictEqual(checkRestore(snap, []).ok, true);
  assert.strictEqual(checkRestore(snap, [{ date: '2026-11-16', time: '10:30', duration: 60 }]).ok, false);
});
