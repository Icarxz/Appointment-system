// Checks for an uploaded schedule PDF. Pure functions: the route decides what to do with the answer.
const crypto = require('crypto');

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_PAGES = 10; // the importer reads page 1 only; a huge document is almost certainly the wrong file

// Returns { ok: true, hash } or { ok: false, error }.
function checkPdf(buf) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) return { ok: false, error: 'Choose a PDF file to upload.' };
  if (buf.length > MAX_PDF_BYTES) return { ok: false, error: 'That PDF is larger than 10 MB.' };
  // A real PDF starts with %PDF- (a few bytes of junk before it are tolerated) and ends with %%EOF
  if (buf.subarray(0, 1024).indexOf('%PDF-') === -1) return { ok: false, error: 'That file is not a PDF.' };
  if (buf.subarray(Math.max(0, buf.length - 2048)).indexOf('%%EOF') === -1) return { ok: false, error: 'That PDF looks incomplete or damaged.' };
  // Rough page count: "/Type /Page" objects that are not "/Pages". Only a guard, never used for reading.
  const pages = (buf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) || []).length;
  if (pages > MAX_PAGES) return { ok: false, error: `That PDF has ${pages} pages. Upload the one-page faculty load form.` };
  return { ok: true, hash: crypto.createHash('sha256').update(buf).digest('hex') };
}

module.exports = { checkPdf, MAX_PDF_BYTES, MAX_PAGES };
