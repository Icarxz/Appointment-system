const { buildCsv } = require('./csvExport');
const { formatManilaDateTime } = require('./manilaTime');

const personalAppointmentFilter = (userId) => ({
  $or: [{ studentId: userId }, { facultyId: userId }],
});

const personalHistoryFilter = (userId) => ({ userId });

function personalHistoryCsv(history) {
  const events = (history.events || []).map(event => [
    formatManilaDateTime(event.occurredAt), event.eventType, event.actorRole, JSON.stringify(event.details || {}),
  ]);
  const appointments = (history.appointments || []).map(appointment => [
    formatManilaDateTime(appointment.createdAt), 'APPOINTMENT', appointment.date, appointment.time, appointment.status,
    appointment.reason, appointment.casePresented, appointment.interventionTaken, appointment.remarks,
  ]);
  const statuses = (history.statuses || []).map(entry => [formatManilaDateTime(entry.timestamp), 'FACULTY_STATUS', entry.status, entry.note]);
  const classes = (history.schedule && history.schedule.classes || []).map(block => [
    'Current class', block.dayOfWeek, block.startTime, block.endTime, block.subject, block.room,
  ]);
  const consultationHours = (history.schedule && history.schedule.consultationHours || []).map(block => [
    'Consultation hours', block.dayOfWeek, block.startTime, block.endTime,
  ]);
  const addedHours = (history.schedule && history.schedule.addedHours || []).map(block => [
    'Added consultation hours', block.dayOfWeek, block.startTime, block.endTime,
  ]);
  const imports = (history.schedule && history.schedule.imports || []).flatMap(entry => [
    [
      formatManilaDateTime(entry.createdAt), entry.status, entry.effectivityDate, entry.term, entry.academicYear,
      'Import record', '', '', '', '', '',
    ],
    ...(entry.classes || []).map(block => [
      formatManilaDateTime(entry.createdAt), entry.status, entry.effectivityDate, entry.term, entry.academicYear,
      'Class', block.dayOfWeek, block.startTime, block.endTime, block.subject, block.room,
    ]),
    ...(entry.consultationHours || []).map(block => [
      formatManilaDateTime(entry.createdAt), entry.status, entry.effectivityDate, entry.term, entry.academicYear,
      'Consultation', block.dayOfWeek, block.startTime, block.endTime, '', '',
    ]),
  ]);

  return buildCsv([
    { title: 'Account', header: ['Item', 'Timestamp'], rows: [['First activated', formatManilaDateTime(history.activatedAt)]] },
    { title: 'My account and schedule events', header: ['Timestamp', 'Event', 'Actor role', 'Details'], rows: events },
    { title: 'My appointments and consultations', header: ['Created', 'Type', 'Date', 'Time', 'Status', 'Purpose', 'Case presented', 'Intervention', 'Remarks'], rows: appointments },
    { title: 'My status history', header: ['Timestamp', 'Type', 'Status', 'Note'], rows: statuses },
    { title: 'My current schedule', header: ['Type', 'Day of week', 'Start', 'End', 'Subject', 'Room'], rows: [...classes, ...consultationHours, ...addedHours] },
    { title: 'Schedule import history', header: ['Timestamp', 'Status', 'Effective date', 'Term', 'Academic year', 'Block type', 'Day of week', 'Start', 'End', 'Subject', 'Room'], rows: imports },
  ]);
}

module.exports = { personalAppointmentFilter, personalHistoryFilter, personalHistoryCsv };
