const test = require('node:test');
const assert = require('node:assert');
const { csvCell, buildCsv, facultyReportCsv, sharedReportCsv } = require('./csvExport');
const { buildFacultyAnalytics } = require('./facultyAnalytics');
const { buildSharedReport } = require('./reportMetrics');

test('text that could run as a formula is kept as text', () => {
  for (const evil of ['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\t=x', '\r=x']) {
    assert.ok(csvCell(evil).replace(/^"/, '').startsWith("'"), evil);
  }
  assert.strictEqual(csvCell('Ana Cruz'), 'Ana Cruz');
});

test('the formula guard still quotes the cell when it also holds a comma or quote', () => {
  assert.strictEqual(csvCell('=a,b'), `"'=a,b"`);
  assert.strictEqual(csvCell('@say "hi"'), `"'@say ""hi"""`);
});

test('numbers are not prefixed, blanks are empty, commas and quotes are escaped', () => {
  assert.strictEqual(csvCell(-5), '-5');
  assert.strictEqual(csvCell(0), '0');
  assert.strictEqual(csvCell(null), '');
  assert.strictEqual(csvCell(undefined), '');
  assert.strictEqual(csvCell(NaN), '');
  assert.strictEqual(csvCell(Infinity), '');
  assert.strictEqual(csvCell('a,b'), '"a,b"');
  assert.strictEqual(csvCell('say "hi"'), '"say ""hi"""');
  assert.strictEqual(csvCell('two\nlines'), '"two\nlines"');
});

test('buildCsv adds a BOM, CRLF line ends and blank lines between sections', () => {
  const out = buildCsv([{ title: 'A', header: ['x', 'y'], rows: [[1, 'b']] }, { title: 'B', rows: [['z']] }]);
  assert.strictEqual(out.charCodeAt(0), 0xFEFF);
  assert.strictEqual(out.slice(1), 'A\r\nx,y\r\n1,b\r\n\r\nB\r\nz\r\n');
});

const apt = (status, extra = {}) => ({
  status, date: '2026-10-20', time: '09:00', studentId: 's1', studentName: 'Maria Santos', studentSection: 'BS INFO 3A',
  reason: 'Capstone / Thesis Consultation', facultyId: 'f1', ...extra,
});
const users = [{ _id: 'f1', role: 'FACULTY', accountStatus: 'ACTIVE', name: 'Prof Reyes' }];
const facultyCsv = (appointments, name = 'Prof Reyes') =>
  facultyReportCsv(buildFacultyAnalytics({ appointments, official: [], added: [], todayIso: '2026-10-28' }), { generatedAt: 'now', name });
const sharedCsv = (appointments, role = 'ADMIN') =>
  sharedReportCsv(buildSharedReport({ appointments, users, hoursRows: [], todayIso: '2026-10-28', includeAccountHealth: role === 'ADMIN' }), { generatedAt: 'now', role });

test('typed text cannot reach the faculty or shared export as a live formula', () => {
  const appointments = [apt('COMPLETED', { studentName: '=EVIL()', reason: '=HYPERLINK("http://x")' })];
  const fac = facultyCsv(appointments, '=Faculty');
  assert.ok(fac.includes("'=Faculty"));
  assert.ok(fac.toLowerCase().includes("'=hyperlink")); // purposes are re-cased by the report
  assert.ok(!/(^|\r\n|,)=/.test(fac));
  const shared = sharedReportCsv(
    buildSharedReport({ appointments, users: [{ ...users[0], name: '+Dean' }], hoursRows: [], todayIso: '2026-10-28', includeAccountHealth: true }),
    { generatedAt: 'now', role: 'ADMIN' });
  assert.ok(shared.includes("'+Dean"));
  assert.ok(shared.includes('Profile completion'));
});

test('declined and expired requests are separate rows in both exports (expired = nobody answered)', () => {
  const appointments = [
    apt('REJECTED'),                         // a faculty decision: declined
    apt('REJECTED', { autoRejected: true }), // the system rejected it: expired
    apt('REJECTED', { autoRejected: true }),
  ];
  const fac = facultyCsv(appointments);
  assert.ok(/\r\nDeclined,1\r\n/.test(fac), fac);
  assert.ok(/\r\nExpired \(not answered in time\),2\r\n/.test(fac), fac);
  const shared = sharedCsv(appointments);
  assert.ok(/\r\nDeclined by faculty,1\r\n/.test(shared), shared);
  assert.ok(/\r\nExpired \(not answered in time\),2\r\n/.test(shared), shared);
});

test('the exports hold counts and labels only: no student names or section-level identities', () => {
  const appointments = [apt('COMPLETED'), apt('MISSED (STUDENT)', { studentName: 'Juan dela Cruz', studentId: 's2' })];
  for (const csv of [facultyCsv(appointments), sharedCsv(appointments), sharedCsv(appointments, 'DEAN')]) {
    assert.ok(!csv.includes('Maria Santos'));
    assert.ok(!csv.includes('Juan dela Cruz'));
  }
});

test('the Dean export omits the Admin-only profile completion section', () => {
  const appointments = [apt('COMPLETED')];
  assert.ok(!sharedCsv(appointments, 'DEAN').includes('Profile completion'));
  assert.ok(sharedCsv(appointments, 'ADMIN').includes('Profile completion'));
});
