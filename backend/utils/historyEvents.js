const HistoryEvent = require('../models/HistoryEvent');

async function appendHistoryEvent({ userId, eventType, details = {}, actorId = null, actorRole = 'SYSTEM', occurredAt = new Date() }) {
  if (!userId || !eventType) throw new Error('A history event requires a user and event type.');
  return HistoryEvent.create({ userId, eventType, details, actorId, actorRole, occurredAt });
}

function appointmentHistoryEvents(appointment, eventType, { actorId = null, actorRole = 'SYSTEM', details = {}, occurredAt = new Date() } = {}) {
  if (!appointment || !appointment._id || !eventType) throw new Error('Appointment history requires an appointment and event type.');
  const people = [
    { userId: appointment.studentId, recordRole: 'STUDENT' },
    { userId: appointment.facultyId, recordRole: 'FACULTY' },
  ].filter((person, index, list) => person.userId && list.findIndex(other => String(other.userId) === String(person.userId)) === index);

  return people.map(({ userId, recordRole }) => ({
    userId,
    actorId,
    actorRole,
    eventType,
    occurredAt,
    details: {
      ...details,
      appointmentId: appointment._id,
      date: appointment.date,
      time: appointment.time,
      status: appointment.status,
      recordRole,
    },
  }));
}

async function appendAppointmentHistory(appointment, eventType, options = {}) {
  const events = appointmentHistoryEvents(appointment, eventType, options);
  if (!events.length) return [];
  return HistoryEvent.insertMany(events);
}

module.exports = { appendHistoryEvent, appendAppointmentHistory, appointmentHistoryEvents };
