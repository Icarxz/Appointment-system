// CSV export of the analytics reports. Pure functions (no database), so they can be unit-tested.
//
// Names, reasons and notes are typed by users. A text cell that starts with = + - @ (or a tab or
// carriage return) can be run as a formula when the file is opened in Excel or Sheets ("CSV
// injection"), so such text cells get a leading apostrophe and stay plain text. Numbers are not touched.
// Trade-off: Excel shows that apostrophe when it opens a CSV, so a name like "-Ana" appears as "'-Ana".
// The reports hold counts and labels, not student names, so this is rare in practice.

const FORMULA_START = /^[=+\-@\t\r]/;

function csvCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  let s = String(value);
  if (FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const csvRow = (cells) => cells.map(csvCell).join(',');

// sections: [{ title, header?: [...], rows: [[...], ...] }]. A UTF-8 byte-order mark is added so Excel reads
// names like "Niño" correctly. Lines end with CRLF as the CSV standard says.
function buildCsv(sections) {
  const lines = [];
  sections.forEach((s, i) => {
    if (i > 0) lines.push('');
    lines.push(csvRow([s.title]));
    if (s.header) lines.push(csvRow(s.header));
    (s.rows || []).forEach((r) => lines.push(csvRow(r)));
  });
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

const pct = (n) => (n === null || n === undefined ? '' : `${n}%`);
const cohortLabel = (c) => [c.program, c.year ? `Year ${c.year}` : '', c.section].filter(Boolean).join(' ');

function commonSections({ purposes, cohorts, appeals }) {
  return [
    { title: 'Why students come', header: ['Purpose', 'Requests', 'Percent'], rows: (purposes?.items || []).map((p) => [p.label, p.count, `${p.percent}%`]) },
    { title: 'Students by program, year level and section', header: ['Program / year / section', 'Students'], rows: (cohorts || []).map((c) => [cohortLabel(c), c.count]) },
    { title: 'Student appeals by reason (record only)', header: ['Program / year / section', 'Reason', 'Appeals'], rows: (appeals?.rows || []).map((r) => [cohortLabel(r), r.reason, r.count]) },
  ];
}

function sharedReportCsv(report, { generatedAt, role }) {
  const k = report.kpis, o = report.outcomes;
  const sections = [
    { title: 'CCIS Sync: Reports & Analytics', rows: [['Generated', generatedAt], ['Prepared for', role]] },
    { title: 'Summary', header: ['Measure', 'Value'], rows: [
      ['Requests (total)', k.requests.total], ['Requests (last 4 weeks)', k.requests.last4], ['Requests (the 4 weeks before)', k.requests.prev4],
      ['Completed', k.completed.total], ['Missed by students', k.missed.student], ['Missed by faculty', k.missed.faculty],
      ['Cancelled by students', o.cancelledStudent], ['Cancelled by faculty', o.cancelledFaculty],
      ['Declined by faculty', o.declined], ['Expired (not answered in time)', o.expired],
      ['Completion rate', pct(k.completionRate)], ['Missed rate', pct(k.missedRate)], ['Active faculty', k.activeFaculty],
    ] },
    { title: 'Faculty load', header: ['Faculty', 'Requests', 'Completed'], rows: (report.facultyLoad || []).map((f) => [f.name, f.requests, f.completed]) },
    ...commonSections({ purposes: report.purposes, cohorts: report.cohortStudents, appeals: report.appeals }),
    { title: 'Appeals summary', rows: [['Appeal rate', pct(report.appeals?.summary?.appealRate)], ['Student appeals', report.appeals?.summary?.total], ['Faculty appeals', report.appeals?.summary?.faculty?.made]] },
  ];
  if (report.accountHealth) {
    sections.push({ title: 'Profile completion (counts only)', header: ['Role', 'Complete', 'Incomplete'], rows: (report.accountHealth.profile || []).map((p) => [p.role, p.complete, p.incomplete]) });
  }
  return buildCsv(sections);
}

function facultyReportCsv(report, { generatedAt, name }) {
  const k = report.kpis, o = report.outcomes;
  return buildCsv([
    { title: 'CCIS Sync: My Analytics', rows: [['Generated', generatedAt], ['Faculty', name]] },
    { title: 'Summary', header: ['Measure', 'Value'], rows: [
      ['Requests (total)', k.requests.total], ['Requests (last 4 weeks)', k.requests.last4], ['Requests (the 4 weeks before)', k.requests.prev4],
      ['Completed', k.completed.total], ['Approved', k.approved.total], ['Declined', o.declined], ['Expired (not answered in time)', o.expired],
      ['Missed by students', o.studentNoShows], ['Missed by me', o.missedByFaculty],
      ['Cancelled by students', o.cancelledByStudent], ['Cancelled by me', o.cancelledByFaculty],
      ['Completion rate', pct(k.completionRate)], ['Missed rate', pct(k.missedRate)], ['Approval rate', pct(o.approvalRate)],
      ['Different students', report.students?.uniqueStudents],
    ] },
    ...commonSections({ purposes: report.students?.purposes, cohorts: report.students?.cohorts, appeals: report.appeals }),
  ]);
}

module.exports = { csvCell, csvRow, buildCsv, sharedReportCsv, facultyReportCsv };
