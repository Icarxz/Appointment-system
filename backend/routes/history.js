const express = require('express');
const { requireAuth } = require('../middleware/auth');
const User = require('../models/User');
const Appointment = require('../models/Appointment');
const HistoryEvent = require('../models/HistoryEvent');
const Schedule = require('../models/Schedule');
const ConsultationHours = require('../models/ConsultationHours');
const AddedConsultationHours = require('../models/AddedConsultationHours');
const ScheduleImport = require('../models/ScheduleImport');
const StatusHistory = require('../models/StatusHistory');
const { personalAppointmentFilter, personalHistoryFilter, personalHistoryCsv } = require('../utils/personalHistory');

const router = express.Router();
const ALL_ROLES = ['STUDENT', 'FACULTY', 'DEAN', 'ADMIN'];

async function loadPersonalHistory(userId) {
  const [user, appointments, events, classes, consultationHours, addedHours, imports, statuses] = await Promise.all([
    User.findById(userId).select('activatedAt').lean(),
    Appointment.find(personalAppointmentFilter(userId))
      .select('studentId facultyId studentName studentSection date time duration reason status casePresented interventionTaken remarks completedAt appeal createdAt updatedAt')
      .populate('facultyId', 'name')
      .populate('studentId', 'name')
      .sort({ createdAt: -1 }).lean(),
    HistoryEvent.find(personalHistoryFilter(userId)).sort({ occurredAt: -1 }).lean(),
    Schedule.find({ facultyId: userId }).select('dayOfWeek startTime endTime subject room').sort({ dayOfWeek: 1, startTime: 1 }).lean(),
    ConsultationHours.find({ facultyId: userId }).select('dayOfWeek startTime endTime').sort({ dayOfWeek: 1, startTime: 1 }).lean(),
    AddedConsultationHours.find({ facultyId: userId }).select('dayOfWeek startTime endTime').sort({ dayOfWeek: 1, startTime: 1 }).lean(),
    ScheduleImport.find({ facultyId: userId }).select('status effectivityDate term academicYear createdAt activatedAt classes consultationHours').sort({ createdAt: -1 }).lean(),
    StatusHistory.find({ facultyId: userId }).select('status note timestamp').sort({ timestamp: -1 }).lean(),
  ]);
  if (!user) return null;
  const personalAppointments = appointments.map(appointment => ({
    ...appointment,
    historyRole: String(appointment.studentId && appointment.studentId._id || appointment.studentId) === String(userId)
      ? 'STUDENT'
      : 'FACULTY',
  }));
  return {
    activatedAt: user.activatedAt,
    appointments: personalAppointments,
    events,
    statuses,
    schedule: { classes, consultationHours, addedHours, imports },
  };
}

router.get('/me', requireAuth(ALL_ROLES), async (req, res) => {
  try {
    const history = await loadPersonalHistory(req.user.userId);
    if (!history) return res.status(404).json({ error: 'User not found.' });
    res.json(history);
  } catch (error) {
    console.error('Personal history load failed:', error.message);
    res.status(500).json({ error: 'Could not load your history.' });
  }
});

router.get('/me/export.csv', requireAuth(ALL_ROLES), async (req, res) => {
  try {
    const history = await loadPersonalHistory(req.user.userId);
    if (!history) return res.status(404).json({ error: 'User not found.' });
    res.setHeader('Content-Disposition', 'attachment; filename="my-history.csv"');
    res.type('text/csv; charset=utf-8').send(personalHistoryCsv(history));
  } catch (error) {
    console.error('Personal history export failed:', error.message);
    res.status(500).json({ error: 'Could not export your history.' });
  }
});

module.exports = router;
