// Faculty Schedule PDF Importer, phase 4: review and validate a schedule DRAFT. Nothing here writes to the database or
// changes any schedule: it only reads the faculty's appointments to check conflicts. Activation is a later phase.
//   POST /api/schedule-import/parse     body { draft }  -> editable rows (OCR draft JSON in, cleaned rows out)
//   POST /api/schedule-import/validate  body { facultyId, classes, consultationHours, metadata, workload, identityConfirmed } -> error / warning report
// Faculty may only use their own account; Admin may pick any FACULTY account; Dean and Student are refused (403).

const express = require('express');
const mongoose = require('mongoose');
const { requireAuth } = require('../middleware/auth');
const User = require('../models/User');
const Appointment = require('../models/Appointment');
const { manilaNow } = require('../utils/manilaTime');
const { fromOcrDraft, validateDraft, importAccess } = require('../utils/scheduleDraft');

const router = express.Router();
const ALLOWED = ['FACULTY', 'ADMIN'];

router.post('/parse', requireAuth(ALLOWED), (req, res) => {
  const rows = fromOcrDraft(req.body && req.body.draft);
  if (rows.error) return res.status(400).json({ error: rows.error });
  res.json(rows);
});

router.post('/validate', requireAuth(ALLOWED), async (req, res) => {
  try {
    const { facultyId, classes, consultationHours, metadata, workload, identityConfirmed } = req.body || {};
    if (!mongoose.isValidObjectId(facultyId)) return res.status(400).json({ error: 'Choose a faculty account.' });
    const access = importAccess(req.user, facultyId);
    if (!access) return res.status(403).json({ error: 'You can only import a schedule for your own account.' });
    // The target has to be a faculty account (a 404 for anything else, so an admin cannot probe other ids). Its name is what the printed one is compared with.
    const target = await User.findOne({ _id: facultyId, role: 'FACULTY' }).select('name').lean();
    if (!target) return res.status(404).json({ error: 'Faculty account not found.' });

    // Never trust the browser's rows: clean them again. Weekend consultations are kept here so they are reported as errors.
    const rows = fromOcrDraft({ classes, consultationHours, metadata, workload }, { keepWeekendConsultations: true });
    if (rows.error) return res.status(400).json({ error: rows.error });

    const today = manilaNow().dateStr;
    const mine = await Appointment.find({ facultyId, status: { $in: ['APPROVED', 'PENDING'] }, date: { $gte: today } }).select('date time duration status').lean();
    const report = validateDraft(rows, {
      identityConfirmed: identityConfirmed === true,
      targetName: target.name,
      approved: mine.filter(a => a.status === 'APPROVED'),
      pending: mine.filter(a => a.status === 'PENDING'),
    });
    res.json({ ...report, classes: rows.classes, consultationHours: rows.consultationHours, metadata: rows.metadata, workload: rows.workload });
  } catch (error) {
    res.status(500).json({ error: 'Server error while checking the schedule draft.' });
  }
});

module.exports = router;
