const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Appointment = require('../models/Appointment');
const ConsultationHours = require('../models/ConsultationHours');
const AddedConsultationHours = require('../models/AddedConsultationHours');
const { buildFacultyAnalytics } = require('../utils/facultyAnalytics');
const { buildSharedReport } = require('../utils/reportMetrics');
const { sharedReportCsv, facultyReportCsv } = require('../utils/csvExport');
const { requireAuth } = require('../middleware/auth');
const { manilaNow } = require('../utils/manilaTime');

const STAFF = ['ADMIN', 'DEAN'];
const APPOINTMENT_FIELDS = 'status date time studentId studentName studentSection facultyId reason appeal autoRejected';

// GET /api/analytics/report — the shared Admin/Dean report, in one request.
// All numbers come from pure functions in utils/reportMetrics.js. Account health is Admin-only.
async function loadSharedReport(role) {
  const [appointments, users, official, added] = await Promise.all([
    Appointment.find({}).select(APPOINTMENT_FIELDS).lean(),
    User.find({}).select('name email role accountStatus programPosition gender schoolId onboardingComplete').lean(),
    ConsultationHours.find({}).select('startTime endTime').lean(),
    AddedConsultationHours.find({ dayOfWeek: { $gte: 1 } }).select('startTime endTime').lean(),
  ]);
  return buildSharedReport({
    appointments, users,
    hoursRows: [...official, ...added],
    todayIso: manilaNow().dateStr,
    includeAccountHealth: role === 'ADMIN',
  });
}

router.get('/report', requireAuth(STAFF), async (req, res) => {
  try {
    res.json({ generatedAt: new Date().toISOString(), ...(await loadSharedReport(req.user.role)) });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: 'Could not compute analytics.' });
  }
});

// The same report as a CSV file (opens in Excel / Sheets). Built here on the server so the formula-injection
// guard in utils/csvExport.js cannot be skipped. Dean and Admin only, same as the report; the Dean's file
// leaves out the Admin-only account-health section because it comes from the same loader.
router.get('/report.csv', requireAuth(STAFF), async (req, res) => {
  try {
    const report = await loadSharedReport(req.user.role);
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="ccis-sync-report-${manilaNow().dateStr}.csv"` });
    res.send(sharedReportCsv(report, { generatedAt: new Date().toISOString(), role: req.user.role }));
  } catch (error) {
    console.error('Analytics export error:', error.message);
    res.status(500).json({ error: 'Could not export the report.' });
  }
});

// ── A faculty member's OWN analytics: only their appointments and hours, never anyone else's ──
async function loadFacultyAnalytics(facultyId) {
  const [appointments, official, added] = await Promise.all([
    Appointment.find({ facultyId }).select(APPOINTMENT_FIELDS).lean(),
    ConsultationHours.find({ facultyId }).lean(),
    AddedConsultationHours.find({ facultyId, dayOfWeek: { $gte: 1 } }).lean(),
  ]);
  return buildFacultyAnalytics({ appointments, official, added, todayIso: manilaNow().dateStr });
}

router.get('/me', requireAuth(['FACULTY']), async (req, res) => {
  try {
    res.json({ generatedAt: new Date().toISOString(), ...(await loadFacultyAnalytics(req.user.userId)) });
  } catch (error) {
    console.error('Faculty analytics error:', error.message);
    res.status(500).json({ error: 'Could not compute your analytics.' });
  }
});

// CSV of the logged-in faculty member's own analytics (never anyone else's: the id comes from the token).
router.get('/me.csv', requireAuth(['FACULTY']), async (req, res) => {
  try {
    const [report, me] = await Promise.all([loadFacultyAnalytics(req.user.userId), User.findById(req.user.userId).select('name').lean()]);
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="my-analytics-${manilaNow().dateStr}.csv"` });
    res.send(facultyReportCsv(report, { generatedAt: new Date().toISOString(), name: me?.name || '' }));
  } catch (error) {
    console.error('Faculty export error:', error.message);
    res.status(500).json({ error: 'Could not export your analytics.' });
  }
});

module.exports = router;
