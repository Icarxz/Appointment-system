const test = require('node:test');
const assert = require('node:assert/strict');
const { personalAppointmentFilter, personalHistoryFilter, personalHistoryCsv } = require('./personalHistory');
const { appointmentHistoryEvents } = require('./historyEvents');

test('personal history query scopes can target only the authenticated user', () => {
  assert.deepEqual(personalAppointmentFilter('u1'), {
    $or: [{ studentId: 'u1' }, { facultyId: 'u1' }],
  });
  assert.deepEqual(personalHistoryFilter('u1'), { userId: 'u1' });
});

test('appointment changes append separate owner records with role and status snapshots', () => {
  const events = appointmentHistoryEvents({
    _id: 'apt1', studentId: 'student1', facultyId: 'faculty1', date: '2026-03-01', time: '10:00', status: 'COMPLETED',
  }, 'APPOINTMENT_STATUS_CHANGED', {
    actorId: 'faculty1', actorRole: 'FACULTY', details: { fromStatus: 'APPROVED', toStatus: 'COMPLETED' },
    occurredAt: new Date('2026-03-01T02:00:00.000Z'),
  });

  assert.equal(events.length, 2);
  assert.deepEqual(events.map(event => [event.userId, event.details.recordRole]), [
    ['student1', 'STUDENT'],
    ['faculty1', 'FACULTY'],
  ]);
  assert.equal(events[0].details.fromStatus, 'APPROVED');
  assert.equal(events[0].details.status, 'COMPLETED');
});

test('personal history CSV includes schedule and appointment history and guards formula cells', () => {
  const csv = personalHistoryCsv({
    events: [{ occurredAt: '2026-01-01T00:00:00.000Z', eventType: 'ROLE_CHANGED', actorRole: 'ADMIN', details: {} }],
    appointments: [{ createdAt: '2026-01-02T00:00:00.000Z', date: '2026-01-03', time: '10:00', status: 'COMPLETED', reason: '=2+2' }],
    activatedAt: '2026-01-01T00:00:00.000Z',
    schedule: {
      classes: [{ dayOfWeek: 1, startTime: '09:00', endTime: '10:00', subject: 'CS1', room: 'A1' }],
      consultationHours: [],
      addedHours: [],
      imports: [{ createdAt: '2026-01-04T00:00:00.000Z', status: 'ACTIVE', effectivityDate: '2026-01-05', classes: [{ subject: 'CS2', dayOfWeek: 2 }], consultationHours: [] }],
    },
  });

  assert.match(csv, /ROLE_CHANGED/);
  assert.match(csv, /First activated/);
  assert.match(csv, /Current class/);
  assert.match(csv, /Import record/);
  assert.match(csv, /CS2/);
  assert.match(csv, /'=2\+2/);
});
