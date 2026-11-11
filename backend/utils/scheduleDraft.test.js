const test = require('node:test');
const assert = require('node:assert');
const draft = require('../../ocr/fixtures/percy.extracted.json');
const { reviewScheduleDraft, compareNames } = require('./scheduleDraft');

const clone = () => JSON.parse(JSON.stringify(draft));
const codes = (r) => r.blocking.map(b => b.code);
const target = { name: 'Percy, Carl Spence D.' };

test('compareNames is conservative', () => {
  assert.strictEqual(compareNames('CARL SPENCE D. PERCY, MIT', 'Percy, Carl Spence D.'), 'match');
  assert.strictEqual(compareNames('CARL SPENCE PERCY, MIT', 'Carl Spence Percy'), 'match');
  assert.strictEqual(compareNames('CARL SPENCE PERCY, MIT', 'Maria Santos'), 'mismatch');
  assert.strictEqual(compareNames('CARL ATES MIT', 'Percy, Carl Spence D.'), 'mismatch');   // garbled read must NOT pass
  assert.strictEqual(compareNames(null, 'Percy'), 'unknown');
});

test('the real Percy draft cannot be confirmed until a person verifies the covered name', () => {
  const r = reviewScheduleDraft(clone(), { target });
  assert.ok(codes(r).includes('identity-mismatch') || codes(r).includes('identity-unverified'));
  assert.strictEqual(r.canConfirm, false);
});

test('Percy draft: a reviewer-corrected printed name makes it confirmable, and the only other finding is the ICT 108 review flag', () => {
  const d = clone();
  d.metadata.facultyName = 'CARL SPENCE D. PERCY, MIT';          // reviewer-provided value
  d.metadata.facultyNameSource = 'manual_review';
  d.metadata.facultyNameNeedsReview = false;
  d.metadata.facultyNameConfidence = 100;
  const r = reviewScheduleDraft(d, { target, nameVerifiedByReviewer: true });
  assert.deepStrictEqual(r.blocking, []);
  assert.strictEqual(r.canConfirm, true);
  assert.strictEqual(r.teachingHours, 15);
  assert.deepStrictEqual(r.warnings.filter(w => w.code === 'review-field').map(w => w.flag), ['room-prefix-check']);
});

test('identity mismatch blocks even when the reviewer flag is set', () => {
  const d = clone(); d.metadata.facultyName = 'MARIA SANTOS, MIT';
  assert.ok(codes(reviewScheduleDraft(d, { target, nameVerifiedByReviewer: true })).includes('identity-mismatch'));
});

test('consultation hours must total exactly 4 hours and not overlap a class', () => {
  const short = clone(); short.metadata.facultyName = 'CARL SPENCE PERCY'; short.consultationHours.pop();
  assert.ok(codes(reviewScheduleDraft(short, { target, nameVerifiedByReviewer: true })).includes('consultation-total'));
  const clash = clone(); clash.consultationHours[0] = { ...clash.consultationHours[0], dayOfWeek: 1, startTime: '11:30', endTime: '13:30' };
  assert.ok(codes(reviewScheduleDraft(clash, { target, nameVerifiedByReviewer: true })).includes('consultation-overlaps-class'));
});

test('class rules reuse validateClassBlock: Sunday and 7 PM are allowed, 7:30 PM, 15-minute times and overlaps are blocked', () => {
  const d = clone();
  d.classes = [
    { dayOfWeek: 0, startTime: '18:30', endTime: '19:00', subject: 'Sunday class (X 1-A)', room: 'R1', confidence: 90, flags: [] },
    { dayOfWeek: 1, startTime: '18:30', endTime: '19:30', subject: 'Too late', room: 'R1', confidence: 90, flags: [] },
    { dayOfWeek: 1, startTime: '09:15', endTime: '10:00', subject: 'Off grid', room: 'R1', confidence: 90, flags: [] },
    { dayOfWeek: 2, startTime: '09:00', endTime: '10:00', subject: 'A', room: 'R1', confidence: 90, flags: [] },
    { dayOfWeek: 2, startTime: '09:30', endTime: '10:30', subject: 'B', room: 'R2', confidence: 90, flags: [] },
    { dayOfWeek: 3, startTime: '09:00', endTime: '10:00', subject: 'No room', room: '', confidence: 90, flags: [] },
  ];
  d.consultationHours = [{ dayOfWeek: 6, startTime: '08:00', endTime: '12:00' }];
  const r = reviewScheduleDraft(d, { target, nameVerifiedByReviewer: true });
  assert.deepStrictEqual(r.blocking.filter(b => b.code === 'invalid-class').map(b => b.index), [1, 2, 4, 5]);
  assert.ok(!r.blocking.some(b => b.index === 0));
});

test('approved future appointments block; pending ones only warn', () => {
  const d = clone(); d.metadata.facultyName = 'CARL SPENCE D. PERCY, MIT';
  const nextMonday = '2026-11-16';                                  // a Monday; Percy teaches 11:30-12:30
  const approved = reviewScheduleDraft(d, { target, nameVerifiedByReviewer: true, approved: [{ date: nextMonday, time: '12:00', duration: 60 }] });
  assert.ok(codes(approved).includes('invalid-class'));
  const pending = reviewScheduleDraft(d, { target, nameVerifiedByReviewer: true, pending: [{ date: nextMonday, time: '12:00', duration: 60 }] });
  assert.deepStrictEqual(pending.blocking, []);
  assert.ok(pending.warnings.some(w => w.code === 'pending-overlap'));
});

test('failed or malformed drafts are unsupported, and low OCR confidence is a warning not a silent pass', () => {
  assert.strictEqual(reviewScheduleDraft({ status: 'FAILED', error: 'bad' }, { target }).canConfirm, false);
  assert.strictEqual(reviewScheduleDraft(null, { target }).blocking[0].code, 'unsupported-document');
  const d = clone(); d.classes[0].confidence = 40;
  assert.ok(reviewScheduleDraft(d, { target, nameVerifiedByReviewer: true }).warnings.some(w => w.flag === 'low-confidence'));
});
