const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runOcr, isBusy } = require('./ocrRunner');

// Fake "OCR programs": small Node scripts run through process.execPath, so no Python is needed
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-ocr-'));
const script = (name, body) => { const p = path.join(dir, name); fs.writeFileSync(p, body); return p; };
const ok = script('ok.js', `const fs=require('fs');const p=process.argv[2];console.log(JSON.stringify({status:'OK',bytes:fs.readFileSync(p).length,pdf:p}));`);
const bad = script('bad.js', `console.log('not json');`);
const crash = script('crash.js', `process.exit(1);`);
const failed = script('failed.js', `console.log(JSON.stringify({status:'FAILED',error:'layout'}));process.exit(2);`);
const noTess = script('notess.js', `console.log(JSON.stringify({status:'FAILED',error:"tesseract is not installed or it's not in your PATH. See README file for more information."}));process.exit(2);`);
const slow = script('slow.js', `setTimeout(()=>{},60000);`);
const opts = s => ({ python: process.execPath, script: s });
const tmpLeft = () => fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('sched-ocr-'));

test('returns the program output, passes the PDF by path, and deletes the temp folder', async () => {
  const out = await runOcr(Buffer.from('hello'), opts(ok));
  assert.strictEqual(out.bytes, 5);
  await new Promise(r => setTimeout(r, 100));
  assert.strictEqual(fs.existsSync(out.pdf), false);
  assert.strictEqual(tmpLeft().length, 0);
  assert.strictEqual(isBusy(), false);
});
test('typed errors: bad output, crash, missing interpreter', async () => {
  await assert.rejects(runOcr(Buffer.from('x'), opts(bad)), { code: 'OCR_BAD_OUTPUT' });
  await assert.rejects(runOcr(Buffer.from('x'), opts(crash)), { code: 'OCR_FAILED' });
  await assert.rejects(runOcr(Buffer.from('x'), { python: '/no/such/python', script: ok }), { code: 'OCR_UNAVAILABLE' });
  assert.strictEqual(isBusy(), false);
});
test('a FAILED draft (unsupported layout) is passed through, not thrown', async () => {
  const out = await runOcr(Buffer.from('x'), opts(failed));
  assert.strictEqual(out.status, 'FAILED');
});
test('a missing OCR tool is reported as OCR_UNAVAILABLE, not as a bad PDF', async () => {
  await assert.rejects(runOcr(Buffer.from('x'), opts(noTess)), e => e.code === 'OCR_UNAVAILABLE' && /not fully installed/.test(e.message) && !/could not read this PDF|could not be read/.test(e.message));
});
test('timeout kills the program and cleans up', async () => {
  await assert.rejects(runOcr(Buffer.from('x'), { ...opts(slow), timeoutMs: 300 }), { code: 'OCR_TIMEOUT' });
  await new Promise(r => setTimeout(r, 100));
  assert.strictEqual(tmpLeft().length, 0);
  assert.strictEqual(isBusy(), false);
});
test('only one run at a time', async () => {
  const first = runOcr(Buffer.from('x'), { ...opts(slow), timeoutMs: 400 });
  await assert.rejects(runOcr(Buffer.from('x'), opts(ok)), { code: 'OCR_BUSY' });
  await assert.rejects(first, { code: 'OCR_TIMEOUT' });
});
