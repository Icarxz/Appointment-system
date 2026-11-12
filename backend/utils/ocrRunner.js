// Runs the Python OCR program (ocr/schedule_ocr.py) on one PDF and returns its draft JSON.
// No shell is used (arguments are an array), the PDF lives in a private temp folder that is always deleted, and the run is
// time-limited. Only one OCR runs at a time: it is CPU heavy and the server is small.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

class OcrError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// The OCR program reports a missing tool the same way as an unreadable PDF ({status:'FAILED', error}). Tell them apart: a missing program is
// the server's problem, not the file's, and must not blame the PDF.
const MISSING_TOOL = /tesseract is not installed|not in your path|no module named|pdftoppm|poppler|cannot import|command not found/i;

let running = false;
const isBusy = () => running;

function runOcr(buf, opts = {}) {
  const python = opts.python || process.env.OCR_PYTHON || 'python3';
  const script = opts.script || process.env.OCR_SCRIPT || path.join(__dirname, '..', '..', 'ocr', 'schedule_ocr.py');
  const timeoutMs = opts.timeoutMs || Number(process.env.OCR_TIMEOUT_MS) || 120000;
  const maxOut = 5 * 1024 * 1024;

  if (running) return Promise.reject(new OcrError('OCR_BUSY', 'Another schedule is being read. Try again in a minute.'));
  running = true;
  let dir;
  const done = () => { running = false; if (dir) fs.rm(dir, { recursive: true, force: true }, () => {}); };

  return new Promise((resolve, reject) => {
    const finish = (fn, v) => { if (finish.called) return; finish.called = true; done(); fn(v); };
    try {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-ocr-'));
      const pdfPath = path.join(dir, 'upload.pdf');
      fs.writeFileSync(pdfPath, buf, { mode: 0o600 });
      const child = spawn(python, [script, pdfPath], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
      let out = '', tooBig = false, timedOut = false;
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
      child.stdout.on('data', d => { out += d; if (out.length > maxOut) { tooBig = true; child.kill('SIGKILL'); } });
      child.stderr.on('data', () => {}); // never forwarded: it can contain file paths
      child.on('error', e => { clearTimeout(timer); finish(reject, new OcrError(e.code === 'ENOENT' ? 'OCR_UNAVAILABLE' : 'OCR_FAILED',
        e.code === 'ENOENT' ? 'The schedule reader is not installed on this server.' : 'The schedule reader could not start.')); });
      child.on('close', code => {
        clearTimeout(timer);
        if (timedOut) return finish(reject, new OcrError('OCR_TIMEOUT', 'Reading the PDF took too long. Try a cleaner scan.'));
        if (tooBig) return finish(reject, new OcrError('OCR_BAD_OUTPUT', 'The schedule reader returned too much data.'));
        let json;
        try { json = JSON.parse(out); } catch { json = null; }
        if (!json || typeof json !== 'object') return finish(reject, new OcrError(code === 0 ? 'OCR_BAD_OUTPUT' : 'OCR_FAILED', 'The schedule reader could not read this PDF.'));
        // The program reports an unsupported layout as { status: 'FAILED', error } with exit code 2: pass it on, the reader turns it into a message
        if (code !== 0 && json.status !== 'FAILED') return finish(reject, new OcrError('OCR_FAILED', 'The schedule reader could not read this PDF.'));
        if (json.status === 'FAILED' && MISSING_TOOL.test(String(json.error || ''))) {
          return finish(reject, new OcrError('OCR_UNAVAILABLE', 'The schedule reader is not fully installed on this server (it needs Tesseract and poppler or PyMuPDF). See ocr/README.md.'));
        }
        finish(resolve, json);
      });
    } catch (e) { finish(reject, new OcrError('OCR_FAILED', 'The schedule reader could not start.')); }
  });
}

module.exports = { runOcr, isBusy, OcrError };
