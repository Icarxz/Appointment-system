const express = require('express');
const mongoose = require('mongoose');
const { requireAuth } = require('../middleware/auth');
const User = require('../models/User');
const Appointment = require('../models/Appointment');
const HistoryEvent = require('../models/HistoryEvent');
const Term = require('../models/Term');
const Schedule = require('../models/Schedule');
const ConsultationHours = require('../models/ConsultationHours');
const AddedConsultationHours = require('../models/AddedConsultationHours');
const ScheduleImport = require('../models/ScheduleImport');
const StatusHistory = require('../models/StatusHistory');
const { personalAppointmentFilter, personalHistoryFilter, personalHistoryCsv } = require('../utils/personalHistory');
const { isValidDateString, matchesTermFilter, termForDate } = require('../utils/termCalendar');
const { buildCsv } = require('../utils/csvExport');
const { describeEvent } = require('../utils/eventDescription');
const { formatManilaDateTime } = require('../utils/manilaTime');

const router = express.Router();
const ALL_ROLES = ['STUDENT', 'FACULTY', 'DEAN', 'ADMIN'];
const ACTIVITY_GROUPS = {
  ACCOUNT: [
    'ACCOUNT_ACTIVATED', 'ACCOUNT_ONBOARDED', 'ACCOUNT_DETAILS_CONFIRMED', 'ACCOUNT_PROVISIONED',
    'ACCOUNT_DISABLED', 'ACCOUNT_ENABLED', 'ROLE_CHANGED', 'POSITION_CHANGED', 'PROFILE_UPDATED',
    'SIGN_IN_BLOCKED',
  ],
  SCHEDULE: [
    'SCHEDULE_IMPORT_STAGED', 'SCHEDULE_IMPORT_FAILED', 'SCHEDULE_IMPORT_ACTIVATED',
    'SCHEDULE_IMPORT_CANCELLED', 'SCHEDULE_IMPORT_ROLLED_BACK', 'CLASS_SCHEDULE_ADDED',
    'CLASS_SCHEDULE_UPDATED', 'CLASS_SCHEDULE_REMOVED', 'ADDED_CONSULTATION_HOURS',
    'ADDED_CONSULTATION_HOURS_REMOVED', 'CONSULTATION_HOURS_REPLACED', 'NOTICE_POSTED',
    'NOTICE_CANCELLED', 'FACULTY_STATUS_SET', 'FACULTY_STATUS_CLEARED',
  ],
  APPOINTMENT: [
    'APPOINTMENT_REQUESTED', 'APPOINTMENT_STATUS_CHANGED', 'CONSULTATION_COMPLETED',
    'CONSULTATION_LOG_UPDATED', 'APPEAL_SUBMITTED',
  ],
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function parsePagination(query, defaultLimit, maxLimit) {
  const page = query.page === undefined ? 1 : Number(query.page);
  const limit = query.limit === undefined ? defaultLimit : Number(query.limit);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > maxLimit) {
    return { error: `Page must be positive and limit must be between 1 and ${maxLimit}.` };
  }
  return { page, limit, skip: (page - 1) * limit };
}

function parseDateRange(query) {
  const from = query.from === undefined ? '' : String(query.from).trim();
  const to = query.to === undefined ? '' : String(query.to).trim();
  if ((from && !isValidDateString(from)) || (to && !isValidDateString(to))) {
    return { error: 'Use valid from and to dates in YYYY-MM-DD format.' };
  }
  if (from && to && from > to) return { error: 'The from date must not be after the to date.' };
  return {
    from,
    to,
    manilaRange: {
      ...(from ? { $gte: new Date(`${from}T00:00:00.000+08:00`) } : {}),
      ...(to ? { $lte: new Date(`${to}T23:59:59.999+08:00`) } : {}),
    },
  };
}

function consultationFilters(query) {
  const dates = parseDateRange(query);
  if (dates.error) return dates;
  const academicYear = query.academicYear === undefined ? '' : String(query.academicYear).trim();
  const term = query.term === undefined ? '' : String(query.term).trim();
  if (academicYear && academicYear !== 'ALL' && !/^\d{4}-\d{4}$/.test(academicYear)) {
    return { error: 'Academic year must look like 2025-2026.' };
  }
  if (term.length > 60) return { error: 'Term filter is too long.' };
  return {
    dates,
    academicYear,
    term,
    status: query.status === undefined ? '' : String(query.status).trim().toUpperCase(),
  };
}

async function loadConsultations(userId, query) {
  const filters = consultationFilters(query);
  if (filters.error) return filters;
  const appointmentFilter = personalAppointmentFilter(userId);
  if (filters.status) appointmentFilter.status = filters.status;
  if (filters.dates.from || filters.dates.to) {
    appointmentFilter.date = {
      ...(filters.dates.from ? { $gte: filters.dates.from } : {}),
      ...(filters.dates.to ? { $lte: filters.dates.to } : {}),
    };
  }
  const [terms, appointments] = await Promise.all([
    Term.find().select('academicYear name startDate endDate').lean(),
    Appointment.find(appointmentFilter)
      .select('studentId facultyId studentName studentSection date time requestedTime duration reason status cancelReason missedAt missedBy casePresented interventionTaken remarks completedAt createdAt updatedAt')
      .populate('facultyId', 'name role')
      .populate('studentId', 'name role')
      .sort({ date: -1, time: -1, createdAt: -1 }).lean(),
  ]);
  const records = appointments.map((appointment) => {
    const isStudent = String(appointment.studentId && appointment.studentId._id || appointment.studentId) === String(userId);
    const termInfo = termForDate(appointment.date, terms);
    return {
      ...appointment,
      academicYear: termInfo ? termInfo.academicYear : null,
      term: termInfo ? termInfo.name : null,
      historyRole: isStudent ? 'STUDENT' : 'FACULTY',
    };
  }).filter((appointment) => matchesTermFilter(
    appointment.academicYear && appointment.term
      ? { academicYear: appointment.academicYear, name: appointment.term }
      : null,
    { academicYear: filters.academicYear, term: filters.term },
  ));
  return { records };
}

async function resolveUserIds(value) {
  const needle = String(value || '').trim();
  if (mongoose.isValidObjectId(needle)) return [new mongoose.Types.ObjectId(needle)];
  const regex = new RegExp(escapeRegex(needle), 'i');
  const users = await User.find({ $or: [{ name: regex }, { email: regex }] }).select('_id').lean();
  return users.map((user) => user._id);
}

async function activityFilter(query) {
  const dates = parseDateRange(query);
  if (dates.error) return dates;
  const filter = {};
  if (Object.keys(dates.manilaRange).length) filter.occurredAt = dates.manilaRange;

  const group = query.group === undefined ? '' : String(query.group).trim().toUpperCase();
  if (group && !ACTIVITY_GROUPS[group]) return { error: 'Group must be ACCOUNT, SCHEDULE or APPOINTMENT.' };
  if (group) filter.eventType = { $in: ACTIVITY_GROUPS[group] };

  const and = [];
  const actor = query.actor === undefined ? '' : String(query.actor).trim();
  if (actor) {
    if (actor.toUpperCase() === 'SYSTEM') filter.actorRole = 'SYSTEM';
    else {
      const actorIds = await resolveUserIds(actor);
      filter.actorId = { $in: actorIds };
    }
  }

  const subject = query.subjectUser === undefined
    ? (query.subject === undefined ? '' : String(query.subject).trim())
    : String(query.subjectUser).trim();
  if (subject) filter.userId = { $in: await resolveUserIds(subject) };

  const text = query.text === undefined ? '' : String(query.text).trim();
  if (text) {
    if (text.length > 100) return { error: 'Text search must be 100 characters or fewer.' };
    const regex = new RegExp(escapeRegex(text), 'i');
    const textMatches = [
      { eventType: regex },
      { actorRole: regex },
      { 'details.accountStatus': regex },
      { 'details.fromStatus': regex },
      { 'details.toStatus': regex },
      { 'details.status': regex },
      { 'details.fromRole': regex },
      { 'details.toRole': regex },
      { 'details.fromPosition': regex },
      { 'details.toPosition': regex },
      { 'details.term': regex },
      { 'details.academicYear': regex },
      { 'details.effectivityDate': regex },
      { 'details.type': regex },
      { 'details.source': regex },
      { 'details.fields': regex },
    ];
    const textUserIds = await resolveUserIds(text);
    if (textUserIds.length) {
      textMatches.push({ userId: { $in: textUserIds } }, { actorId: { $in: textUserIds } });
    }
    and.push({ $or: textMatches });
  }
  if (and.length) filter.$and = and;
  return { filter };
}

function activityRow(event) {
  const actor = event.actorId && typeof event.actorId === 'object' ? event.actorId : null;
  const subject = event.userId && typeof event.userId === 'object' ? event.userId : null;
  return {
    time: event.occurredAt,
    actorName: actor ? actor.name : event.actorRole === 'SYSTEM' ? 'System' : 'Unknown',
    actorRole: event.actorRole || 'SYSTEM',
    subjectName: subject ? subject.name : 'Unknown',
    eventType: event.eventType,
    description: describeEvent(event),
  };
}

async function loadActivity(query, pagination) {
  const built = await activityFilter(query);
  if (built.error) return built;
  const total = await HistoryEvent.countDocuments(built.filter);
  let eventsQuery = HistoryEvent.find(built.filter)
    .sort({ occurredAt: -1, _id: -1 })
    .populate('actorId', 'name')
    .populate('userId', 'name');
  if (pagination) eventsQuery = eventsQuery.skip(pagination.skip).limit(pagination.limit);
  const events = await eventsQuery.lean();
  return { rows: events.map(activityRow), total };
}

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

router.get('/consultations/export.csv', requireAuth(ALL_ROLES), async (req, res) => {
  try {
    const result = await loadConsultations(req.user.userId, req.query);
    if (result.error) return res.status(400).json({ error: result.error });
    const rows = result.records.map((appointment) => [
      appointment.date, appointment.time,
      appointment.facultyId && appointment.facultyId.name || '',
      appointment.studentId && appointment.studentId.name || appointment.studentName,
      appointment.reason, appointment.status, appointment.academicYear, appointment.term, appointment.historyRole,
    ]);
    const csv = buildCsv([{
      title: 'Consultation history',
      header: ['Date', 'Time', 'Faculty', 'Student', 'Purpose', 'Status', 'Academic year', 'Term', 'History role'],
      rows,
    }]);
    res.setHeader('Content-Disposition', 'attachment; filename="consultation-history.csv"');
    res.type('text/csv; charset=utf-8').send(csv);
  } catch (error) {
    console.error('Consultation history export failed:', error.message);
    res.status(500).json({ error: 'Could not export your consultation history.' });
  }
});

router.get('/consultations', requireAuth(ALL_ROLES), async (req, res) => {
  try {
    const pagination = parsePagination(req.query, 20, 100);
    if (pagination.error) return res.status(400).json({ error: pagination.error });
    const result = await loadConsultations(req.user.userId, req.query);
    if (result.error) return res.status(400).json({ error: result.error });
    const start = pagination.skip;
    res.json({
      appointments: result.records.slice(start, start + pagination.limit),
      page: pagination.page,
      limit: pagination.limit,
      total: result.records.length,
      pages: Math.ceil(result.records.length / pagination.limit),
    });
  } catch (error) {
    console.error('Consultation history load failed:', error.message);
    res.status(500).json({ error: 'Could not load your consultation history.' });
  }
});

router.get('/activity/export.csv', requireAuth(['ADMIN']), async (req, res) => {
  try {
    const result = await loadActivity(req.query, null);
    if (result.error) return res.status(400).json({ error: result.error });
    const csv = buildCsv([{
      title: 'Activity history',
      header: ['Time', 'Actor', 'Actor role', 'Subject', 'Event type', 'Activity'],
      rows: result.rows.map((row) => [formatManilaDateTime(row.time), row.actorName, row.actorRole, row.subjectName, row.eventType, row.description]),
    }]);
    res.setHeader('Content-Disposition', 'attachment; filename="activity-history.csv"');
    res.type('text/csv; charset=utf-8').send(csv);
  } catch (error) {
    console.error('Activity history export failed:', error.message);
    res.status(500).json({ error: 'Could not export activity history.' });
  }
});

router.get('/activity', requireAuth(['ADMIN']), async (req, res) => {
  try {
    const pagination = parsePagination(req.query, 50, 200);
    if (pagination.error) return res.status(400).json({ error: pagination.error });
    const result = await loadActivity(req.query, pagination);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({
      rows: result.rows,
      page: pagination.page,
      limit: pagination.limit,
      total: result.total,
      pages: Math.ceil(result.total / pagination.limit),
    });
  } catch (error) {
    console.error('Activity history load failed:', error.message);
    res.status(500).json({ error: 'Could not load activity history.' });
  }
});

module.exports = router;
