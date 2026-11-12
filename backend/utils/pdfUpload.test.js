const test = require('node:test');
const assert = require('node:assert');
const { checkPdf, MAX_PDF_BYTES } = require('./pdfUpload');

const pdf = (body = '') => Buffer.from(`%PDF-1.4\n${body}\n%%EOF\n`);

test('accepts a well-formed PDF and returns a stable SHA-256', () => {
  const a = checkPdf(pdf('1 0 obj /Type /Page'));
  assert.ok(a.ok); assert.match(a.hash, /^[0-9a-f]{64}$/);
  assert.strictEqual(checkPdf(pdf('1 0 obj /Type /Page')).hash, a.hash);
});
test('rejects empty, non-buffer, wrong type, truncated and oversized files', () => {
  assert.strictEqual(checkPdf(Buffer.alloc(0)).ok, false);
  assert.strictEqual(checkPdf(undefined).ok, false);
  assert.strictEqual(checkPdf({}).ok, false);
  assert.match(checkPdf(Buffer.from('MZ not a pdf')).error, /not a PDF/);
  assert.match(checkPdf(Buffer.from('%PDF-1.4\nno ending')).error, /incomplete/);
  const big = Buffer.concat([pdf(), Buffer.alloc(MAX_PDF_BYTES)]);
  assert.match(checkPdf(big).error, /10 MB/);
});
test('page guard counts /Page but not /Pages', () => {
  assert.ok(checkPdf(pdf('/Type /Pages /Type /Page')).ok);
  assert.match(checkPdf(pdf('/Type /Page '.repeat(11))).error, /11 pages/);
});
