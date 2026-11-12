// Faculty Schedule PDF Importer. Phases 4-5 only read: /parse, /preview and /validate never change a schedule.
// Phase 6 (the only part that writes):
//   POST /confirm            re-validates, then applies now (effectivity date today or past) or stages it (future date)
//   GET  /history/:facultyId import history (newest first)
//   POST /:id/cancel         cancel a staged (SCHEDULED) import
//   POST /:id/rollback       put back the schedule this import replaced (latest ACTIVE import only, and only if nothing changed since)
//   POST /api/schedule-import/parse     body { draft }  -> editable rows (OCR draft JSON in, cleaned rows out)
//   POST /api/schedule-import/validate  body { facultyId, classes, consultationHours, metadata, workload, identityConfirmed } -> error / warning report
// Faculty may only use their own account; Admin may pick any FACULTY account; Dean and Student are refused (403).

const express = require('express');
const mongoose = require('mongoose');
const { requireAuth } = require('../middleware/auth');
const User = require('../models/User');
const Appointment = require('../models/Appointment');
const ScheduleImport = require('../models/ScheduleImport');
const { notify } = require('../utils/notify');
const { fingerprint, replaceSchedule } = require('../utils/scheduleSwap');
const { checkEffectivityDate, revalidate, applyImport, checkRestore } = require('../utils/scheduleImportService');
const { mongoStore } = require('../utils/scheduleStore');
const { manilaNow } = require('../utils/manilaTime');
const rateLimit = require('express-rate-limit');
const { fromOcrDraft, validateDraft, importAccess, toScheduleRecord } = require('../utils/scheduleDraft');
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
    const current = await mongoStore.load(facultyId);
    res.json({ ...report, classes: rows.classes, consultationHours: rows.consultationHours, metadata: rows.metadata, workload: rows.workload,
      scheduleFingerprint: fingerprint(current.classes, current.hours) }); // the confirm step sends this back to prove the schedule did not change meanwhile
  } catch (error) {
    res.status(500).json({ error: 'Server error while checking the schedule draft.' });
  }
});

// ---------- Phase 6: confirm / history / cancel / rollback ----------
const busy = new Set(); // one change per faculty at a time (a double click or two admins must not interleave two replacements)
const withLock = async (facultyId, res, fn) => {
  const key = String(facultyId);
  if (busy.has(key)) return res.status(409).json({ error: 'Another schedule change for this faculty is in progress. Try again in a moment.' });
  busy.add(key);
  try { return await fn(); } finally { busy.delete(key); }
};
const loadTarget = async (req, res, facultyId) => {
  if (!mongoose.isValidObjectId(facultyId)) { res.status(400).json({ error: 'Choose a faculty account.' }); return null; }
  if (!importAccess(req.user, facultyId)) { res.status(403).json({ error: 'You can only import a schedule for your own account.' }); return null; }
  const target = await User.findOne({ _id: facultyId, role: 'FACULTY' }).select('name').lean();
  if (!target) { res.status(404).json({ error: 'Faculty account not found.' }); return null; }
  return target;
};
const upcoming = async (facultyId) => {
  const mine = await Appointment.find({ facultyId, status: { $in: ['APPROVED', 'PENDING'] }, date: { $gte: manilaNow().dateStr } }).select('date time duration status').lean();
  return { approved: mine.filter(a => a.status === 'APPROVED'), pending: mine.filter(a => a.status === 'PENDING') };
};
const toRows = (list) => list.map(({ dayOfWeek, startTime, endTime, subject, room }) => ({ dayOfWeek, startTime, endTime, ...(subject !== undefined ? { subject, room } : {}) }));

router.post('/confirm', requireAuth(ALLOWED), async (req, res) => {
  try {
    const { facultyId, classes, consultationHours, metadata, workload, identityConfirmed, effectivityDate, scheduleFingerprint, fileHash } = req.body || {};
    const target = await loadTarget(req, res, facultyId);
    if (!target) return;
    const today = manilaNow().dateStr;
    const when = checkEffectivityDate(effectivityDate, today);
    if (!when.ok) return res.status(400).json({ error: when.error });

    return await withLock(facultyId, res, async () => {
      // Check everything again on the server, against the appointments as they are right now
      const { approved, pending } = await upcoming(facultyId);
      const check = revalidate({ classes, consultationHours, metadata, workload }, { identityConfirmed: identityConfirmed === true, targetName: target.name, approved, pending });
      if (!check.ok) return res.status(422).json({ error: 'The schedule still has problems, so it was not applied.', errors: check.errors, warnings: check.warnings });

      const rows = check.rows;
      const record = {
        facultyId, uploadedBy: req.user.userId, uploaderRole: req.user.role,
        fileHash: typeof fileHash === 'string' && /^[0-9a-f]{64}$/.test(fileHash) ? fileHash : '',
        parserVersion: String((rows.metadata && rows.metadata.parserVersion) || ''), term: String((rows.metadata && rows.metadata.term) || ''), academicYear: String((rows.metadata && rows.metadata.academicYear) || ''),
        effectivityDate, identityConfirmedByReviewer: identityConfirmed === true,
        classes: toRows(rows.classes.map(c => toScheduleRecord(c))),
        consultationHours: toRows(rows.consultationHours), warnings: check.warnings.map(w => ({ code: w.code, message: w.message })),
        baseFingerprint: typeof scheduleFingerprint === 'string' ? scheduleFingerprint : '',
      };

      if (!when.startsNow) { // future date: stage it; the daily job applies it on that date (and checks it again then)
        const staged = await ScheduleImport.create({ ...record, status: 'SCHEDULED' });
        await notify([facultyId], { type: 'SCHEDULE_IMPORT', title: 'Schedule scheduled', message: `A new class schedule will take effect on ${effectivityDate}.`, page: 'schedule' });
        return res.json({ status: 'SCHEDULED', importId: staged._id, effectivityDate, warnings: check.warnings });
      }

      const applied = await applyImport({ facultyId, classes: rows.classes, consultationHours: rows.consultationHours, baseFingerprint: record.baseFingerprint }, { store: mongoStore, enforceBase: true });
      if (!applied.ok) {
        await ScheduleImport.create({ ...record, status: 'FAILED', failureReason: applied.message });
        return res.status(applied.code === 'STALE' ? 409 : 500).json({ error: applied.message, code: applied.code });
      }
      await ScheduleImport.updateMany({ facultyId, status: 'ACTIVE' }, { $set: { status: 'SUPERSEDED' } });
      const done = await ScheduleImport.create({ ...record, status: 'ACTIVE', previousSnapshot: { classes: toRows(applied.snapshot.classes), hours: toRows(applied.snapshot.hours) }, activatedAt: new Date() });
      if (String(req.user.userId) !== String(facultyId)) await notify([facultyId], { type: 'SCHEDULE_IMPORT', title: 'Class schedule updated', message: 'Your class schedule and official consultation hours were replaced from your Faculty Individual Load.', page: 'schedule' });
      return res.json({ status: 'ACTIVE', importId: done._id, effectivityDate, counts: applied.counts, warnings: check.warnings });
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error while applying the schedule. The previous schedule was not changed unless this page says otherwise.' });
  }
});

router.get('/history/:facultyId', requireAuth(ALLOWED), async (req, res) => {
  try {
    if (!(await loadTarget(req, res, req.params.facultyId))) return;
    const list = await ScheduleImport.find({ facultyId: req.params.facultyId }).sort({ createdAt: -1 }).limit(50)
      .select('status effectivityDate term academicYear uploaderRole confirmedAt activatedAt failureReason fileHash classes consultationHours').lean();
    res.json(list.map(i => ({ id: i._id, status: i.status, effectivityDate: i.effectivityDate, term: i.term, academicYear: i.academicYear, uploaderRole: i.uploaderRole,
      confirmedAt: i.confirmedAt, activatedAt: i.activatedAt, failureReason: i.failureReason, fileHash: i.fileHash, classBlocks: i.classes.length, consultationBlocks: i.consultationHours.length })));
  } catch (error) { res.status(500).json({ error: 'Server error loading the import history.' }); }
});

const loadImport = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) { res.status(400).json({ error: 'Invalid import.' }); return null; }
  const imp = await ScheduleImport.findById(req.params.id);
  if (!imp) { res.status(404).json({ error: 'Import not found.' }); return null; }
  if (!importAccess(req.user, imp.facultyId)) { res.status(403).json({ error: 'You can only manage imports for your own account.' }); return null; }
  return imp;
};

router.post('/:id/cancel', requireAuth(ALLOWED), async (req, res) => {
  try {
    const imp = await loadImport(req, res); if (!imp) return;
    if (imp.status !== 'SCHEDULED') return res.status(409).json({ error: 'Only a scheduled import that has not started yet can be cancelled.' });
    const r = await ScheduleImport.updateOne({ _id: imp._id, status: 'SCHEDULED' }, { $set: { status: 'CANCELLED' } });
    if (!r.modifiedCount) return res.status(409).json({ error: 'That import already started.' });
    res.json({ status: 'CANCELLED' });
  } catch (error) { res.status(500).json({ error: 'Server error cancelling the import.' }); }
});

router.post('/:id/rollback', requireAuth(ALLOWED), async (req, res) => {
  try {
    const imp = await loadImport(req, res); if (!imp) return;
    const facultyId = imp.facultyId;
    return await withLock(facultyId, res, async () => {
      if (imp.status !== 'ACTIVE') return res.status(409).json({ error: 'Only the schedule that is currently applied from an import can be undone.' });
      const cur = await mongoStore.load(facultyId);
      if (fingerprint(cur.classes, cur.hours) !== fingerprint(imp.classes, imp.consultationHours)) {
        return res.status(409).json({ error: 'The schedule was changed after this import, so it cannot be undone automatically (that would erase the newer changes).' });
      }
      const { approved } = await upcoming(facultyId);
      const ok = checkRestore(imp.previousSnapshot, approved);
      if (!ok.ok) return res.status(409).json({ error: ok.message });
      try { await replaceSchedule(mongoStore, facultyId, imp.previousSnapshot.classes, imp.previousSnapshot.hours); }
      catch (e) { return res.status(500).json({ error: e.message }); }
      await ScheduleImport.updateOne({ _id: imp._id }, { $set: { status: 'ROLLED_BACK' } });
      res.json({ status: 'ROLLED_BACK' });
    });
  } catch (error) { res.status(500).json({ error: 'Server error undoing the import.' }); }
});

module.exports = router;
