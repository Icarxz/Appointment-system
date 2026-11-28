import assert from 'node:assert/strict';
import test from 'node:test';
import {
  blockingIssueMessage,
  IMPORT_BLOCKING_ACTION,
  IMPORT_WARNING_ACTION,
  parsedWarningDisplay,
} from './scheduleImportMessages.ts';

test('time-label warnings explain the correction without exposing raw OCR counts', () => {
  const display = parsedWarningDisplay({
    code: 'time-labels-unverified',
    message: '2 of 21 printed time labels could not be read; 97% confidence.',
    ref: null,
  });
  assert.equal(IMPORT_WARNING_ACTION, 'Double check for mistakes. You can still submit.');
  assert.match(display.message, /Compare the calendar with your PDF/);
  assert.doesNotMatch(display.message, /2 of 21|97%/);
});

test('skipped OCR marks appear only in the collapsed-section detail value', () => {
  const rawDetails = 'Left out because these are not classes: L; (y;';
  const display = parsedWarningDisplay({ code: 'ignored-marks', message: rawDetails, ref: null });
  assert.match(display.message, /Some marks in the PDF were skipped/);
  assert.doesNotMatch(display.message, /L;|\(y;/);
  assert.equal(display.skippedDetails, rawDetails);
});

test('blocking ownership and overlap messages do not expose OCR names', () => {
  const mismatch = blockingIssueMessage({
    code: 'IDENTITY_MISMATCH',
    message: 'The printed name "OCR PERSON" does not match the account.',
    ref: null,
  });
  const overlap = blockingIssueMessage({
    code: 'CLASS_INVALID',
    message: 'An approved consultation overlaps the class.',
    ref: { type: 'class', id: 'c1' },
  }, { id: 'c1', dayOfWeek: 2, startTime: '10:00', endTime: '11:30', needsReview: false, reviewReasons: [] });
  assert.equal(IMPORT_BLOCKING_ACTION, 'Fix this before you can continue.');
  assert.doesNotMatch(mismatch, /OCR PERSON/);
  assert.match(overlap, /Move or remove the class at Tue 10:00 to 11:30/);
});
