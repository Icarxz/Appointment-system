const test = require('node:test');
const assert = require('node:assert/strict');
const { describeEvent } = require('./eventDescription');

test('describes account changes without exposing event details', () => {
  assert.equal(describeEvent({ eventType: 'ACCOUNT_PROVISIONED', details: { email: 'private@example.test' } }), 'Account provisioned.');
  assert.equal(describeEvent({
    eventType: 'POSITION_CHANGED',
    details: { fromPosition: 'Faculty', toPosition: 'Dean', sensitive: 'not shown' },
  }), 'Position changed from Faculty to Dean.');
  assert.equal(describeEvent({ eventType: 'SIGN_IN_BLOCKED', details: { accountStatus: 'ARCHIVED' } }), 'Sign-in blocked for an archived account.');
});

test('distinguishes system appointment outcomes from people actions', () => {
  assert.equal(describeEvent({
    eventType: 'APPOINTMENT_STATUS_CHANGED',
    actorRole: 'SYSTEM',
    details: { toStatus: 'REJECTED' },
  }), 'Appointment request automatically rejected by the system.');
  assert.equal(describeEvent({
    eventType: 'APPOINTMENT_STATUS_CHANGED',
    actorRole: 'STUDENT',
    details: { toStatus: 'CANCELLED BY STUDENT' },
  }), 'Appointment cancelled by the student.');
  assert.equal(describeEvent({
    eventType: 'APPOINTMENT_STATUS_CHANGED',
    actorRole: 'SYSTEM',
    details: { toStatus: 'MISSED (FACULTY)' },
  }), 'Appointment automatically marked as missed by the system.');
});

test('describes schedule and notice actions', () => {
  assert.equal(describeEvent({ eventType: 'SCHEDULE_IMPORT_STAGED' }), 'Schedule import confirmed and scheduled.');
  assert.equal(describeEvent({ eventType: 'SCHEDULE_IMPORT_FAILED' }), 'Schedule import could not be applied.');
  assert.equal(describeEvent({ eventType: 'NOTICE_POSTED', details: { reason: 'private text' } }), 'A notice was posted.');
  assert.equal(describeEvent({ eventType: 'ACCOUNT_ONBOARDED' }), 'Account onboarding completed.');
  assert.equal(describeEvent({ eventType: 'FACULTY_STATUS_CLEARED' }), 'Faculty status cleared.');
  assert.equal(describeEvent({ eventType: 'UNKNOWN_EVENT', details: { token: 'secret' } }), 'Activity recorded.');
});
