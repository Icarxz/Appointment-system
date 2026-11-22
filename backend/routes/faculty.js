const bcrypt = require('bcryptjs');
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const router = express.Router();

// Blocks repeated password-guessing: after 10 failed/attempted logins from the
// same IP within 15 minutes, further attempts are rejected until the window resets.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Same protection for the forgot-password request itself, so it can't be used
// to spam a mailbox with reset links or to probe which emails are registered.
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many password reset requests. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

const { sendVerificationEmail, sendApprovedEmail, sendResetEmail } = require('../utils/mailer');
const User = require('../models/User'); 
const Schedule = require('../models/Schedule');
const Appointment = require('../models/Appointment');
const Announcement = require('../models/Announcement');
const CalendarNote = require('../models/CalendarNote');
const Notification = require('../models/Notification');
const { notify, notifyRole, resolveStudentId, fmtDate, fmtTime } = require('../utils/notify');
const StatusHistory = require('../models/StatusHistory');
const crypto = require('crypto'); // Built-in Node.js module for secure hashes
const ConsultationHours = require('../models/ConsultationHours');
const AddedConsultationHours = require('../models/AddedConsultationHours');
const { buildSlots, buildBusy, openWindow, addDays, dayOfWeekOf, overlaps, OPERATING_START, OPERATING_LAST_START, OPERATING_LAST_END } = require('../utils/slots');
const { parseRange, toBookingBlocks, SHOWN } = require('../utils/scheduleBookings');
const { isOverlapping } = require('../utils/timeMath');
const { planApproval } = require('../utils/approvalTime');
const { validateClassBlock } = require('../utils/classBlock');
const { CONSULTATION_DAYS, isConsultationDay, parseDay } = require('../utils/daySettings');
const { requireAuth } = require('../middleware/auth');

// Generic shape check for admin-provisioned accounts (any domain, but still a single "@").
const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// Official ID formats (same rules as the User model).
const { STUDENT_ID_REGEX: SCHOOL_ID_REGEX, EMPLOYEE_ID_REGEX: FACULTY_ID_REGEX } = require('../utils/idValidator');
const Broadcast = require('../models/Broadcast');
const { isProfileComplete, parseList, audienceMismatch } = require('../utils/signInPolicy');
const { isApprovedFacultyPosition } = require('../utils/facultyPositions');
const { isValidCohort, cohortLabel } = require('../utils/studentCohort');
const { isProgram, programOfPosition, effectiveProgram } = require('../utils/programs');
const { isEmploymentType } = require('../utils/employment');
const { bulkCancelDecision, MAX_BULK } = require('../utils/bulkCancel');
const { transition, CHANGED_MESSAGE } = require('../utils/statusTransition');
const { canMarkMissed, missOpensAt, canCorrectMiss, hasStarted, CORRECTION_HOURS, MISS_GRACE_MINUTES } = require('../utils/appointmentTime');
const { validateId } = require('../utils/idValidator');
const { cleanReason } = require('../utils/missReason');
const { reportDecision } = require('../utils/reportFacultyMissed');
const { canViewAppointment } = require('../utils/appointmentAccess');
const { isObjectIdHex } = require('../utils/notifyLink');
const { manilaNow, manilaDate } = require('../utils/manilaTime');
const { canDisableRole, canEnableAccountStatus } = require('../utils/accountStatus');
const FacultyStatusEntry = require('../models/FacultyStatusEntry');
const { resolveFacultyStatus, validateEntry, dropBlockedSlots, BOOKING_BLOCKING } = require('../utils/facultyStatus');
const { windowFromNotice } = require('../utils/noticeWindow');
const ExcelJS = require('exceljs');
const multer = require('multer');
const { Readable } = require('node:stream');
const { MAX_ROWS, text, importFieldForHeader, validateImportRows } = require('../utils/bulkProvision');
const { groupStatusInputs, toLegacyStatus, publicNotices } = require('../utils/facultyStatusInputs');
const { endFromChoice } = require('../utils/statusDuration');

// Booking / cancellation time limits (appointment date + time are Manila time)
const { findConflict, conflictMessage } = require('../utils/duplicateRequest');
const { consultableFilter } = require('../utils/consultable');
const { hoursTotalError } = require('../utils/consultationHoursRule');
const { checkWeeklyLimit, limitMessage, weekBounds, COUNTED_STATUSES } = require('../utils/weeklyLimit');
const { BOOKING_LEAD_HOURS, CANCEL_CUTOFF_HOURS } = require('../utils/appointmentTime'); // 1 hour to book, 1 hour to cancel
const hoursUntil = (date, time) => (manilaDate(date, time).getTime() - Date.now()) / 36e5;

// ---- Access control helpers ------------------------------------------------
const ALL_ROLES = ['STUDENT', 'FACULTY', 'DEAN', 'ADMIN'];
const STAFF = ['ADMIN', 'DEAN'];
const isStaff = (req) => STAFF.includes(req.user.role);
// The logged-in user must BE the faculty/user named by the URL param (staff bypass optional)
const ownerOnly = (getId) => (req, res, next) =>
  String(getId(req)) === String(req.user.userId) ? next() : res.status(403).json({ error: 'Forbidden' });
const ownerOrStaff = (getId) => (req, res, next) =>
  isStaff(req) || String(getId(req)) === String(req.user.userId) ? next() : res.status(403).json({ error: 'Forbidden' });
const timeToMinutes = (time) => {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
};

// =========================================================================
// === ROUTES ===
// =========================================================================

// === 1. SECURE REGISTRATION ROUTE (With Bcrypt) ===
// Gives the user a fresh one-time email-verification token (only its hash is stored, valid 24h)
// and returns the link to put in the email. Any earlier link stops working.
async function issueVerificationLink(user) {
  const raw = crypto.randomBytes(32).toString('hex');
  user.verificationToken = crypto.createHash('sha256').update(raw).digest('hex');
  user.verificationTokenExpires = Date.now() + 24 * 60 * 60 * 1000;
  await user.save();
  const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').split(',')[0].trim();
  return `${frontendUrl}/verify-email/${raw}`;
}

// (Self-registration was removed: accounts are created by Google sign-in in routes/auth.js.)

// === 2. SECURE LOGIN ROUTE ===
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password, audience } = req.body;

    // 1. Find the user
    const user = await User.findOne({ email: email.toLowerCase() });

    // console.log("DIAGNOSTIC - User found:", user ? "YES" : "NO", "| Email searched:", email.toLowerCase());
    
    if (!user) {
      return res.status(400).json({ error: 'Invalid email or password.' });
    }

    // 2. Check the Status State Machine BEFORE checking the password
    if (user.accountStatus === 'PENDING_APPROVAL') {
      return res.status(403).json({ error: 'Access Denied: Your account is still awaiting Admin approval. You will receive an email once it is approved.' });
    }
    if (user.accountStatus === 'ARCHIVED' || user.accountStatus === 'RESTRICTED') {
      return res.status(403).json({ error: 'Access Denied: Your account has been restricted or archived.' });
    }
    if (!user.isVerified) {
      return res.status(403).json({ error: 'Please verify your email address before logging in. Check your inbox for the verification link.' });
    }

    // 3. Cryptographically verify the password (Declared only ONCE)
    const isMatch = await bcrypt.compare(password, user.password);
    // console.log("DIAGNOSTIC - Password Match:", isMatch);
    
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid email or password.' });
    }

    // Signed in on the wrong tab (Student vs Faculty & Staff)? Tell them, and issue no token.
    const wrongTab = audienceMismatch(audience, user.role);
    if (wrongTab) return res.status(403).json({ error: wrongTab });

    // 4. Send back the user data (Do NOT send the hashed password back to the frontend)
    const token = jwt.sign(
     { userId: user._id, role: user.role }, 
     process.env.JWT_SECRET, 
     { expiresIn: '8h' }
   );
   res.json({
    token,
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    programPosition: user.programPosition
});

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error during login.' });
  }
});

// 1. GET ROUTE: Fetch all faculty members for the dashboard
router.get('/status', requireAuth(ALL_ROLES), async (req, res) => {
  try {
    // Disabled (RESTRICTED) / archived faculty are hidden from booking lists. Only the Admin still sees them (to re-enable).
    const facultyFilter = consultableFilter(); // every faculty member, plus a Dean who has switched consultations on
    if (req.user.role !== 'ADMIN') facultyFilter.accountStatus = { $nin: ['RESTRICTED', 'ARCHIVED'] };
    const facultyList = await User.find(facultyFilter)
      .select('name role gender programPosition program currentStatus currentLocation room statusNote flaggedDate flaggedReason weeklyRequestLimit')
      .sort({ name: 1 });

    // Status is worked out here on every request from the schedule, running consultations and
    // any manual status that has not expired. Nothing depends on the cron job or on the server being awake.
    const now = new Date();
    const clock = manilaNow(now);
    const nowMin = Number(clock.hhmm.slice(0, 2)) * 60 + Number(clock.hhmm.slice(3));
    const ids = facultyList.map(f => f._id);
    const [classes, official, added, entries, bookings] = await Promise.all([
      Schedule.find({ facultyId: { $in: ids }, dayOfWeek: clock.dayOfWeek }).lean(),
      ConsultationHours.find({ facultyId: { $in: ids }, dayOfWeek: clock.dayOfWeek }).lean(),
      AddedConsultationHours.find({ facultyId: { $in: ids }, dayOfWeek: clock.dayOfWeek }).lean(),
      FacultyStatusEntry.find({ facultyId: { $in: ids }, endAt: { $gt: now } }).lean(),
      Appointment.find({ facultyId: { $in: ids }, date: clock.dateStr, status: 'APPROVED' }).select('facultyId time duration').lean(),
    ]);
    const inputs = groupStatusInputs(ids, { classes, official, added, entries, bookings }, nowMin);

    const enriched = facultyList.map(f => {
      const obj = f.toObject();
      const r = resolveFacultyStatus(inputs.get(String(f._id)), now);
      obj.status = r.status;                 // new: IN_CLASS, IN_CONSULTATION, CONSULTATION_HOURS, VACANT, IN_MEETING, ON_BREAK, OUT_OF_OFFICE, ON_LEAVE
      obj.statusLabel = r.label;
      obj.statusSource = r.source;           // 'scheduled' or 'manual'
      obj.statusUntil = r.until;
      obj.statusReason = r.reason || '';
      obj.statusEntryId = r.entryId || null;
      obj.notices = publicNotices(inputs.get(String(f._id)).entries, now); // upcoming meetings / leave, for students and staff
      obj.currentStatus = toLegacyStatus(r.status); // old screens keep working until they use the fields above
      obj.currentLocation = r.location || obj.room || '';
      // Students never receive classroom locations (also stripped from the schedule endpoint)
      if (req.user.role === 'STUDENT') { delete obj.room; delete obj.currentLocation; }
      return obj;
    });

    res.json(enriched);
  } catch (error) {
    res.status(500).json({ error: 'Server error fetching faculty status' });
  }
});

// PUT ROUTE: Approve or Reject an Appointment
router.put('/appointment/:id', requireAuth(ALL_ROLES), async (req, res) => {
  try {
    const { status } = req.body;
    // Reason given when a request is cancelled by the student or declined (rejected)
    const reason = String(req.body.reason || '').trim().slice(0, 300);
    
    // Replace with your actual Appointment model reference if imported differently
    let targetApt = await Appointment.findById(req.params.id);

    if (!targetApt) {
      return res.status(404).json({ error: 'Appointment not found.' });
    }

    // Who may change this appointment, and to what
    if ((req.user.role === 'FACULTY' || req.user.role === 'DEAN') && String(targetApt.facultyId) !== String(req.user.userId)) {
      return res.status(403).json({ error: 'Forbidden' }); // a Dean answers only requests made to him
    }
    if (req.user.role === 'STUDENT') {
      const me = await User.findById(req.user.userId).select('name');
      if (!me || me.name !== targetApt.studentName || status !== 'CANCELLED BY STUDENT') {
        return res.status(403).json({ error: 'Forbidden' });
      }
      // Students can only cancel a request that is still open (pending or approved)
      if (!['PENDING', 'APPROVED'].includes(targetApt.status)) {
        return res.status(400).json({ error: 'This consultation can no longer be cancelled.' });
      }
      // Pending or approved: cancelling needs 8+ hours before the appointment
      if (hoursUntil(targetApt.date, targetApt.time) < CANCEL_CUTOFF_HOURS) {
        return res.status(400).json({ error: 'Requests and appointments can only be cancelled up to 1 hour before the scheduled time.' });
      }
    }
    // A request can be answered until its start time; after that the system rejects it automatically.
    if ((status === 'APPROVED' || status === 'REJECTED') && hoursUntil(targetApt.date, targetApt.time) <= 0) {
      return res.status(400).json({ error: 'The requested time has already started, so this request can no longer be answered.' });
    }
    if ((status === 'CANCELLED BY STUDENT' || status === 'REJECTED') && !reason) {
      return res.status(400).json({ error: 'Please select or enter a reason.' });
    }

    // THE INTERCEPTOR: Only run overlap logic if they are trying to APPROVE
    // Several students may ask for the same hour. The faculty member gives each one a start time and a length inside the
    // free time that is left (consultation hours + vacant hours, up to the next class or approved appointment): the first
    // approval may take 8:00-8:30, the next can then be given 8:30 onward. Nothing is declined automatically.
    let movedFrom = null; // the start the student asked for, when the approval gave a different one
    const changes = {};   // time fields an approval may change; written together with the status below
    if (status === 'APPROVED') {
      const facultyId = targetApt.facultyId;
      const dayOfWeek = dayOfWeekOf(targetApt.date); // from the date text itself, not the server's timezone

      const [official, added, dayClasses, approvedAppointments] = await Promise.all([
        ConsultationHours.find({ facultyId }).lean(),
        AddedConsultationHours.find({ facultyId, dayOfWeek: { $in: CONSULTATION_DAYS } }).lean(),
        Schedule.find({ facultyId, dayOfWeek }),
        Appointment.find({ facultyId, date: targetApt.date, status: 'APPROVED', _id: { $ne: targetApt._id } }),
      ]);

      const window = openWindow({ date: targetApt.date, time: targetApt.time, official, added, classes: dayClasses, appointments: approvedAppointments, excludeId: targetApt._id });
      const plan = planApproval({ window, apt: { time: targetApt.time, duration: targetApt.duration }, body: req.body });
      if (!plan.ok) return res.status(plan.status).json({ error: plan.error });

      // Safety net: the plan already keeps clear of classes and approved appointments; check again before writing.
      if (isOverlapping(plan.time, [...dayClasses, ...approvedAppointments], plan.duration)) {
        return res.status(409).json({ error: 'Double-Booking Prevented: This time block conflicts with an existing class or approved appointment.' });
      }
      if (plan.moved) { movedFrom = targetApt.time; changes.requestedTime = targetApt.time; changes.time = plan.time; }
      changes.duration = plan.duration;
    }

    // If math clears (or if they are just rejecting/canceling), write it in ONE step that only succeeds while the
    // appointment still has the status we read above (so a student cancelling and the faculty approving at the same
    // moment cannot both win).
    const previousStatus = targetApt.status;
    const set = { ...changes, status };
    if (status === 'CANCELLED BY STUDENT' || status === 'REJECTED') set.cancelReason = reason;
    const saved = await transition(Appointment, targetApt._id, previousStatus, set);
    if (!saved) return res.status(409).json({ error: CHANGED_MESSAGE });
    targetApt = saved; // from here on, the saved version (new status, time and duration) is used

    if (status !== previousStatus) {
      const when = `${fmtDate(targetApt.date)} at ${fmtTime(targetApt.time)}`;
      if (req.user.role === 'STUDENT') {
        await notify(targetApt.facultyId, {
          type: 'APPOINTMENT_UPDATE',
          title: 'Consultation cancelled by student',
          message: `${targetApt.studentName} cancelled the consultation on ${when}. Reason: ${reason}`,
          appointmentId: targetApt._id,
        });
      } else {
        const faculty = await User.findById(targetApt.facultyId).select('name');
        const verb = status === 'APPROVED' ? 'approved' : status === 'REJECTED' ? 'declined' : `updated to ${status}`;
        await notify(await resolveStudentId(targetApt), {
          type: 'APPOINTMENT_UPDATE',
          title: movedFrom ? 'Consultation approved at a different time' : `Consultation ${verb}`,
          message: movedFrom
            ? `Your request with ${faculty ? faculty.name : 'your instructor'} for ${fmtDate(targetApt.date)} at ${fmtTime(movedFrom)} was approved at a different time: ${fmtTime(targetApt.time)} (${targetApt.duration} minutes). If that time does not work for you, you can cancel up to ${CANCEL_CUTOFF_HOURS} hour before.`
            : `Your request with ${faculty ? faculty.name : 'your instructor'} on ${when} was ${verb}.${status === 'REJECTED' && reason ? ` Reason: ${reason}` : ''}`,
          appointmentId: targetApt._id,
        });
      }
    }

    res.json(targetApt);

  } catch (error) {
    console.error('Appointment Collision Check Error:', error);
    res.status(500).json({ error: 'Server error processing appointment interval math.' });
  }
});

// 3. GET ROUTE: Fetch schedule for a specific faculty member
router.get('/my-schedule/:facultyId', requireAuth(ALL_ROLES), async (req, res) => {
  try {
    // Students never receive classroom locations
    const schedules = await Schedule.find({ facultyId: req.params.facultyId })
      .select(req.user.role === 'STUDENT' ? '-room' : '')
      .sort({ dayOfWeek: 1, startTime: 1 });
    res.json(schedules);
  } catch (error) {
    res.status(500).json({ error: 'Server error fetching schedule.' });
  }
});

// Accepted and completed consultations of one faculty member between ?from= and ?to= (YYYY-MM-DD, inclusive), for the
// schedule calendar. Pending requests are not included, and no student names are sent (see utils/scheduleBookings.js).
router.get('/schedule-bookings/:facultyId', requireAuth(ALL_ROLES), async (req, res) => {
  try {
    const range = parseRange(req.query.from, req.query.to);
    if (range.error) return res.status(400).json({ error: range.error });
    if (!mongoose.isValidObjectId(req.params.facultyId)) return res.status(400).json({ error: 'Invalid faculty id.' });
    const rows = await Appointment.find({
      facultyId: req.params.facultyId, status: { $in: SHOWN }, date: { $gte: range.from, $lte: range.to },
    }).select('date time duration status').lean();
    res.json(toBookingBlocks(rows));
  } catch (error) {
    res.status(500).json({ error: 'Server error fetching bookings.' });
  }
});

// 4. Class blocks (Admin / Dean): add, move or delete a class on the 30-minute class grid.
// Every write is checked by utils/classBlock.js (30-minute times, no overlap with another class, no clash with an
// approved consultation). The faculty member gets one mailbox notice per change, but not while the account has
// never been signed in to (a new account is still being set up).
async function classBlockCheck(facultyId, raw, excludeId) {
  const [siblings, approved] = await Promise.all([
    Schedule.find({ facultyId, ...(excludeId ? { _id: { $ne: excludeId } } : {}) }).lean(),
    Appointment.find({ facultyId, status: 'APPROVED', date: { $gte: manilaNow().dateStr } }).select('date time duration').lean(),
  ]);
  return validateClassBlock(raw, siblings, approved);
}
const hasSignedIn = (u) => Boolean(u && (u.googleSub || u.privacyAcceptedAt));
const classLine = (b) => `${b.subject} in ${b.room}, ${DAY_LABELS[b.dayOfWeek]} ${fmtTime(b.startTime)} - ${fmtTime(b.endTime)}`;
const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Class schedule edits: Admin and Dean may edit anyone's; a Faculty member may edit only their own.
const SCHEDULE_EDITORS = [...STAFF, 'FACULTY'];
const ownScheduleOnly = (req, facultyId) => req.user.role !== 'FACULTY' || String(facultyId) === String(req.user.userId);
const actorIsOwner = (req, facultyId) => req.user.role === 'FACULTY' && String(facultyId) === String(req.user.userId);

router.post('/schedule/add', requireAuth(SCHEDULE_EDITORS), async (req, res) => {
  try {
    const facultyId = req.user.role === 'FACULTY' ? req.user.userId : req.body.facultyId;
    if (!mongoose.isValidObjectId(facultyId)) return res.status(400).json({ error: 'Choose an instructor.' });
    const faculty = await User.findOne({ _id: facultyId, role: 'FACULTY' }).select('googleSub privacyAcceptedAt');
    if (!faculty) return res.status(404).json({ error: 'Faculty member not found.' });

    const check = await classBlockCheck(faculty._id, req.body, null);
    if (!check.ok) return res.status(400).json({ error: check.error });

    const created = await Schedule.create({ facultyId: faculty._id, ...check.value });
    if (hasSignedIn(faculty) && !actorIsOwner(req, faculty._id)) {
      await notify(faculty._id, { type: 'SCHEDULE_ASSIGNED', title: 'New class added to your schedule', message: `${classLine(check.value)}.`, page: 'schedule' });
    }
    res.json({ message: 'Schedule assigned successfully!', schedule: created });
  } catch (error) {
    res.status(500).json({ error: 'Server error assigning schedule.' });
  }
});

router.put('/schedule/:id', requireAuth(SCHEDULE_EDITORS), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Class not found.' });
    const block = await Schedule.findById(req.params.id);
    if (!block) return res.status(404).json({ error: 'Class not found.' });
    if (!ownScheduleOnly(req, block.facultyId)) return res.status(403).json({ error: 'You can only change your own class schedule.' });

    const check = await classBlockCheck(block.facultyId, req.body, block._id);
    if (!check.ok) return res.status(400).json({ error: check.error });

    const before = classLine(block);
    Object.assign(block, check.value); // the instructor never changes here
    await block.save();
    const faculty = await User.findById(block.facultyId).select('googleSub privacyAcceptedAt');
    if (hasSignedIn(faculty) && !actorIsOwner(req, block.facultyId)) {
      await notify(block.facultyId, { type: 'SCHEDULE_CHANGED', title: 'A class in your schedule was changed', message: `${before} is now ${classLine(check.value)}.`, page: 'schedule' });
    }
    res.json({ message: 'Class updated.', schedule: block });
  } catch (error) {
    res.status(500).json({ error: 'Server error updating the class.' });
  }
});

router.delete('/schedule/:id', requireAuth(SCHEDULE_EDITORS), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Class not found.' });
    const existing = await Schedule.findById(req.params.id).select('facultyId');
    if (!existing) return res.status(404).json({ error: 'Class not found.' });
    if (!ownScheduleOnly(req, existing.facultyId)) return res.status(403).json({ error: 'You can only change your own class schedule.' });
    const block = await Schedule.findByIdAndDelete(req.params.id);
    if (!block) return res.status(404).json({ error: 'Class not found.' });
    const faculty = await User.findById(block.facultyId).select('googleSub privacyAcceptedAt');
    if (hasSignedIn(faculty) && !actorIsOwner(req, block.facultyId)) {
      await notify(block.facultyId, { type: 'SCHEDULE_CHANGED', title: 'A class was removed from your schedule', message: `${classLine(block)} was removed.`, page: 'schedule' });
    }
    res.json({ message: 'Class removed.' });
  } catch (error) {
    res.status(500).json({ error: 'Server error removing the class.' });
  }
});

// 5. POST ROUTE: Admin adds a new faculty member (QR Generation)
router.post('/add', requireAuth(['ADMIN']), async (req, res) => {
  try {
    const { name, email: rawEmail, role: rawRole, gender, program, year, section, schoolId, facultyId, programPosition, employmentType } = req.body || {};
    const cleanName = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : '';
    const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
    const role = typeof rawRole === 'string' ? rawRole.trim().toUpperCase() : '';

    if (cleanName.length < 2 || cleanName.length > 100) return res.status(400).json({ error: 'Full name must be 2 to 100 characters.' });
    if (!EMAIL_REGEX.test(email)) return res.status(400).json({ error: 'Please enter a valid school email address.' });
    const allowedDomains = parseList(process.env.ALLOWED_EMAIL_DOMAIN);
    const domain = email.split('@')[1];
    if (!allowedDomains.length || !allowedDomains.includes(domain)) return res.status(400).json({ error: 'Please use a valid school email address.' });
    if (!['STUDENT', 'FACULTY', 'DEAN'].includes(role)) return res.status(400).json({ error: 'Choose Student, Faculty or Dean.' });
    if (!['Male', 'Female'].includes(gender)) return res.status(400).json({ error: 'Choose Male or Female.' });
    if (await User.findOne({ email }).select('_id')) return res.status(409).json({ error: 'An account already uses this email.' });

    const account = {
      name: cleanName,
      email,
      role,
      accountStatus: 'ACTIVE',
      isVerified: false,
      onboardingComplete: false,
      currentStatus: 'OUT_OF_OFFICE',
    };
    if (gender) account.gender = gender;

    if (role === 'STUDENT') {
      if (!isValidCohort(program, year, section)) return res.status(400).json({ error: 'Choose a valid program, year and section.' });
      const idCheck = validateId(schoolId, 'STUDENT');
      if (!idCheck.ok) return res.status(400).json({ error: idCheck.error });
      if (await User.findOne({ schoolId: idCheck.id }).select('_id')) return res.status(409).json({ error: 'That School ID is already registered to another account.' });
      account.schoolId = idCheck.id;
      account.noIdYet = false;
      account.programPosition = cohortLabel(program, year, section);
    } else {
      if (!isApprovedFacultyPosition(programPosition)) return res.status(400).json({ error: 'Please select an approved faculty or Dean position.' });
      const idCheck = validateId(facultyId, 'EMPLOYEE');
      if (!idCheck.ok) return res.status(400).json({ error: idCheck.error });
      if (await User.findOne({ facultyId: idCheck.id }).select('_id')) return res.status(409).json({ error: 'That Employee ID is already registered to another account.' });
      account.facultyId = idCheck.id;
      account.noIdYet = false;
      account.programPosition = String(programPosition).trim();
      const headProgram = programOfPosition(account.programPosition);
      if (employmentType && !isEmploymentType(employmentType)) return res.status(400).json({ error: 'Choose Full-time or Part-time.' });
      if (employmentType) account.employmentType = employmentType;
      if (headProgram) account.program = headProgram;
      else if (program) {
        if (!isProgram(program)) return res.status(400).json({ error: 'Program must be BS INFO, BS COMSCI or BLIS.' });
        account.program = program.trim();
      }
    }

    const newUser = await User.create(account);
    res.json({ message: 'Account provisioned successfully', facultyName: newUser.name, userId: newUser._id, role: newUser.role });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: 'An account with that email or ID already exists.' });
    console.error('Provisioning error:', error.message);
    res.status(500).json({ error: 'Error provisioning account' });
  }
});

const BULK_UPLOAD_LIMIT = 2 * 1024 * 1024;
const bulkUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: BULK_UPLOAD_LIMIT, files: 1 },
  fileFilter: (req, file, cb) => {
    const name = String(file.originalname || '').toLowerCase();
    if (!name.endsWith('.xlsx') && !name.endsWith('.csv')) {
      cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'Unsupported file type.'));
      return;
    }
    cb(null, true);
  },
});

const STUDENT_TEMPLATE_HEADERS = ['Full name', 'School email', 'School ID', 'Program', 'Year', 'Section', 'Gender'];
const FACULTY_TEMPLATE_HEADERS = ['Full name', 'School email', 'Employee ID', 'Position', 'Program (optional)', 'Role (Faculty or Dean)', 'Employment type (optional)', 'Gender'];

function safeCsvCell(value) {
  let out = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(out)) out = "'" + out;
  return '"' + out.replace(/"/g, '""') + '"';
}

function addTemplateSheet(workbook, kind) {
  const headers = kind === 'student' ? STUDENT_TEMPLATE_HEADERS : FACULTY_TEMPLATE_HEADERS;
  const sheet = workbook.addWorksheet(kind === 'student' ? 'Students' : 'Faculty');
  sheet.addRow(headers);
  headers.forEach((header, index) => {
    sheet.getColumn(index + 1).width = Math.max(18, header.length + 4);
  });
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

router.get('/bulk/template/:kind.xlsx', requireAuth(['ADMIN']), async (req, res) => {
  try {
    const kind = String(req.params.kind || '').toLowerCase();
    if (!['student', 'faculty'].includes(kind)) return res.status(404).json({ error: 'Unknown template.' });
    const workbook = new ExcelJS.Workbook();
    addTemplateSheet(workbook, kind);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${kind}-account-template.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch {
    res.status(500).json({ error: 'Could not create the spreadsheet template.' });
  }
});

router.get('/bulk/template/:kind.csv', requireAuth(['ADMIN']), (req, res) => {
  const kind = String(req.params.kind || '').toLowerCase();
  if (!['student', 'faculty'].includes(kind)) return res.status(400).json({ error: 'Unknown template.' });
  const headers = kind === 'student' ? STUDENT_TEMPLATE_HEADERS : FACULTY_TEMPLATE_HEADERS;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${kind}-account-template.csv"`);
  res.send(headers.map(safeCsvCell).join(',') + '\r\n');
});

function workbookRows(buffer, originalName) {
  return (async () => {
    if (!buffer || buffer.length === 0) throw new Error('The selected file is empty.');
    const workbook = new ExcelJS.Workbook();
    const lowerName = String(originalName || '').toLowerCase();
    if (lowerName.endsWith('.xlsx')) {
      await workbook.xlsx.load(buffer);
    } else if (lowerName.endsWith('.csv')) {
      await workbook.csv.read(Readable.from(buffer));
    } else {
      throw new Error('Only .xlsx and .csv files are accepted.');
    }
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error('The spreadsheet is empty.');
    if (sheet.rowCount < 2) throw new Error('The spreadsheet is empty.');

    const headerRow = sheet.getRow(1);
    const headers = {};
    headerRow.eachCell((cell, colNumber) => {
      if (cell.type === 6 || cell.formula) throw new Error('Spreadsheet headers cannot contain formulas.');
      const canonical = importFieldForHeader(cell.value);
      if (canonical) headers[canonical] = colNumber;
    });

    const rows = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const get = (canonical) => {
        const colNumber = headers[canonical];
        if (!colNumber) return '';
        const cell = row.getCell(colNumber);
        if (cell.type === 6 || cell.formula) return '=' + String(cell.result ?? cell.value?.result ?? '');
        if (cell.type === 5 && cell.value?.text) return text(cell.value.text);
        return text(cell.value);
      };
      const candidate = {
        name: get('name'),
        email: get('email'),
        schoolId: get('schoolId'),
        employeeId: get('employeeId'),
        program: get('program'),
        year: get('year'),
        section: get('section'),
        gender: get('gender'),
        position: get('position'),
        role: get('role'),
        employmentType: get('employmentType'),
      };
      if (Object.values(candidate).some(v => text(v) !== '')) {
        rows.push(candidate);
      }
    });
    if (rows.length > MAX_ROWS) throw new Error(`The spreadsheet exceeds the ${MAX_ROWS}-row limit.`);
    if (!rows.length) throw new Error('The spreadsheet contains no account rows.');
    return rows;
  })();
}

async function handleBulkPreview(req, res) {
  try {
    const kind = String(req.query.template || '').toLowerCase();
    if (!['student', 'faculty'].includes(kind)) return res.status(400).json({ error: 'Choose a Student or Faculty template.' });
    if (!req.file) return res.status(400).json({ error: 'Choose an Excel or CSV file.' });
    const rows = await workbookRows(req.file.buffer, req.file.originalname);
    const results = await validateImportRows(User, rows, kind, process.env);
    res.json({
      template: kind,
      totalRows: results.length,
      validRows: results.filter(r => r.valid).length,
      rejectedRows: results.filter(r => !r.valid).length,
      rows: results.map(r => ({
        rowNumber: r.rowNumber,
        valid: r.valid,
        errors: r.errors,
        submitted: r.submitted,
      })),
    });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Could not read the spreadsheet.' });
  }
}

async function handleBulkConfirm(req, res) {
  try {
    const kind = String(req.query.template || '').toLowerCase();
    if (!['student', 'faculty'].includes(kind)) return res.status(400).json({ error: 'Choose a Student or Faculty template.' });
    if (!req.file) return res.status(400).json({ error: 'Choose an Excel or CSV file.' });
    const rows = await workbookRows(req.file.buffer, req.file.originalname);
    const results = await validateImportRows(User, rows, kind, process.env);

    let created = 0;
    const rejected = [];
    for (const result of results) {
      if (!result.valid) {
        rejected.push({
          rowNumber: result.rowNumber,
          submitted: result.submitted,
          reason: result.errors.join(' '),
        });
        continue;
      }
      try {
        await User.create(result.account);
        created += 1;
      } catch (error) {
        let reason = 'Database validation failed.';
        if (error && error.code === 11000) reason = 'An account with that email or ID already exists.';
        rejected.push({ rowNumber: result.rowNumber, submitted: result.submitted, reason });
      }
    }

    res.json({
      template: kind,
      totalRows: results.length,
      created,
      rejected: rejected.length,
      rejectedRows: rejected,
    });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Could not import the spreadsheet.' });
  }
}

router.post('/bulk/preview', requireAuth(['ADMIN']), bulkUpload.single('file'), handleBulkPreview);
router.post('/bulk/confirm', requireAuth(['ADMIN']), bulkUpload.single('file'), handleBulkConfirm);

// PATCH /api/faculty/program/:id  { program }  - set or clear (program: '') the program of a faculty account
router.patch('/program/:id', requireAuth(STAFF), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Faculty account not found.' });
    const { program } = req.body || {};
    const clear = program === '' || program === null;
    if (!clear && !isProgram(program)) return res.status(400).json({ error: 'Program must be BS INFO, BS COMSCI or BLIS.' });
    const target = await User.findOne({ _id: req.params.id, role: 'FACULTY' }).select('programPosition').lean();
    if (!target) return res.status(404).json({ error: 'Faculty account not found.' });
    if (programOfPosition(target.programPosition)) return res.status(400).json({ error: "A Program Head's program comes from the position and cannot be changed here." });
    const faculty = await User.findOneAndUpdate(
      { _id: req.params.id, role: 'FACULTY' },
      clear ? { $unset: { program: 1 } } : { $set: { program: program.trim() } },
      { new: true, runValidators: true }
    ).select('name program');
    if (!faculty) return res.status(404).json({ error: 'Faculty account not found.' });
    res.json({ message: 'Program updated.', program: faculty.program || '' });
  } catch (error) {
    res.status(500).json({ error: 'Server error while updating the program.' });
  }
});

// 7. GET ROUTE: Fetch announcements by section
router.get('/announcements/:section', requireAuth(ALL_ROLES), async (req, res) => {
  try {
    const announcements = await Announcement.find({
      $or: [{ section: req.params.section }, { section: 'ALL' }]
    }).sort({ datePosted: -1 });
    res.json(announcements);
  } catch (error) {
    res.status(500).json({ error: 'Server error fetching announcements' });
  }
});

// Bookable slots for one faculty member over the next 4 weeks: hourly pieces of the official and added consultation
// hours, plus vacant hours (Mon-Fri, 8 AM-5 PM). `busy` lists the class and approved-appointment times (no names)
// so the calendar can show why a cell is not bookable.
async function loadSlots(facultyId, flaggedDate = '') {
  const today = manilaNow().dateStr;
  const horizon = addDays(today, 28);
  const [official, added, classes, appointments, blockers] = await Promise.all([
    ConsultationHours.find({ facultyId }).lean(),
    AddedConsultationHours.find({ facultyId, dayOfWeek: { $in: CONSULTATION_DAYS } }).lean(),
    Schedule.find({ facultyId }).lean(),
    Appointment.find({ facultyId, status: { $in: ['PENDING', 'APPROVED'] }, date: { $gte: today, $lt: horizon } }).lean(),
    // A meeting or leave the faculty posted closes those hours to new bookings (existing bookings are left alone).
    FacultyStatusEntry.find({ facultyId, type: { $in: BOOKING_BLOCKING }, endAt: { $gt: new Date() } }).lean(),
  ]);
  return {
    slots: dropBlockedSlots(buildSlots({ official, added, classes, appointments, today, nowMs: Date.now(), weeks: 4, leadHours: BOOKING_LEAD_HOURS, flaggedDate }), blockers),
    busy: buildBusy({ classes, appointments, today, weeks: 4, flaggedDate }),
  };
}

router.get('/slots/:facultyId', requireAuth(ALL_ROLES), async (req, res) => {
  try {
    const faculty = await User.findOne(consultableFilter({ _id: req.params.facultyId })).select('flaggedDate accountStatus');
    if (!faculty || (req.user.role !== 'ADMIN' && ['RESTRICTED', 'ARCHIVED'].includes(faculty.accountStatus))) {
      return res.status(404).json({ error: 'Faculty member not found.' });
    }
    const { slots, busy } = await loadSlots(faculty._id, faculty.flaggedDate);
    res.json({ leadHours: BOOKING_LEAD_HOURS, slots, busy });
  } catch (error) {
    res.status(500).json({ error: 'Server error fetching consultation slots.' });
  }
});

// --- Added consultation hours: extra WEEKLY hours in vacant time, on top of the 4 official weekly hours ---
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

router.get('/added-hours', requireAuth(['FACULTY', 'DEAN']), async (req, res) => {
  try {
    res.json(await AddedConsultationHours.find({ facultyId: req.user.userId, dayOfWeek: { $in: CONSULTATION_DAYS } }).sort({ dayOfWeek: 1, startTime: 1 }));
  } catch (error) {
    res.status(500).json({ error: 'Server error fetching added hours.' });
  }
});

router.post('/added-hours', requireAuth(['FACULTY', 'DEAN']), async (req, res) => {
  try {
    const facultyId = req.user.userId;
    const { dayOfWeek, startTime, endTime } = req.body || {};
    const dow = parseDay(dayOfWeek); // null / '' must not become 0
    if (!Number.isInteger(dow) || !HHMM.test(String(startTime)) || !HHMM.test(String(endTime))) {
      return res.status(400).json({ error: 'Choose a day, a start time and an end time.' });
    }
    if (!isConsultationDay(dow)) {
      return res.status(400).json({ error: 'Consultation hours are only available Monday to Friday.' });
    }
    const s = timeToMinutes(startTime), e = timeToMinutes(endTime);
    if (e - s < 30) return res.status(400).json({ error: 'Added hours must be at least 30 minutes long.' });
    if (s < OPERATING_START || s > OPERATING_LAST_START || e > OPERATING_LAST_END) return res.status(400).json({ error: 'Added hours must start between 7:30 AM and 6:30 PM and end by 7:00 PM.' });

    const [classes, official, added] = await Promise.all([
      Schedule.find({ facultyId, dayOfWeek: dow }),
      ConsultationHours.find({ facultyId, dayOfWeek: dow }),
      AddedConsultationHours.find({ facultyId, dayOfWeek: dow }),
    ]);
    const hit = (list) => list.some(b => overlaps(s, e, timeToMinutes(b.startTime), timeToMinutes(b.endTime)));
    if (hit(classes)) return res.status(400).json({ error: 'That time overlaps your teaching schedule. Added hours go in your vacant time.' });
    if (hit(official)) return res.status(400).json({ error: 'That time is already part of your weekly consultation hours.' });
    if (hit(added)) return res.status(400).json({ error: 'You already added hours that overlap this time.' });

    res.json(await AddedConsultationHours.create({ facultyId, dayOfWeek: dow, startTime, endTime }));
  } catch (error) {
    res.status(400).json({ error: error.message || 'Could not add the hours.' });
  }
});

// Weekly added hours of any faculty member (shown on their public master schedule).
router.get('/added-hours/of/:facultyId', requireAuth(ALL_ROLES), async (req, res) => {
  try {
    res.json(await AddedConsultationHours.find({ facultyId: req.params.facultyId, dayOfWeek: { $in: CONSULTATION_DAYS } }).sort({ dayOfWeek: 1, startTime: 1 }).select('dayOfWeek startTime endTime'));
  } catch (error) {
    res.status(500).json({ error: 'Server error fetching added hours.' });
  }
});

router.delete('/added-hours/:id', requireAuth(['FACULTY', 'DEAN']), async (req, res) => {
  try {
    const block = await AddedConsultationHours.findOne({ _id: req.params.id, facultyId: req.user.userId });
    if (!block) return res.status(404).json({ error: 'Not found.' });
    const s = timeToMinutes(block.startTime), e = timeToMinutes(block.endTime);
    const today = manilaNow().dateStr;
    const open = await Appointment.find({ facultyId: block.facultyId, date: { $gte: today }, status: { $in: ['PENDING', 'APPROVED'] } });
    // Upcoming requests on this weekday inside the hours being removed would be left stranded.
    if (open.some(a => dayOfWeekOf(a.date) === block.dayOfWeek && overlaps(s, e, timeToMinutes(a.time), timeToMinutes(a.time) + (Number(a.duration) || 60)))) {
      return res.status(400).json({ error: 'Students have upcoming requests in these hours. Decline or cancel them first.' });
    }
    await block.deleteOne();
    res.json({ message: 'Added hours removed.' });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Could not remove the hours.' });
  }
});

// 8. POST ROUTE: Student requests an appointment
router.post('/appointment', requireAuth(['STUDENT']), async (req, res) => {
  try {
    // Read-only mode: students who haven't completed their profile (incl. a valid ID) can browse but not book.
    const booker = await User.findById(req.user.userId).select('role onboardingComplete schoolId');
    if (!booker || !isProfileComplete(booker)) {
      return res.status(403).json({ error: 'Complete your profile details and ID to unlock consultation requests.' });
    }

    const { facultyId, date, time, studentName, studentSection, reason } = req.body;
    const studentId = req.user.userId; // from the verified login token, not the request body

    // The request must match a real, open slot (consultation hours or a vacant hour, Mon-Fri 8 AM-5 PM): this covers
    // the 1-hour lead time, operating hours, classes, approved appointments and the faculty's
    // out-of-office date. The duration comes from the slot, not from the student.
    const faculty = await User.findOne(consultableFilter({ _id: facultyId })).select('name flaggedDate accountStatus weeklyRequestLimit');
    if (!faculty || ['RESTRICTED', 'ARCHIVED'].includes(faculty.accountStatus)) {
      return res.status(404).json({ error: 'Faculty member not found.' });
    }
    const slot = (await loadSlots(faculty._id, faculty.flaggedDate)).slots.find(x => x.date === date && x.start === time);
    if (!slot) {
      return res.status(400).json({ error: 'That time slot is not available. Please choose one from the faculty\'s consultation hours.' });
    }
    const duration = slot.duration;

    // No request limit (project decision, Nov 4): any number of students may request an hour; the professor accepts one.
    // One student, though, may not repeat himself (same professor + same reason) or double-book himself
    // (same date and hour with two professors). Rules and tests: utils/duplicateRequest.js.
    const mine = await Appointment.find({ studentId, status: { $in: ['PENDING', 'APPROVED'] } }).select('facultyId date time duration reason status');
    const conflict = findConflict(mine, { facultyId, date, time, duration, reason });
    if (conflict) {
      const f = await User.findById(facultyId).select('name');
      return res.status(409).json({ error: conflictMessage(conflict, f?.name || 'this professor'), code: conflict.code });
    }

    // Weekly limit per student with this person (the Dean: 5 a week; faculty: none). Counted by consultation date, Mon-Sun.
    const week = weekBounds(date);
    const sameWeek = () => Appointment.find({ studentId, facultyId: faculty._id, status: { $in: COUNTED_STATUSES }, date: { $gte: week.start, $lte: week.end } }).select('date status').lean();
    const limitCheck = checkWeeklyLimit(await sameWeek(), date, faculty.weeklyRequestLimit);
    if (!limitCheck.ok) {
      return res.status(429).json({ error: limitMessage(faculty.name, limitCheck.limit), code: 'WEEKLY_LIMIT', used: limitCheck.used, limit: limitCheck.limit });
    }

    // Save the pending request
    const newAppointment = await Appointment.create({
      facultyId,
      studentId,
      studentName,
      studentSection,
      date,
      time,
      duration,
      reason,
      status: 'PENDING'
    });

    // Two requests sent at the same moment can both pass the check above: count again and undo this one if it went over.
    if (limitCheck.limit && (await sameWeek()).length > limitCheck.limit) { // this request is already saved, so it is counted too
      await Appointment.deleteOne({ _id: newAppointment._id });
      return res.status(429).json({ error: limitMessage(faculty.name, limitCheck.limit), code: 'WEEKLY_LIMIT', limit: limitCheck.limit });
    }

    await notify(facultyId, {
      type: 'APPOINTMENT_REQUEST',
      title: 'New consultation request',
      message: `${studentName} (${studentSection}) requested ${fmtDate(date)} at ${fmtTime(time)}. Reason: ${String(reason).slice(0, 100)}`,
      appointmentId: newAppointment._id,
    });

    res.json({ message: 'Appointment requested successfully!', appointment: newAppointment });

  } catch (error) {
    console.error('Student Booking Error:', error);
    res.status(500).json({ error: 'Server error processing the appointment request.' });
  }
});

// 9. GET ROUTE: Admin fetches ALL appointments
router.get('/appointments/all', requireAuth(STAFF), async (req, res) => {
  try {
    const appointments = await Appointment.find().populate('facultyId', 'name').sort({ createdAt: -1 });
    res.json(appointments);
  } catch (error) {
    res.status(500).json({ error: 'Server error fetching all appointments' });
  }
});

// 10. GET ROUTE: Fetch all unverified users
router.get('/users/all', requireAuth(STAFF), async (req, res) => {
  try {
    const users = await User.find({ role: { $ne: 'ADMIN' } })
  .select('-password')
  .sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Server error fetching users' });
  }
});

// Approve a pending student/faculty account. The Admin does not assign an ID here: the
// School ID / Faculty ID the person entered at registration stays on the account untouched.
// Approving is also the moment the person is emailed (a fresh verification link, or a plain
// "you can log in" notice if they had already confirmed their email).
router.patch('/users/:id/verify', requireAuth(STAFF), async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('+verificationToken +verificationTokenExpires');
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.role !== 'STUDENT' && user.role !== 'FACULTY') {
      return res.status(400).json({ error: 'This role cannot be verified this way.' });
    }

    user.accountStatus = 'ACTIVE';
    await user.save();

    let emailSent = true;
    let notEmailed = false; // true when SMTP isn't set up, so nothing really left the server
    try {
      let result;
      if (user.isVerified) {
        const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').split(',')[0].trim();
        result = await sendApprovedEmail(user.email, { loginLink: frontendUrl });
      } else {
        result = await sendApprovedEmail(user.email, { verifyLink: await issueVerificationLink(user) });
      }
      notEmailed = !!(result && result.preview);
    } catch (mailError) {
      emailSent = false;
      console.error('Approval email failed:', mailError);
    }

    res.json({
      message: notEmailed
        ? `${user.name} has been approved. Email is not set up on this server, so nothing was emailed: they can click "Resend" on the login page and the link will appear on screen.`
        : emailSent
        ? `${user.name} has been approved. An email was sent to ${user.email}.`
        : `${user.name} has been approved, but the email could not be sent. Ask them to use "Resend" on the login page.`,
      emailSent,
      user
    });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Verification failed.' });
  }
});

// Admin adds or corrects a student's School ID / a faculty member's Faculty ID (User Management).
// This is how accounts that registered with "I don't have my ID yet" get their ID later.
router.patch('/users/:id/id', requireAuth(['ADMIN']), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.role !== 'STUDENT' && user.role !== 'FACULTY') {
      return res.status(400).json({ error: 'Only student and faculty accounts have an ID.' });
    }

    const isStudent = user.role === 'STUDENT';
    const idValue = String(req.body.idValue || '').trim().toUpperCase();
    if (!(isStudent ? SCHOOL_ID_REGEX : FACULTY_ID_REGEX).test(idValue)) {
      return res.status(400).json({
        error: isStudent
          ? 'Invalid School ID format. Use 2025-S00001 or 2025-1234-A.'
          : 'Invalid Faculty ID format. Use 2025S-00001.'
      });
    }
    const taken = await User.findOne({ [isStudent ? 'schoolId' : 'facultyId']: idValue, _id: { $ne: user._id } });
    if (taken) return res.status(400).json({ error: 'Another account already uses this ID.' });

    if (isStudent) user.schoolId = idValue; else user.facultyId = idValue;
    user.noIdYet = false;
    await user.save();

    res.json({
      message: `${isStudent ? 'School' : 'Faculty'} ID saved for ${user.name}.`,
      user: { _id: user._id, schoolId: user.schoolId, facultyId: user.facultyId, noIdYet: user.noIdYet }
    });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Could not save the ID.' });
  }
});

// Admin moves an older account (e.g. registered with a personal Gmail) to the person's school email,
// so their next Google sign-in finds the account with its appointments and ID intact.
router.patch('/users/:id/email', requireAuth(['ADMIN']), async (req, res) => {
  try {
    const newEmail = String(req.body.email || '').trim().toLowerCase();
    const domains = parseList(process.env.ALLOWED_EMAIL_DOMAIN);
    if (!EMAIL_REGEX.test(newEmail) || !domains.includes(newEmail.split('@')[1])) {
      return res.status(400).json({ error: `Use a school email address (${domains.map(d => '@' + d).join(', ') || 'domain not configured'}).` });
    }
    if (req.params.id === req.user.userId) {
      return res.status(400).json({ error: 'You cannot change your own email here.' });
    }
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const taken = await User.findOne({ email: newEmail, _id: { $ne: user._id } }).select('name role');
    if (taken) {
      return res.status(409).json({ error: `That email already belongs to another account (${taken.name}). If it is an empty duplicate created by signing in, remove it first.` });
    }
    user.email = newEmail;
    user.googleSub = undefined; // the Google identity is re-linked on their next sign-in
    await user.save();
    res.json({ message: `${user.name} can now sign in with ${newEmail}.`, user: { _id: user._id, email: user.email } });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Could not change the email.' });
  }
});

// ADMIN: disable / re-enable a student, faculty or Dean account.
// Disabled = accountStatus RESTRICTED or ARCHIVED: they cannot sign in (password login, Google sign-in, or an
// already-open session) and faculty are hidden from booking lists. Appointments, ID and records are kept.
router.patch('/users/:id/status', requireAuth(['ADMIN']), async (req, res) => {
  try {
    if (typeof req.body.disabled !== 'boolean') {
      return res.status(400).json({ error: 'Send { "disabled": true } or { "disabled": false }.' });
    }
    if (req.params.id === req.user.userId) {
      return res.status(400).json({ error: 'You cannot disable your own account.' });
    }
    const user = await User.findById(req.params.id).select('name role accountStatus');
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!canDisableRole(user.role)) {
      return res.status(400).json({ error: 'Only student, faculty and Dean accounts can be disabled here.' });
    }

    if (req.body.disabled) {
      if (user.accountStatus !== 'ACTIVE' && user.accountStatus !== 'RESTRICTED') {
        return res.status(400).json({ error: 'Only active or restricted accounts can be disabled.' });
      }
      await User.updateOne({ _id: user._id }, { accountStatus: 'RESTRICTED' });
      return res.json({ message: `${user.name}'s account is disabled.`, user: { _id: user._id, accountStatus: 'RESTRICTED' } });
    }

    if (!canEnableAccountStatus(user.accountStatus)) {
      return res.status(400).json({ error: 'This account is not disabled.' });
    }
    await User.updateOne({ _id: user._id }, { accountStatus: 'ACTIVE' });
    res.json({ message: `${user.name}'s account is enabled again.`, user: { _id: user._id, accountStatus: 'ACTIVE' } });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Could not update the account.' });
  }
});

// ADMIN: edit an account's profile in one save. The same fields a person edits on their own profile (name, gender, School / Faculty ID),
// plus program, year and section for a STUDENT. Not editable here: role, a faculty member's academic position, and the email (its own route).
// Send only what changed. Nothing is saved unless every field that was sent is valid.
router.patch('/users/:id/profile', requireAuth(['ADMIN']), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.role !== 'STUDENT' && user.role !== 'FACULTY' && user.role !== 'DEAN') {
      return res.status(400).json({ error: 'Only student, faculty and Dean accounts can be edited here.' });
    }
    const wasStudent = user.role === 'STUDENT';
    let isStudent = wasStudent;
    const { name, gender, idValue, program, year, section, employmentType, role: newRole, programPosition: newPosition } = req.body || {};

    // Role change (Admin only, this route): Student, Faculty or Dean. The person's current sign-in stops working at once (see
    // requireAuth) and they sign in again with the new role. Switching to Student needs a valid program / year / section and a
    // School ID; switching from Student to Faculty or Dean needs an approved academic position.
    if (newRole !== undefined && newRole !== user.role) {
      if (!['STUDENT', 'FACULTY', 'DEAN'].includes(newRole)) return res.status(400).json({ error: 'Choose Student, Faculty or Dean.' });
      if (String(user._id) === String(req.user.userId)) return res.status(400).json({ error: 'You cannot change your own role.' });
      if (newRole === 'STUDENT') {
        if (!isValidCohort(program, year, section)) return res.status(400).json({ error: 'Choose the program, year and section for the student.' });
        if (!user.schoolId && !idValue) return res.status(400).json({ error: 'Enter the School ID for the student.' });
      } else if (wasStudent && !isApprovedFacultyPosition(newPosition)) {
        return res.status(400).json({ error: 'Choose an academic position for the new role.' });
      }
      console.info(`[admin] role change: ${user.role} -> ${newRole} for account ${user._id} by admin ${req.user.userId}`);
      user.role = newRole;
      isStudent = newRole === 'STUDENT';
    }

    // Academic position (faculty and Dean). A Program Head position also sets the program.
    if (newPosition !== undefined && newPosition !== user.programPosition) {
      if (isStudent) return res.status(400).json({ error: 'Students have no academic position. Their program, year and section are set instead.' });
      if (!isApprovedFacultyPosition(newPosition)) return res.status(400).json({ error: 'Choose one of the approved positions.' });
      user.programPosition = newPosition;
      const headProgram = programOfPosition(newPosition);
      if (headProgram) user.program = headProgram;
    }

    if (name !== undefined) {
      const clean = String(name).replace(/\s+/g, ' ').trim();
      if (clean.length < 2 || clean.length > 100) return res.status(400).json({ error: 'Name must be 2 to 100 characters.' });
      user.name = clean;
    }

    if (gender !== undefined) {
      if (!['Male', 'Female'].includes(gender)) return res.status(400).json({ error: 'Choose Male or Female.' }); // 'Prefer not to say' was retired; accounts that have it keep it
      user.gender = gender;
    }

    if (idValue !== undefined) {
      const id = String(idValue || '').trim().toUpperCase();
      if (!(isStudent ? SCHOOL_ID_REGEX : FACULTY_ID_REGEX).test(id)) {
        return res.status(400).json({
          error: isStudent ? 'Invalid School ID format. Use 2025-S00001 or 2025-1234-A.' : 'Invalid Faculty ID format. Use 2025S-00001.'
        });
      }
      const taken = await User.findOne({ [isStudent ? 'schoolId' : 'facultyId']: id, _id: { $ne: user._id } }).select('_id');
      if (taken) return res.status(400).json({ error: 'Another account already uses this ID.' });
      if (isStudent) user.schoolId = id; else user.facultyId = id;
      user.noIdYet = false;
    }

    if (!isStudent && (year !== undefined || section !== undefined)) return res.status(400).json({ error: 'Only students have a year and section.' });
    if (!isStudent && (program !== undefined || employmentType !== undefined)) {
      // A faculty member's program (BS INFO / BS COMSCI / BLIS) and employment type. A Program Head's program comes from the position.
      if (program !== undefined) {
        if (programOfPosition(user.programPosition)) return res.status(400).json({ error: "A Program Head's program comes from the position and cannot be changed here." });
        if (!isProgram(program)) return res.status(400).json({ error: 'Program must be BS INFO, BS COMSCI or BLIS.' });
        user.program = program.trim();
      }
      if (employmentType !== undefined) {
        if (!isEmploymentType(employmentType)) return res.status(400).json({ error: 'Choose Full-time or Part-time.' });
        user.employmentType = employmentType;
      }
    }
    if (isStudent && employmentType !== undefined) return res.status(400).json({ error: 'Only faculty have an employment type.' });

    if (isStudent && (program !== undefined || year !== undefined || section !== undefined)) {
      if (!isValidCohort(program, year, section)) return res.status(400).json({ error: 'Choose a valid program, year and section.' });
      user.programPosition = cohortLabel(program, year, section);
    }

    await user.save({ validateModifiedOnly: true });
    res.json({
      message: `${user.name}'s account was updated.`,
      user: { _id: user._id, name: user.name, role: user.role, gender: user.gender, schoolId: user.schoolId, facultyId: user.facultyId, noIdYet: user.noIdYet, programPosition: user.programPosition,
        program: isStudent ? '' : effectiveProgram(user), employmentType: user.employmentType || '' }
    });
  } catch (error) {
    if (error.code === 11000) return res.status(400).json({ error: 'Another account already uses this ID.' });
    res.status(400).json({ error: error.message || 'Could not save the changes.' });
  }
});

// ADMIN: correct a user's display name (Google names are copied once at account creation).
router.patch('/users/:id/name', requireAuth(['ADMIN']), async (req, res) => {
  try {
    const name = String(req.body.name || '').replace(/\s+/g, ' ').trim();
    if (name.length < 2 || name.length > 100) {
      return res.status(400).json({ error: 'Name must be 2 to 100 characters.' });
    }
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.name = name;
    await user.save();
    res.json({ message: `Name updated to ${name}.`, user: { _id: user._id, name: user.name } });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Could not change the name.' });
  }
});

// 12. GET ROUTE: Fetch appointments for one specific faculty member
router.get('/appointments/me/:facultyId', requireAuth(['FACULTY','ADMIN','DEAN']), ownerOrStaff(r => r.params.facultyId), async (req, res) => {
  try {
    const { facultyId } = req.params;
    const appointments = await Appointment.find({ facultyId }).populate('studentId', 'gender').sort({ createdAt: -1 });

    // Each request still waiting for an answer also carries `availableWindow`: how much uninterrupted bookable time
    // (consultation + vacant hours) there is from its start, up to the next class or approved appointment.
    // Nothing else in the response changes.
    const today = manilaNow().dateStr;
    const isOpen = (a) => a.status === 'PENDING' && a.date >= today;
    if (!appointments.some(isOpen)) return res.json(appointments);
    const [official, added, classes] = await Promise.all([
      ConsultationHours.find({ facultyId }).lean(),
      AddedConsultationHours.find({ facultyId, dayOfWeek: { $in: CONSULTATION_DAYS } }).lean(),
      Schedule.find({ facultyId }).lean(),
    ]);
    const approved = appointments.filter(a => a.status === 'APPROVED');
    res.json(appointments.map(a => isOpen(a)
      ? { ...a.toObject(), availableWindow: openWindow({ date: a.date, time: a.time, official, added, classes, appointments: approved, excludeId: a._id }) }
      : a));
  } catch (error) {
    res.status(500).json({ error: 'Server error fetching my appointments' });
  }
});

// 13. PUT ROUTE: Save a Notice
// 13b. Faculty sets their own manual status (used by the My Status card)
// ---- My Status: manual statuses that always expire ----------------------------------------------
// Body: { type, duration, untilTime? }  duration = 15 | 30 | 60 | 120 | 'UNTIL' | 'EOD'
router.post('/status-entry', requireAuth(['FACULTY', 'DEAN']), async (req, res) => {
  try {
    const { type, duration, untilTime } = req.body || {};
    const now = new Date();
    const end = endFromChoice(duration, untilTime, now);
    if (!end.ok) return res.status(400).json({ error: end.error });

    const existing = await FacultyStatusEntry.find({ facultyId: req.user.userId, endAt: { $gt: now } }).lean();
    // A new status replaces the one running right now; only a later, separate notice can clash.
    const running = existing.filter(e => e.startAt <= now);
    const others = existing.filter(e => e.startAt > now);
    const activeNotice = running.find(e => e.isNotice);
    if (activeNotice) {
      return res.status(400).json({ error: 'You have a posted notice running now. Cancel it under Upcoming notices first.' });
    }
    const check = validateEntry({ type, startAt: now, endAt: end.endAt }, others, now, { requireReason: false });
    if (!check.ok) return res.status(400).json({ error: check.error });

    // End any status that is running now, so there is only ever one.
    if (running.length) await FacultyStatusEntry.updateMany({ _id: { $in: running.map(e => e._id) } }, { $set: { endAt: now } });

    const entry = await FacultyStatusEntry.create({
      facultyId: req.user.userId, type, startAt: now, endAt: end.endAt,
    });
    await StatusHistory.create({ facultyId: req.user.userId, status: type });
    res.status(201).json(entry);
  } catch (err) {
    res.status(500).json({ error: 'Error setting status' });
  }
});

// Clear my current manual status early. A scheduled (future) entry is deleted instead.
router.delete('/status-entry/:id', requireAuth(['FACULTY', 'DEAN']), async (req, res) => {
  try {
    if (!isObjectIdHex(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const entry = await FacultyStatusEntry.findById(req.params.id);
    if (!entry || String(entry.facultyId) !== String(req.user.userId)) return res.status(404).json({ error: 'Status not found' });
    const now = new Date();
    if (entry.endAt <= now) return res.json({ ok: true });
    if (entry.startAt > now) await entry.deleteOne();
    else { entry.endAt = now; await entry.save(); }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error clearing status' });
  }
});

// ---- Post a Notice: a meeting or leave planned ahead (shown to students, closes booking in its window) ----
// Meeting body: { type:'IN_MEETING', startDate, startTime, endTime, reason, reasonOther?, makeUpInfo? }
// Leave body:   { type:'ON_LEAVE', startDate, endDate, reason, reasonOther?, makeUpInfo? }
router.post('/notice-entry', requireAuth(['FACULTY', 'DEAN']), async (req, res) => {
  try {
    const b = req.body || {};
    const now = new Date();
    const w = windowFromNotice(b, now);
    if (!w.ok) return res.status(400).json({ error: w.error });

    const existing = await FacultyStatusEntry.find({ facultyId: req.user.userId, endAt: { $gt: now } }).lean();
    const entry = {
      type: b.type, reason: String(b.reason || ''), reasonOther: String(b.reasonOther || '').trim().slice(0, 120),
      startAt: w.startAt, endAt: w.endAt,
    };
    const check = validateEntry(entry, existing, now);
    if (!check.ok) return res.status(400).json({ error: check.error });

    const saved = await FacultyStatusEntry.create({
      ...entry, facultyId: req.user.userId, isNotice: true,
      makeUpInfo: String(b.makeUpInfo || '').trim().slice(0, 300),
    });
    res.status(201).json(saved);
  } catch (err) {
    res.status(500).json({ error: 'Error posting notice' });
  }
});

// My notices that have not ended yet, soonest first.
router.get('/notices/mine', requireAuth(['FACULTY', 'DEAN']), async (req, res) => {
  try {
    const list = await FacultyStatusEntry.find({ facultyId: req.user.userId, isNotice: true, endAt: { $gt: new Date() } })
      .sort({ startAt: 1 }).lean();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: 'Error loading notices' });
  }
});

// 15. GET ROUTE: Fetch appointments for one specific student
// NOTE: previously matched by studentName (string), which meant two students sharing the
// same name could see each other's appointments. Now scoped to the actual account's ID.
// ---- Appeals -------------------------------------------------------------------------------
// Students appeal a missed / cancelled consultation to the faculty member; faculty appeal theirs to the Dean.
const APPEALABLE = {
  STUDENT: ['MISSED (STUDENT)', 'CANCELLED BY STUDENT'],
  FACULTY: ['MISSED (FACULTY)', 'CANCELLED BY FACULTY'],
};

// A reason is a record only (no review). A student's reason goes to the professor. The professor's reason (a Dean who takes
// consultations counts as the professor for his own appointments) goes to the STUDENT, so they know why it was cancelled or missed.
router.post('/appointment/:id/appeal', requireAuth(['STUDENT', 'FACULTY', 'DEAN']), async (req, res) => {
  try {
    const apt = await Appointment.findById(req.params.id);
    if (!apt) return res.status(404).json({ error: 'Appointment not found.' });
    const role = req.user.role === 'STUDENT' ? 'STUDENT' : 'FACULTY'; // which side of the consultation this person is on
    const mine = role === 'FACULTY'
      ? String(apt.facultyId) === String(req.user.userId)
      : String(apt.studentId) === String(req.user.userId);
    if (!mine) return res.status(403).json({ error: 'Forbidden' });
    if (!APPEALABLE[role].includes(apt.status)) {
      return res.status(400).json({ error: 'Only a missed or cancelled consultation can have a reason added.' });
    }
    if (apt.appeal && apt.appeal.status) return res.status(400).json({ error: 'You already added a reason for this consultation.' });
    const reason = String(req.body.reason || '').trim().slice(0, 300);
    if (!reason) return res.status(400).json({ error: 'Please select or enter a reason.' });

    apt.appeal = { by: role, reason, status: 'SUBMITTED', submittedAt: new Date() }; // record only: no accept/reject review
    await apt.save();

    const when = `${fmtDate(apt.date)} at ${fmtTime(apt.time)}`;
    if (role === 'STUDENT') {
      await notify(apt.facultyId, { type: 'APPEAL', title: 'Student reason', message: `${apt.studentName} added a reason for the missed or cancelled consultation on ${when}. Reason: ${reason}`, appointmentId: apt._id });
    } else {
      const me = await User.findById(req.user.userId).select('name');
      await notify(await resolveStudentId(apt), { type: 'APPOINTMENT_UPDATE', title: 'Reason from your instructor', message: `${me ? me.name : 'Your instructor'} added a reason for the missed or cancelled consultation on ${when}. Reason: ${reason}`, appointmentId: apt._id });
    }
    res.json({ message: 'Reason submitted.', appointment: apt });
  } catch (error) {
    res.status(500).json({ error: 'Server error submitting the reason.' });
  }
});

// The Dean switches student consultation requests on or off, and sets the weekly limit per student (default 5).
router.get('/dean/consultation-settings', requireAuth(['DEAN']), async (req, res) => {
  try {
    const me = await User.findById(req.user.userId).select('acceptsConsultations weeklyRequestLimit').lean();
    res.json({ acceptsConsultations: !!(me && me.acceptsConsultations), weeklyRequestLimit: (me && me.weeklyRequestLimit) || 5 });
  } catch (error) {
    res.status(500).json({ error: 'Server error fetching your consultation settings.' });
  }
});

router.patch('/dean/consultation-settings', requireAuth(['DEAN']), async (req, res) => {
  try {
    const set = {};
    if (req.body.acceptsConsultations !== undefined) {
      if (typeof req.body.acceptsConsultations !== 'boolean') return res.status(400).json({ error: 'acceptsConsultations must be true or false.' });
      set.acceptsConsultations = req.body.acceptsConsultations;
    }
    if (req.body.weeklyRequestLimit !== undefined) {
      const n = Number(req.body.weeklyRequestLimit);
      if (!Number.isInteger(n) || n < 1 || n > 20) return res.status(400).json({ error: 'The weekly limit must be a whole number from 1 to 20.' });
      set.weeklyRequestLimit = n;
    }
    const me = await User.findById(req.user.userId).select('weeklyRequestLimit');
    if (set.acceptsConsultations === true && !set.weeklyRequestLimit && !me.weeklyRequestLimit) set.weeklyRequestLimit = 5;
    const updated = await User.findByIdAndUpdate(req.user.userId, { $set: set }, { new: true }).select('acceptsConsultations weeklyRequestLimit').lean();
    res.json({ acceptsConsultations: !!updated.acceptsConsultations, weeklyRequestLimit: updated.weeklyRequestLimit || 5 });
  } catch (error) {
    res.status(500).json({ error: 'Server error saving your consultation settings.' });
  }
});

router.get('/appointments/student/:studentId', requireAuth(['STUDENT','ADMIN','DEAN']), ownerOrStaff(r => r.params.studentId), async (req, res) => {
  try {
    const appointments = await Appointment.find({ studentId: req.params.studentId })
      .populate('facultyId', 'name')
      .sort({ createdAt: -1 });
    res.json(appointments);
  } catch (error) {
    res.status(500).json({ error: 'Server error fetching student appointments' });
  }
});

// One appointment, for the details drawer that a notification link opens (?apt=<id>).
// Answers 404 both when the id does not exist and when it is not yours, so it cannot be used to find out which ids exist.
router.get('/appointment/:id', requireAuth(ALL_ROLES), async (req, res) => {
  try {
    if (!isObjectIdHex(req.params.id)) return res.status(404).json({ error: 'Appointment not found.' });
    const apt = await Appointment.findById(req.params.id).populate('facultyId', 'name').lean();
    if (!apt || !canViewAppointment(req.user, apt)) return res.status(404).json({ error: 'Appointment not found.' });
    res.json(apt);
  } catch (error) {
    res.status(500).json({ error: 'Server error fetching the appointment.' });
  }
});

// Faculty sets/updates their consultation hours
// const timeToMinutes = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

router.post('/consultation-hours', requireAuth(['FACULTY', 'DEAN']), async (req, res) => {
  try {
    const { hours } = req.body; // [{ dayOfWeek, startTime, endTime }, ...]
    const facultyId = req.user.userId; // always the logged-in faculty, never trust the body

    // Consultation hours are Monday to Friday only (a weekend class may exist, a weekend consultation may not).
    if (!Array.isArray(hours) || hours.some(h => !isConsultationDay(parseDay(h && h.dayOfWeek)))) {
      return res.status(400).json({ error: 'Consultation hours are only available Monday to Friday.' });
    }

    // 1. Total must be exactly 4 hours (240 minutes)
    const totalMinutes = hours.reduce((sum, h) => sum + (timeToMinutes(h.endTime) - timeToMinutes(h.startTime)), 0);
    const totalError = hoursTotalError(req.user.role, totalMinutes);
    if (totalError) return res.status(400).json({ error: totalError });

    // 2. None of these blocks may overlap the faculty's own teaching schedule
    const teachingSchedule = await Schedule.find({ facultyId });
    for (const block of hours) {
      const conflict = teachingSchedule.some(cls => 
        cls.dayOfWeek === block.dayOfWeek &&
        timeToMinutes(block.startTime) < timeToMinutes(cls.endTime) &&
        timeToMinutes(cls.startTime) < timeToMinutes(block.endTime)
      );
      if (conflict) {
        return res.status(400).json({ error: `Consultation block on day ${block.dayOfWeek} overlaps your teaching schedule.` });
      }
    }

    await ConsultationHours.deleteMany({ facultyId });
    const created = await ConsultationHours.insertMany(hours.map(h => ({ ...h, facultyId })));
    res.json({ message: 'Consultation hours saved.', hours: created });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// =========================================================================
// === CALENDAR NOTES (private, one-off, date-specific) ====================
// =========================================================================
// Body: { date: 'YYYY-MM-DD', startTime: 'HH:MM', endTime: 'HH:MM', text }
// Notes may not overlap that weekday's fixed teaching blocks or consultation hours.
const validateNote = async (facultyId, { date, startTime, endTime, text }) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || isNaN(new Date(date + 'T00:00:00Z')))
    return 'A valid date (YYYY-MM-DD) is required.';
  if (!/^\d{2}:\d{2}$/.test(startTime || '') || !/^\d{2}:\d{2}$/.test(endTime || ''))
    return 'Start and end time (HH:MM) are required.';
  if (timeToMinutes(endTime) <= timeToMinutes(startTime))
    return 'End time must be after start time.';
  if (!text || !String(text).trim()) return 'Note text is required.';
  if (String(text).length > 500) return 'Note must be 500 characters or fewer.';

  // Weekday of the specific date, timezone-safe. 0=Sun ... 6=Sat (matches Schedule/ConsultationHours).
  const dayOfWeek = new Date(date + 'T00:00:00Z').getUTCDay();
  const fixed = [
    ...(await Schedule.find({ facultyId, dayOfWeek })),
    ...(await ConsultationHours.find({ facultyId, dayOfWeek })),
  ];
  const conflict = fixed.some(b =>
    timeToMinutes(startTime) < timeToMinutes(b.endTime) &&
    timeToMinutes(b.startTime) < timeToMinutes(endTime)
  );
  return conflict ? 'This time overlaps a class or consultation hours block.' : null;
};

// List all notes for a faculty member
router.get('/notes/:facultyId', requireAuth(['FACULTY', 'DEAN']), ownerOnly(r => r.params.facultyId), async (req, res) => {
  try {
    const notes = await CalendarNote.find({ facultyId: req.params.facultyId }).sort({ date: 1, startTime: 1 });
    res.json(notes);
  } catch (error) {
    res.status(500).json({ error: 'Server error fetching notes.' });
  }
});

// Create a note
router.post('/notes/:facultyId', requireAuth(['FACULTY', 'DEAN']), ownerOnly(r => r.params.facultyId), async (req, res) => {
  try {
    const { facultyId } = req.params;
    const { date, startTime, endTime, text } = req.body;
    const problem = await validateNote(facultyId, { date, startTime, endTime, text });
    if (problem) return res.status(400).json({ error: problem });

    const note = await CalendarNote.create({ facultyId, date, startTime, endTime, text: String(text).trim() });
    res.json({ message: 'Note added.', note });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Edit a note (:id is the NOTE id here)
router.put('/notes/:id', requireAuth(['FACULTY', 'DEAN']), async (req, res) => {
  try {
    const note = await CalendarNote.findOne({ _id: req.params.id, facultyId: req.user.userId });
    if (!note) return res.status(404).json({ error: 'Note not found.' });

    const { date, startTime, endTime, text } = req.body;
    const problem = await validateNote(note.facultyId, { date, startTime, endTime, text });
    if (problem) return res.status(400).json({ error: problem });

    Object.assign(note, { date, startTime, endTime, text: String(text).trim() });
    await note.save();
    res.json({ message: 'Note updated.', note });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Delete a note (:id is the NOTE id)
router.delete('/notes/:id', requireAuth(['FACULTY', 'DEAN']), async (req, res) => {
  try {
    await CalendarNote.findOneAndDelete({ _id: req.params.id, facultyId: req.user.userId });
    res.json({ message: 'Note removed.' });
  } catch (error) {
    res.status(500).json({ error: 'Server error deleting note.' });
  }
});

router.get('/faculty/:id/public-schedule', async (req, res) => {
  try {
    const classes = await Schedule.find({ facultyId: req.params.id });
    const consultHours = await ConsultationHours.find({ facultyId: req.params.id });

    // Class blocks: strip subject/room entirely, just mark the hours as unavailable
    const publicClasses = classes.map(c => ({
      dayOfWeek: c.dayOfWeek,
      startTime: c.startTime,
      endTime: c.endTime,
      label: 'Class (Unavailable)'
    }));

    // Consultation blocks: these are exactly what students need to see in full
    const publicConsult = consultHours.map(c => ({
      dayOfWeek: c.dayOfWeek,
      startTime: c.startTime,
      endTime: c.endTime,
      label: 'Consultation Hours (Book Here)'
    }));

    res.json([...publicClasses, ...publicConsult]);
  } catch (error) {
    res.status(500).json({ error: 'Server error fetching schedule.' });
  }
});

// Complete a consultation and record the log entry (digital sign-off)
router.patch('/appointment/:id/complete', requireAuth(['FACULTY', 'DEAN']), async (req, res) => {
  try {
    const interventionValue = String(req.body.interventionTaken ?? '').trim();
    if (!interventionValue) {
      return res.status(400).json({ error: 'Select or enter the intervention / action taken.' });
    }
    const apt = await Appointment.findOne({ _id: req.params.id, facultyId: req.user.userId });
    if (!apt) return res.status(404).json({ error: 'Appointment not found.' });
    // The case presented is the student's Purpose of Meeting and is not editable: the body value is ignored.
    const caseValue = String(apt.reason ?? '').trim();
    if (!caseValue) return res.status(400).json({ error: 'This appointment has no purpose of meeting to record.' });
    // A consultation marked as missed (by the faculty member, the student or the system) can still be signed off as
    // completed if it did take place, but only for CORRECTION_HOURS after the miss was marked.
    const wasMissed = apt.status === 'MISSED (STUDENT)' || apt.status === 'MISSED (FACULTY)';
    // A consultation marked missed (by the student, the faculty member or the system) cannot be saved to the log.
    if (wasMissed) {
      return res.status(400).json({ error: 'A consultation marked as missed cannot be saved to the Consultation Log.' });
    }
    if (apt.status !== 'APPROVED') {
      return res.status(400).json({ error: 'Only approved consultations can be completed.' });
    }
    if (wasMissed && !canCorrectMiss(apt)) {
      return res.status(400).json({ error: `A missed consultation can only be corrected within ${CORRECTION_HOURS} hours of being marked missed.` });
    }
    if (apt.completedAt) {
      return res.status(400).json({ error: 'This consultation has already been signed off and cannot be edited.' });
    }
    // An upcoming consultation cannot be saved to the log before it starts.
    if (!hasStarted(apt)) {
      return res.status(400).json({ error: 'This consultation has not started yet. You can save it once its scheduled time has arrived.' });
    }

    const done = await transition(Appointment, apt._id, ['APPROVED', 'MISSED (STUDENT)', 'MISSED (FACULTY)'], {
      casePresented: caseValue, interventionTaken: interventionValue, status: 'COMPLETED', completedAt: new Date(),
      ...(wasMissed ? { correctedAt: new Date(), correctedFrom: apt.status } : {}),
    }, { completedAt: { $exists: false } });
    if (!done) return res.status(409).json({ error: CHANGED_MESSAGE });

    await notify(await resolveStudentId(apt), {
      type: 'CONSULTATION_LOGGED',
      title: 'Consultation completed',
      message: wasMissed
        ? `Your consultation on ${fmtDate(apt.date)} was logged and signed off by your instructor. It is no longer counted as ${apt.status === 'MISSED (STUDENT)' ? 'Missed by Student' : 'Missed by Faculty'}.`
        : `Your consultation on ${fmtDate(apt.date)} was logged and signed off by your instructor.`,
      appointmentId: apt._id,
    });

    res.json({ message: 'Consultation logged and signed off.', appointment: done });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Edit the two consultation-log fields after sign-off. Only the owning faculty member may update them.
router.patch('/appointment/:id/consultation-log', requireAuth(['FACULTY', 'DEAN']), async (req, res) => {
  try {
    const apt = await Appointment.findOne({
      _id: req.params.id,
      facultyId: req.user.userId,
      status: 'COMPLETED',
    }).populate('studentId', 'gender');
    if (!apt) return res.status(404).json({ error: 'Completed consultation not found.' });

    // Only the intervention can be changed afterwards. The case presented stays as signed off (the Purpose of Meeting).
    const interventionTaken = String(req.body.interventionTaken ?? '').trim();
    if (!interventionTaken) {
      return res.status(400).json({ error: 'Select or enter the intervention / action taken.' });
    }
    apt.casePresented = apt.casePresented || apt.reason;
    apt.interventionTaken = interventionTaken;
    await apt.save();

    res.json({ message: 'Consultation log updated.', appointment: apt });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Could not update consultation log.' });
  }
});

// Faculty cancels an APPROVED consultation (counted as "CANCELLED BY FACULTY" in the reports)
router.patch('/appointment/:id/cancel', requireAuth(['FACULTY', 'DEAN']), async (req, res) => {
  try {
    const apt = await Appointment.findOne({ _id: req.params.id, facultyId: req.user.userId });
    if (!apt) return res.status(404).json({ error: 'Appointment not found.' });
    if (apt.status !== 'APPROVED') {
      return res.status(400).json({ error: 'Only approved consultations can be cancelled. Use Reject for pending requests.' });
    }
    // Once the day is over it can no longer be cancelled: it is either signed off or missed.
    if (apt.date < manilaNow().dateStr) {
      return res.status(400).json({ error: 'This consultation date has already passed.' });
    }
    if (hoursUntil(apt.date, apt.time) < CANCEL_CUTOFF_HOURS) {
      return res.status(400).json({ error: 'Approved appointments can only be cancelled up to 1 hour before the scheduled time.' });
    }
    const reason = String(req.body.reason || '').trim().slice(0, 300);
    if (!reason) return res.status(400).json({ error: 'Please select or enter a reason.' });
    const cancelled = await transition(Appointment, apt._id, 'APPROVED', { status: 'CANCELLED BY FACULTY', cancelReason: reason });
    if (!cancelled) return res.status(409).json({ error: CHANGED_MESSAGE });

    const faculty = await User.findById(req.user.userId).select('name');
    await notify(await resolveStudentId(apt), {
      type: 'APPOINTMENT_UPDATE',
      title: 'Consultation cancelled by instructor',
      message: `${faculty ? faculty.name : 'Your instructor'} cancelled your consultation on ${fmtDate(apt.date)} at ${fmtTime(apt.time)}.${reason ? ` Reason: ${reason}` : ''}`,
      appointmentId: apt._id,
    });
    res.json({ message: 'Consultation cancelled.', appointment: cancelled });
  } catch (error) {
    res.status(500).json({ error: 'Server error cancelling consultation.' });
  }
});

// Cancel several appointments at once (panelist rule 3.3). Students cancel their own open requests and
// appointments; faculty cancel approved appointments and decline pending requests. One reason covers all.
// Each appointment is checked on its own; the ones that cannot be cancelled are reported back, not failed.
router.post('/appointments/bulk-cancel', requireAuth(['STUDENT', 'FACULTY', 'DEAN']), async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? [...new Set(req.body.ids.map(String))] : [];
    const reason = String(req.body.reason || '').trim().slice(0, 300);
    if (!ids.length) return res.status(400).json({ error: 'Select at least one appointment.' });
    if (ids.length > MAX_BULK) return res.status(400).json({ error: `You can cancel up to ${MAX_BULK} at a time.` });
    if (!reason) return res.status(400).json({ error: 'Please select or enter a reason.' });

    const me = await User.findById(req.user.userId).select('name');
    const role = req.user.role === 'DEAN' ? 'FACULTY' : req.user.role; // a Dean cancels his own consultations like faculty do
    const cancelled = [];
    const skipped = [];
    for (const id of ids) {
      const apt = mongoose.isValidObjectId(id) ? await Appointment.findById(id) : null;
      const d = bulkCancelDecision({ role, userId: req.user.userId, userName: me && me.name, apt, nowMs: Date.now() });
      if (!d.ok) { skipped.push({ id, reason: d.reason }); continue; }

      const moved = await transition(Appointment, apt._id, apt.status, { status: d.newStatus, cancelReason: reason });
      if (!moved) { skipped.push({ id, reason: 'Just updated by someone else.' }); continue; }
      cancelled.push(id);

      const when = `${fmtDate(apt.date)} at ${fmtTime(apt.time)}`;
      if (role === 'STUDENT') {
        await notify(apt.facultyId, { type: 'APPOINTMENT_UPDATE', title: 'Consultation cancelled by student', message: `${apt.studentName} cancelled the consultation on ${when}. Reason: ${reason}`, appointmentId: apt._id });
      } else {
        const verb = d.newStatus === 'REJECTED' ? 'declined' : 'cancelled';
        await notify(await resolveStudentId(apt), { type: 'APPOINTMENT_UPDATE', title: `Consultation ${verb}`, message: `${me ? me.name : 'Your instructor'} ${verb} your consultation on ${when}. Reason: ${reason}`, appointmentId: apt._id });
      }
    }
    res.json({ message: `${cancelled.length} cancelled${skipped.length ? `, ${skipped.length} could not be cancelled` : ''}.`, cancelled, skipped });
  } catch (error) {
    console.error('Bulk cancel error:', error.message);
    res.status(500).json({ error: 'Server error cancelling the appointments.' });
  }
});

// Faculty marks the consultation as Missed by Student (stored as "MISSED (STUDENT)"; the route name is kept)
router.patch('/appointment/:id/no-show', requireAuth(['FACULTY', 'DEAN']), async (req, res) => {
  try {
    const apt = await Appointment.findOne({ _id: req.params.id, facultyId: req.user.userId });
    if (!apt) return res.status(404).json({ error: 'Appointment not found.' });
    if (apt.status !== 'APPROVED') {
      return res.status(400).json({ error: 'Only approved consultations can be marked as Missed by Student.' });
    }
    // Not before the grace period after the start has passed (Philippine time)
    if (!canMarkMissed(apt)) {
      const opens = manilaNow(missOpensAt(apt)).hhmm;
      return res.status(400).json({ error: `A consultation can be marked as missed ${MISS_GRACE_MINUTES} minutes after its start, from ${fmtTime(opens)}.` });
    }
    // Like a cancellation, a miss needs a reason, and the student sees it.
    const reason = cleanReason(req.body && req.body.reason);
    if (!reason) return res.status(400).json({ error: 'Please select or enter a reason.' });
    const marked = await transition(Appointment, apt._id, 'APPROVED', { status: 'MISSED (STUDENT)', missedAt: new Date(), missReason: reason, missedBy: 'FACULTY' });
    if (!marked) return res.status(409).json({ error: CHANGED_MESSAGE });

    await notify(await resolveStudentId(apt), {
      type: 'APPOINTMENT_UPDATE',
      title: 'Consultation marked Missed by Student',
      message: `You did not attend your consultation on ${fmtDate(apt.date)} at ${fmtTime(apt.time)}. Reason from your instructor: ${reason} If something prevented you, you can add your own reason in CCIS Sync.`,
      appointmentId: apt._id,
    });
    res.json({ message: 'Marked as Missed by Student.', appointment: marked });
  } catch (error) {
    res.status(500).json({ error: 'Server error marking as Missed by Student.' });
  }
});

// Fetch a faculty member's consultation log (completed entries, oldest first like the paper form)
// The student reports that the instructor did not show up: the consultation becomes Missed by Faculty
// (stored as "MISSED (FACULTY)"). Allowed 30 minutes after the start; a reason is required and the faculty member sees it.
router.patch('/appointment/:id/faculty-missed', requireAuth(['STUDENT']), async (req, res) => {
  try {
    const apt = mongoose.isValidObjectId(req.params.id) ? await Appointment.findById(req.params.id) : null;
    const me = await User.findById(req.user.userId).select('name');
    const d = reportDecision({ apt, userId: req.user.userId, userName: me && me.name, reason: req.body && req.body.reason });
    if (!d.ok) return res.status(d.status).json({ error: d.error });

    const marked = await transition(Appointment, apt._id, 'APPROVED', { status: 'MISSED (FACULTY)', missedAt: new Date(), missReason: d.reason, missedBy: 'STUDENT' });
    if (!marked) return res.status(409).json({ error: CHANGED_MESSAGE });

    await notify(apt.facultyId, {
      type: 'APPOINTMENT_UPDATE',
      title: 'Consultation marked Missed by Faculty',
      message: `${apt.studentName} reported that the consultation on ${fmtDate(apt.date)} at ${fmtTime(apt.time)} did not take place. Reason from the student: ${d.reason}`,
      appointmentId: apt._id,
    });
    res.json({ message: 'Reported as Missed by Faculty.', appointment: marked });
  } catch (error) {
    res.status(500).json({ error: 'Server error reporting the missed consultation.' });
  }
});

router.get('/consultation-log/:facultyId', requireAuth(['FACULTY','ADMIN','DEAN']), ownerOrStaff(r => r.params.facultyId), async (req, res) => {
  try {
    const log = await Appointment.find({ 
      facultyId: req.params.facultyId, 
      status: 'COMPLETED' 
    }).populate('studentId', 'gender').sort({ completedAt: 1 });
    res.json(log);
  } catch (error) {
    res.status(500).json({ error: 'Server error fetching consultation log.' });
  }
});

// Anyone can check a faculty member's declared hours (students need this to book)
router.get('/consultation-hours/:facultyId', requireAuth(ALL_ROLES), async (req, res) => {
  const hours = await ConsultationHours.find({ facultyId: req.params.facultyId });
  res.json(hours);
});

// =========================================================================
// === NOTIFICATIONS (each user only ever sees their own) ==================
// =========================================================================
router.get('/notifications', requireAuth(ALL_ROLES), async (req, res) => {
  try {
    const userId = req.user.userId;
    const [items, unreadCount] = await Promise.all([
      Notification.find({ userId }).sort({ createdAt: -1 }).limit(30),
      Notification.countDocuments({ userId, read: false }),
    ]);
    res.json({ unreadCount, items });
  } catch (error) {
    res.status(500).json({ error: 'Server error fetching notifications.' });
  }
});

router.patch('/notifications/read-all', requireAuth(ALL_ROLES), async (req, res) => {
  try {
    await Notification.updateMany({ userId: req.user.userId, read: false }, { $set: { read: true } });
    res.json({ message: 'All notifications marked as read.' });
  } catch (error) {
    res.status(500).json({ error: 'Server error updating notifications.' });
  }
});

// ======================================================================
// MAILBOX: delete notifications (the bell's X and "Clear all" buttons)
// ======================================================================
router.delete('/notifications/:id', requireAuth(ALL_ROLES), async (req, res) => {
  try {
    await Notification.deleteOne({ _id: req.params.id, userId: req.user.userId });
    res.json({ message: 'Notification deleted.' });
  } catch (error) { res.status(500).json({ error: 'Server error deleting notification.' }); }
});

router.delete('/notifications', requireAuth(ALL_ROLES), async (req, res) => {
  try {
    await Notification.deleteMany({ userId: req.user.userId });
    res.json({ message: 'All notifications deleted.' });
  } catch (error) { res.status(500).json({ error: 'Server error clearing notifications.' }); }
});

router.patch('/notifications/:id/read', requireAuth(ALL_ROLES), async (req, res) => {
  try {
    await Notification.updateOne({ _id: req.params.id, userId: req.user.userId }, { $set: { read: true } });
    res.json({ message: 'Marked as read.' });
  } catch (error) {
    res.status(500).json({ error: 'Server error updating notification.' });
  }
});

// =========================================================================
// === EMAIL VERIFICATION ===
// =========================================================================

// Confirms the token from the verification email and activates the account.
router.get('/verify-email/:token', async (req, res) => {
  try {
    const hashedToken = crypto.createHash('sha256').update(req.params.token).digest('hex');

    const user = await User.findOne({
      verificationToken: hashedToken,
      verificationTokenExpires: { $gt: Date.now() }
    }).select('+verificationToken +verificationTokenExpires');

    if (!user) {
      return res.status(400).json({ error: 'This verification link is invalid or has expired.' });
    }

    user.isVerified = true;
    user.verificationToken = undefined;
    user.verificationTokenExpires = undefined;
    await user.save();

    res.json({ message: 'Email verified! You can now log in.' });
  } catch (error) {
    res.status(500).json({ error: 'Server error verifying email.' });
  }
});

// =========================================================================
// === RESEND VERIFICATION EMAIL ===
// =========================================================================

// For accounts that registered but never got a working link (lost email, SMTP not set up yet,
// link expired). Always replies with the same neutral message whether or not the email belongs
// to an account, so it can't be used to find out who is registered.
const resendVerificationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many requests. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

router.post('/resend-verification', resendVerificationLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: (email || '').toLowerCase() })
      .select('+verificationToken +verificationTokenExpires');

    // Accounts still waiting for Admin approval are skipped: they get their email on approval.
    let devLink;
    if (user && !user.isVerified && user.accountStatus !== 'PENDING_APPROVAL') {
      const link = await issueVerificationLink(user); // the old link stops working
      const result = await sendVerificationEmail(user.email, link);
      // Local development only (no SMTP set up): show the link on the page instead of the terminal.
      if (result && result.preview) devLink = link;
    }

    res.json({ message: 'If that account exists and still needs verification, a new link has been sent.', ...(devLink ? { devLink } : {}) });
  } catch (error) {
    res.status(500).json({ error: 'Could not send the email. Please try again later.' });
  }
});

// =========================================================================
// === FORGOT PASSWORD ===
// =========================================================================

// Step 1: request a reset link. Always replies with the same neutral message,
// whether or not that email belongs to an account — this stops the endpoint
// being used to check which emails are registered students/faculty.
router.post('/forgot-password', forgotPasswordLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: (email || '').toLowerCase() });
    let devLink;

    if (user) {
      const rawResetToken = crypto.randomBytes(32).toString('hex');
      const hashedResetToken = crypto.createHash('sha256').update(rawResetToken).digest('hex');

      user.resetPasswordToken = hashedResetToken;
      user.resetPasswordExpires = Date.now() + 15 * 60 * 1000; // 15 minutes
      await user.save();

      const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').split(',')[0].trim();
      const resetLink = `${frontendUrl}/reset-password/${rawResetToken}`;
      const result = await sendResetEmail(user.email, resetLink);
      // Local development only (no SMTP set up): show the link on the page instead of the terminal.
      if (result && result.preview) devLink = resetLink;
    }

    res.json({ message: 'If an account exists for this email, a password reset link has been sent.', ...(devLink ? { devLink } : {}) });
  } catch (error) {
    res.status(500).json({ error: 'Server error processing the request.' });
  }
});

// Step 2: the link's token is checked, the new password is validated with the
// same rule used at registration, and the token is single-use (cleared on success).
router.post('/reset-password/:token', async (req, res) => {
  try {
    const { newPassword } = req.body;

    const passwordPattern = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,}$/;
    if (!passwordPattern.test(newPassword)) {
      return res.status(400).json({ error: 'Password must be at least 12 characters, with 1 uppercase letter, 1 number, and 1 symbol.' });
    }

    const hashedToken = crypto.createHash('sha256').update(req.params.token).digest('hex');

    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() }
    }).select('+resetPasswordToken +resetPasswordExpires');

    if (!user) {
      return res.status(400).json({ error: 'This reset link is invalid or has expired.' });
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.json({ message: 'Password updated. You can now log in with your new password.' });
  } catch (error) {
    res.status(500).json({ error: 'Server error resetting password.' });
  }
});

// ======================================================================
// DEAN: EXECUTIVE BROADCAST
// A pinned message pushed to every Student/Faculty dashboard banner
// and their notification mailbox. Only DEAN can create/end them.
// ======================================================================

const broadcastStatus = (b, now = new Date()) =>
  b.endedAt ? 'ENDED' : (new Date(b.expiresAt) <= now ? 'EXPIRED' : 'ACTIVE');

// Dean sends a broadcast
router.post('/broadcasts', requireAuth(['DEAN']), async (req, res) => {
  try {
    const title = String(req.body.title || '').trim();
    const message = String(req.body.message || '').trim();
    const audience = req.body.audience || 'ALL';
    const priority = req.body.priority || 'URGENT';
    const minutes = Number(req.body.durationMinutes);

    if (!title || title.length > 120) return res.status(400).json({ error: 'Title is required (max 120 characters).' });
    if (!message || message.length > 1000) return res.status(400).json({ error: 'Message is required (max 1000 characters).' });
    if (!['ALL', 'STUDENT', 'FACULTY'].includes(audience)) return res.status(400).json({ error: 'Invalid audience.' });
    if (!['URGENT', 'NOTICE'].includes(priority)) return res.status(400).json({ error: 'Invalid priority.' });
    if (!Number.isFinite(minutes) || minutes < 15 || minutes > 20160) {
      return res.status(400).json({ error: 'Duration must be between 15 minutes and 14 days.' });
    }

    const dean = await User.findById(req.user.userId).select('name');
    const broadcast = await Broadcast.create({
      title, message, audience, priority,
      expiresAt: new Date(Date.now() + minutes * 60 * 1000),
      createdBy: req.user.userId,
      createdByName: dean ? dean.name : 'Office of the Dean',
    });

    const roles = audience === 'ALL' ? ['STUDENT', 'FACULTY'] : [audience];
    const recipients = await User.countDocuments({ role: { $in: roles }, accountStatus: 'ACTIVE' });
    for (const role of roles) {
      await notifyRole(role, { type: 'DEAN_BROADCAST', title: `Dean's Office: ${title}`, message });
    }

    res.status(201).json({ broadcast, recipients });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error sending broadcast.' });
  }
});

// Active broadcasts for the current user's role (Student/Faculty banner feed)
router.get('/broadcasts/active', requireAuth(ALL_ROLES), async (req, res) => {
  try {
    const now = new Date();
    const list = await Broadcast.find({
      audience: { $in: ['ALL', req.user.role] },
      endedAt: null,
      expiresAt: { $gt: now },
    }).sort({ createdAt: -1 });
    const out = list
      .map(b => ({
        _id: b._id, title: b.title, message: b.message, priority: b.priority,
        createdByName: b.createdByName, createdAt: b.createdAt, expiresAt: b.expiresAt,
      }))
      .sort((a, b) => (a.priority === b.priority ? 0 : a.priority === 'URGENT' ? -1 : 1));
    res.json(out);
  } catch (error) { res.status(500).json({ error: 'Server error fetching broadcasts.' }); }
});

// Dean: history of all broadcasts
router.get('/broadcasts', requireAuth(['DEAN']), async (req, res) => {
  try {
    const now = new Date();
    const list = await Broadcast.find({}).sort({ createdAt: -1 }).limit(50);
    res.json(list.map(b => ({ ...(b.toObject ? b.toObject() : b), status: broadcastStatus(b, now) })));
  } catch (error) { res.status(500).json({ error: 'Server error fetching broadcast history.' }); }
});

// Dean: end a broadcast early
router.patch('/broadcasts/:id/end', requireAuth(['DEAN']), async (req, res) => {
  try {
    const b = await Broadcast.findById(req.params.id);
    if (!b) return res.status(404).json({ error: 'Broadcast not found.' });
    if (!b.endedAt) { b.endedAt = new Date(); await b.save(); }
    res.json({ message: 'Broadcast ended.' });
  } catch (error) { res.status(500).json({ error: 'Server error ending broadcast.' }); }
});

router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'The file exceeds the 2 MB limit.' });
    if (error.code === 'LIMIT_UNEXPECTED_FILE') return res.status(400).json({ error: 'Only .xlsx and .csv files are accepted.' });
  }
  next(error);
});

module.exports = router;
