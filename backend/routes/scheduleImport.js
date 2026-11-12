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
const rateLimit = require('express-rate-limit');
const { fromOcrDraft, validateDraft, importAccess } = require('../utils/scheduleDraft');
const { checkPdf, MAX_PDF_BYTES } = require('../utils/pdfUpload');
const { runOcr, OcrError } = require('../utils/ocrRunner');

const router = express.Router();
const ALLOWED = ['FACULTY', 'ADMIN'];

// Phase 5: upload the scanned PDF itself. The body is the raw PDF (no multipart, so no extra dependency).
//   POST /api/schedule-import/preview?facultyId=<id>   Content-Type: application/pdf  -> same rows as /parse, plus fileHash
const previewLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many uploads. Try again in a few minutes.' } });
const OCR_STATUS = { OCR_BUSY: 429, OCR_TIMEOUT: 504, OCR_UNAVAILABLE: 503, OCR_FAILED: 502, OCR_BAD_OUTPUT: 502 };

router.post('/preview', requireAuth(ALLOWED), previewLimiter, express.raw({ type: 'application/pdf', limit: MAX_PDF_BYTES }), async (req, res) => {
  try {
    const { facultyId } = req.query;
    if (!mongoose.isValidObjectId(facultyId)) return res.status(400).json({ error: 'Choose a faculty account.' });
    if (!importAccess(req.user, facultyId)) return res.status(403).json({ error: 'You can only import a schedule for your own account.' });
    const target = await User.findOne({ _id: facultyId, role: 'FACULTY' }).select('_id').lean();
    if (!target) return res.status(404).json({ error: 'Faculty account not found.' });

    const check = checkPdf(req.body);
    if (!check.ok) return res.status(400).json({ error: check.error });

    const draft = await runOcr(req.body);
    const rows = fromOcrDraft(draft);
    if (rows.error) return res.status(422).json({ error: rows.error });
    res.json({ ...rows, fileHash: check.hash });
  } catch (error) {
    if (error instanceof OcrError) return res.status(OCR_STATUS[error.code] || 502).json({ error: error.message, code: error.code });
    if (error && error.type === 'entity.too.large') return res.status(413).json({ error: 'That PDF is larger than 10 MB.' });
    res.status(500).json({ error: 'Server error while reading the PDF.' });
  }
});

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
