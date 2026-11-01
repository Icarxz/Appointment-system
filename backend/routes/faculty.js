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
const { buildSlots, buildBusy, insideBookableHours, maxDurationAt, addDays, dayOfWeekOf, overlaps, MAX_PENDING_PER_SLOT } = require('../utils/slots');
const { isOverlapping } = require('../utils/timeMath');
const { requireAuth } = require('../middleware/auth');

// Generic shape check for admin-provisioned accounts (any domain, but still a single "@").
const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// Official ID formats (same rules as the User model).
const { STUDENT_ID_REGEX: SCHOOL_ID_REGEX, EMPLOYEE_ID_REGEX: FACULTY_ID_REGEX } = require('../utils/idValidator');
const Broadcast = require('../models/Broadcast');
const { isProfileComplete, parseList, audienceMismatch } = require('../utils/signInPolicy');
const { bulkCancelDecision, MAX_BULK } = require('../utils/bulkCancel');
const { canViewAppointment } = require('../utils/appointmentAccess');
const { isObjectIdHex } = require('../utils/notifyLink');
const { manilaNow, manilaDate } = require('../utils/manilaTime');

// Booking / cancellation time limits (appointment date + time are Manila time)
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
    const facultyList = await User.find({ role: 'FACULTY' })
      .select('name gender programPosition currentStatus currentLocation room statusUpdatedAt statusNote noticeMessage flaggedDate flaggedReason')
      .sort({ name: 1 });

    // Compare Manila calendar days. new Date().setHours(0,0,0,0) uses the server's
    // own timezone (UTC on most hosts), which made early-morning check-ins look stale.
    const todayManila = manilaNow().dateStr;

    const enriched = facultyList.map(f => {
      const obj = f.toObject();
      // Students never receive classroom locations (also stripped from the schedule endpoint)
      if (req.user.role === 'STUDENT') { delete obj.room; delete obj.currentLocation; }
      const updatedToday = f.statusUpdatedAt && manilaNow(new Date(f.statusUpdatedAt)).dateStr === todayManila;
      
      const scheduleDriven = obj.currentStatus === 'IN_CLASS' || obj.currentStatus === 'IN_CONSULTATION';
      if (!updatedToday && !scheduleDriven) {
        obj.currentStatus = 'NOT_UPDATED';
      }
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
    const targetApt = await Appointment.findById(req.params.id);

    if (!targetApt) {
      return res.status(404).json({ error: 'Appointment not found.' });
    }

    // Who may change this appointment, and to what
    if (req.user.role === 'FACULTY' && String(targetApt.facultyId) !== String(req.user.userId)) {
      return res.status(403).json({ error: 'Forbidden' });
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
    if (status === 'APPROVED') {
      const facultyId = targetApt.facultyId;
      const aptDate = new Date(targetApt.date);
      
      // Get day of week (0 = Sunday, 1 = Monday) to check against recurring classes
      const dayOfWeek = aptDate.getDay(); 

      // Must still fall inside the consultation hours (official or added) or the vacant window (Mon-Fri, 8 AM-5 PM)
      const [official, added] = await Promise.all([
        ConsultationHours.find({ facultyId }).lean(),
        AddedConsultationHours.find({ facultyId, dayOfWeek: { $gte: 1 } }).lean(),
      ]);

      // Faculty may shorten the consultation, or extend it across back-to-back consultation hours that
      // day (up to 2 hours in total). The length can never run past the end of that continuous run.
      if (req.body.duration !== undefined) {
        const newDuration = Number(req.body.duration);
        const maxAllowed = maxDurationAt({ date: targetApt.date, time: targetApt.time, official, added });
        if (!Number.isInteger(newDuration) || newDuration < 15 || newDuration > Math.max(maxAllowed, targetApt.duration)) {
          return res.status(400).json({ error: `Duration must be between 15 minutes and ${Math.max(maxAllowed, targetApt.duration)} minutes.` });
        }
        targetApt.duration = newDuration;
      }

      if (!insideBookableHours({ date: targetApt.date, time: targetApt.time, duration: targetApt.duration, official, added })) {
        return res.status(400).json({ error: 'This time is outside the faculty member\'s consultation hours and the Monday to Friday, 8 AM to 5 PM booking window.' });
      }

      // 1b. Fetch faculty's immovable teaching schedule for this day
      const dayClasses = await Schedule.find({ facultyId, dayOfWeek });

      // 2. Fetch faculty's ALREADY APPROVED appointments for this exact date
      const approvedAppointments = await Appointment.find({
        facultyId: facultyId,
        date: targetApt.date,
        status: 'APPROVED',
        _id: { $ne: targetApt._id }
      });

      // Pool all physical commitments together
      const allExistingEvents = [...dayClasses, ...approvedAppointments];

      // 3. RUN THE HEURISTIC
      if (isOverlapping(targetApt.time, allExistingEvents, targetApt.duration)) {
        return res.status(409).json({ 
          error: 'Double-Booking Prevented: This time block conflicts with an existing class or approved appointment.' 
        });
      }
    }

    // If math clears (or if they are just rejecting/canceling), execute the database write
    const previousStatus = targetApt.status;
    targetApt.status = status;
    if (status === 'CANCELLED BY STUDENT' || status === 'REJECTED') targetApt.cancelReason = reason;
    await targetApt.save();

    // Approving one request for a slot declines the other pending requests that overlap it.
    if (status === 'APPROVED' && previousStatus !== 'APPROVED') {
      const s0 = timeToMinutes(targetApt.time), e0 = s0 + (Number(targetApt.duration) || 60);
      const rivals = await Appointment.find({ facultyId: targetApt.facultyId, date: targetApt.date, status: 'PENDING', _id: { $ne: targetApt._id } });
      for (const r of rivals) {
        const rs = timeToMinutes(r.time);
        if (!overlaps(s0, e0, rs, rs + (Number(r.duration) || 60))) continue;
        r.status = 'REJECTED';
        r.cancelReason = 'Another student\'s request for this time was accepted.';
        await r.save();
        await notify(await resolveStudentId(r), {
          type: 'APPOINTMENT_UPDATE',
          title: 'Consultation request declined',
          message: `Your request on ${fmtDate(r.date)} at ${fmtTime(r.time)} was declined because the slot went to another student. Please choose another slot.`,
          appointmentId: r._id,
        });
      }
    }

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
          title: `Consultation ${verb}`,
          message: `Your request with ${faculty ? faculty.name : 'your instructor'} on ${when} was ${verb}.${status === 'REJECTED' && reason ? ` Reason: ${reason}` : ''}`,
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

// 4. POST ROUTE: Admin assigns a schedule to a faculty member
router.post('/schedule/add', requireAuth(STAFF), async (req, res) => {
  const { facultyId, subject, room, dayOfWeek, startTime, endTime } = req.body;
  try {
    await Schedule.create({ facultyId, subject, room, dayOfWeek, startTime, endTime });
    await notify(facultyId, {
      type: 'SCHEDULE_ASSIGNED',
      title: 'New class added to your schedule',
      message: `${subject} in ${room}, ${fmtTime(startTime)} - ${fmtTime(endTime)}.`,
      page: 'schedule',
    });
    res.json({ message: 'Schedule assigned successfully!' });
  } catch (error) {
    res.status(500).json({ error: 'Server error assigning schedule.' });
  }
});

// 5. POST ROUTE: Admin adds a new faculty member (QR Generation)
router.post('/add', requireAuth(STAFF), async (req, res) => {
  const { name, programPosition, room, role, schoolId, facultyId } = req.body;
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  try {
    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address (a single "@", e.g. name@gmail.com).' });
    }
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    const newUser = new User({
      name,
      email,
      programPosition,
      room,
      role: role || 'FACULTY',
      schoolId,
      facultyId,
      currentStatus: 'OUT_OF_OFFICE',
    });

    await newUser.save();
    res.json({ message: 'Account provisioned successfully', facultyName: name });
  } catch (error) {
    res.status(500).json({ error: 'Error provisioning account' });
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
  const [official, added, classes, appointments] = await Promise.all([
    ConsultationHours.find({ facultyId }).lean(),
    AddedConsultationHours.find({ facultyId, dayOfWeek: { $gte: 1 } }).lean(),
    Schedule.find({ facultyId }).lean(),
    Appointment.find({ facultyId, status: { $in: ['PENDING', 'APPROVED'] }, date: { $gte: today, $lt: horizon } }).lean(),
  ]);
  return {
    slots: buildSlots({ official, added, classes, appointments, today, nowMs: Date.now(), weeks: 4, leadHours: BOOKING_LEAD_HOURS, flaggedDate }),
    busy: buildBusy({ classes, appointments, today, weeks: 4, flaggedDate }),
  };
}

router.get('/slots/:facultyId', requireAuth(ALL_ROLES), async (req, res) => {
  try {
    const faculty = await User.findOne({ _id: req.params.facultyId, role: 'FACULTY' }).select('flaggedDate');
    if (!faculty) return res.status(404).json({ error: 'Faculty member not found.' });
    const { slots, busy } = await loadSlots(faculty._id, faculty.flaggedDate);
    res.json({ maxPending: MAX_PENDING_PER_SLOT, leadHours: BOOKING_LEAD_HOURS, slots, busy });
  } catch (error) {
    res.status(500).json({ error: 'Server error fetching consultation slots.' });
  }
});

// --- Added consultation hours: extra WEEKLY hours in vacant time, on top of the 4 official weekly hours ---
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

router.get('/added-hours', requireAuth(['FACULTY']), async (req, res) => {
  try {
    res.json(await AddedConsultationHours.find({ facultyId: req.user.userId, dayOfWeek: { $gte: 1 } }).sort({ dayOfWeek: 1, startTime: 1 }));
  } catch (error) {
    res.status(500).json({ error: 'Server error fetching added hours.' });
  }
});

router.post('/added-hours', requireAuth(['FACULTY']), async (req, res) => {
  try {
    const facultyId = req.user.userId;
    const { dayOfWeek, startTime, endTime } = req.body || {};
    const dow = Number(dayOfWeek);
    if (!Number.isInteger(dow) || dow < 1 || dow > 6 || !HHMM.test(String(startTime)) || !HHMM.test(String(endTime))) {
      return res.status(400).json({ error: 'Choose a day, a start time and an end time.' });
    }
    const s = timeToMinutes(startTime), e = timeToMinutes(endTime);
    if (e - s < 30) return res.status(400).json({ error: 'Added hours must be at least 30 minutes long.' });
    if (s < 450 || s > 960 || e > 1080) return res.status(400).json({ error: 'Added hours must start between 7:30 AM and 4:00 PM and end by 6:00 PM.' });

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
    res.json(await AddedConsultationHours.find({ facultyId: req.params.facultyId, dayOfWeek: { $gte: 1 } }).sort({ dayOfWeek: 1, startTime: 1 }).select('dayOfWeek startTime endTime'));
  } catch (error) {
    res.status(500).json({ error: 'Server error fetching added hours.' });
  }
});

router.delete('/added-hours/:id', requireAuth(['FACULTY']), async (req, res) => {
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
    const faculty = await User.findOne({ _id: facultyId, role: 'FACULTY' }).select('flaggedDate');
    if (!faculty) return res.status(404).json({ error: 'Faculty member not found.' });
    const slot = (await loadSlots(faculty._id, faculty.flaggedDate)).slots.find(x => x.date === date && x.start === time);
    if (!slot) {
      return res.status(400).json({ error: 'That time slot is not available. Please choose one from the faculty\'s consultation hours.' });
    }
    if (slot.full) {
      return res.status(400).json({ error: `This slot already has ${MAX_PENDING_PER_SLOT} pending requests. Please choose another slot.` });
    }
    const duration = slot.duration;

    // 4. Anti-Spam Protocol
    const existingPending = await Appointment.findOne({
      facultyId, date, time, studentName, status: 'PENDING'
    });
    
    if (existingPending) {
      return res.status(400).json({ 
        error: `Anti-Spam: You already have a pending request submitted for this exact time.` 
      });
    }

    // 5. Save the pending request
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
    const appointments = await Appointment.find({ facultyId: req.params.facultyId }).sort({ createdAt: -1 });
    res.json(appointments);
  } catch (error) {
    res.status(500).json({ error: 'Server error fetching my appointments' });
  }
});

// 13. PUT ROUTE: Save a Notice
// 13b. PUT ROUTE: Faculty updates their own live status/location (used by FacultyDashboard's status page)
// IN_CONSULTATION: auto-set by cron during consultation hour blocks;
// faculty may also select it manually.
const VALID_STATUSES = ['AVAILABLE', 'IN_CLASS', 'IN_CONSULTATION', 'IN_MEETING', 'ON_BREAK', 'OUT_OF_OFFICE', 'ON_LEAVE', 'ABSENT', 'NOT_UPDATED'];

router.put('/update-status/:id', requireAuth(['FACULTY']), ownerOnly(r => r.params.id), async (req, res) => {
  try {
    const { currentStatus, currentLocation } = req.body;
    if (!VALID_STATUSES.includes(currentStatus)) {
      return res.status(400).json({ error: 'Invalid status value' });
    }

    // isManualOverride: true signals the cron to respect this status
    // until the next scheduled block starts, then auto resumes.
    const updated = await User.findByIdAndUpdate(
      req.params.id,
      {
        currentStatus,
        currentLocation,
        statusUpdatedAt:  new Date(),
        isManualOverride: true,
      },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ error: 'Faculty not found' });
    }

    await StatusHistory.create({
      facultyId: req.params.id,
      status: currentStatus,
      note: currentLocation || '',
    });

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Error updating status' });
  }
});

router.put('/notice/:id', requireAuth(['FACULTY']), ownerOnly(r => r.params.id), async (req, res) => {
  try {
    const updated = await User.findByIdAndUpdate(req.params.id, { noticeMessage: req.body.notice }, { new: true });
    res.json(updated);
  } catch (err) { res.status(500).json({ error: 'Error saving notice' }); }
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

router.post('/appointment/:id/appeal', requireAuth(['STUDENT', 'FACULTY']), async (req, res) => {
  try {
    const apt = await Appointment.findById(req.params.id);
    if (!apt) return res.status(404).json({ error: 'Appointment not found.' });
    const role = req.user.role;
    const mine = role === 'FACULTY'
      ? String(apt.facultyId) === String(req.user.userId)
      : String(apt.studentId) === String(req.user.userId);
    if (!mine) return res.status(403).json({ error: 'Forbidden' });
    if (!APPEALABLE[role].includes(apt.status)) {
      return res.status(400).json({ error: 'Only a missed or cancelled consultation can be appealed.' });
    }
    if (apt.appeal && apt.appeal.status) return res.status(400).json({ error: 'You already submitted an appeal for this consultation.' });
    const reason = String(req.body.reason || '').trim().slice(0, 300);
    if (!reason) return res.status(400).json({ error: 'Please select or enter a reason.' });

    apt.appeal = { by: role, reason, status: 'SUBMITTED', submittedAt: new Date() }; // record only: no accept/reject review
    await apt.save();

    const when = `${fmtDate(apt.date)} at ${fmtTime(apt.time)}`;
    if (role === 'STUDENT') {
      await notify(apt.facultyId, { type: 'APPEAL', title: 'Student appeal', message: `${apt.studentName} appealed the consultation on ${when}. Reason: ${reason}`, appointmentId: apt._id });
    } else {
      const me = await User.findById(req.user.userId).select('name');
      await notifyRole('DEAN', { type: 'APPEAL', title: 'Faculty appeal', message: `${me ? me.name : 'A faculty member'} appealed the consultation with ${apt.studentName} on ${when}. Reason: ${reason}`, appointmentId: apt._id });
    }
    res.json({ message: 'Appeal submitted.', appointment: apt });
  } catch (error) {
    res.status(500).json({ error: 'Server error submitting the appeal.' });
  }
});

// The Dean's list of faculty appeals
router.get('/appeals', requireAuth(['DEAN']), async (req, res) => {
  try {
    const list = await Appointment.find({ 'appeal.by': 'FACULTY' }).populate('facultyId', 'name').sort({ 'appeal.submittedAt': -1 });
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: 'Server error fetching appeals.' });
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

router.post('/consultation-hours', requireAuth(['FACULTY']), async (req, res) => {
  try {
    const { hours } = req.body; // [{ dayOfWeek, startTime, endTime }, ...]
    const facultyId = req.user.userId; // always the logged-in faculty, never trust the body

    // 1. Total must be exactly 4 hours (240 minutes)
    const totalMinutes = hours.reduce((sum, h) => sum + (timeToMinutes(h.endTime) - timeToMinutes(h.startTime)), 0);
    if (totalMinutes !== 240) {
      return res.status(400).json({ error: `Consultation hours must total exactly 4 hours per week. Currently: ${(totalMinutes / 60).toFixed(1)} hours.` });
    }

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

  // Weekday of the specific date, timezone-safe. 1=Mon ... 6=Sat (matches Schedule/ConsultationHours); Sunday=0 matches nothing.
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
router.get('/notes/:facultyId', requireAuth(['FACULTY']), ownerOnly(r => r.params.facultyId), async (req, res) => {
  try {
    const notes = await CalendarNote.find({ facultyId: req.params.facultyId }).sort({ date: 1, startTime: 1 });
    res.json(notes);
  } catch (error) {
    res.status(500).json({ error: 'Server error fetching notes.' });
  }
});

// Create a note
router.post('/notes/:facultyId', requireAuth(['FACULTY']), ownerOnly(r => r.params.facultyId), async (req, res) => {
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
router.put('/notes/:id', requireAuth(['FACULTY']), async (req, res) => {
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
router.delete('/notes/:id', requireAuth(['FACULTY']), async (req, res) => {
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
router.patch('/appointment/:id/complete', requireAuth(['FACULTY']), async (req, res) => {
  try {
    const { casePresented, interventionTaken, remarks } = req.body;
    const apt = await Appointment.findOne({ _id: req.params.id, facultyId: req.user.userId });
    if (!apt) return res.status(404).json({ error: 'Appointment not found.' });
    // MISSED (FACULTY) is what the system sets automatically when an approved consultation was
    // never signed off; the faculty can still log it late if the consultation did take place.
    if (apt.status !== 'APPROVED' && apt.status !== 'MISSED (FACULTY)') {
      return res.status(400).json({ error: 'Only approved consultations can be completed.' });
    }
    if (apt.completedAt) {
      return res.status(400).json({ error: 'This consultation has already been signed off and cannot be edited.' });
    }

    apt.casePresented     = casePresented;
    apt.interventionTaken = interventionTaken;
    apt.remarks           = remarks;
    apt.status            = 'COMPLETED';
    apt.completedAt       = new Date();
    await apt.save();

    await notify(await resolveStudentId(apt), {
      type: 'CONSULTATION_LOGGED',
      title: 'Consultation completed',
      message: `Your consultation on ${fmtDate(apt.date)} was logged and signed off by your instructor.`,
      appointmentId: apt._id,
    });

    res.json({ message: 'Consultation logged and signed off.', appointment: apt });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Faculty cancels an APPROVED consultation (counted as "CANCELLED BY FACULTY" in the reports)
router.patch('/appointment/:id/cancel', requireAuth(['FACULTY']), async (req, res) => {
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
    apt.status = 'CANCELLED BY FACULTY';
    apt.cancelReason = reason;
    await apt.save();

    const faculty = await User.findById(req.user.userId).select('name');
    await notify(await resolveStudentId(apt), {
      type: 'APPOINTMENT_UPDATE',
      title: 'Consultation cancelled by instructor',
      message: `${faculty ? faculty.name : 'Your instructor'} cancelled your consultation on ${fmtDate(apt.date)} at ${fmtTime(apt.time)}.${reason ? ` Reason: ${reason}` : ''}`,
      appointmentId: apt._id,
    });
    res.json({ message: 'Consultation cancelled.', appointment: apt });
  } catch (error) {
    res.status(500).json({ error: 'Server error cancelling consultation.' });
  }
});

// Cancel several appointments at once (panelist rule 3.3). Students cancel their own open requests and
// appointments; faculty cancel approved appointments and decline pending requests. One reason covers all.
// Each appointment is checked on its own; the ones that cannot be cancelled are reported back, not failed.
router.post('/appointments/bulk-cancel', requireAuth(['STUDENT', 'FACULTY']), async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? [...new Set(req.body.ids.map(String))] : [];
    const reason = String(req.body.reason || '').trim().slice(0, 300);
    if (!ids.length) return res.status(400).json({ error: 'Select at least one appointment.' });
    if (ids.length > MAX_BULK) return res.status(400).json({ error: `You can cancel up to ${MAX_BULK} at a time.` });
    if (!reason) return res.status(400).json({ error: 'Please select or enter a reason.' });

    const me = await User.findById(req.user.userId).select('name');
    const role = req.user.role;
    const cancelled = [];
    const skipped = [];
    for (const id of ids) {
      const apt = mongoose.isValidObjectId(id) ? await Appointment.findById(id) : null;
      const d = bulkCancelDecision({ role, userId: req.user.userId, userName: me && me.name, apt, nowMs: Date.now() });
      if (!d.ok) { skipped.push({ id, reason: d.reason }); continue; }

      apt.status = d.newStatus;
      apt.cancelReason = reason;
      await apt.save();
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

// Faculty marks that the student did not show up (counted as "MISSED (STUDENT)")
router.patch('/appointment/:id/no-show', requireAuth(['FACULTY']), async (req, res) => {
  try {
    const apt = await Appointment.findOne({ _id: req.params.id, facultyId: req.user.userId });
    if (!apt) return res.status(404).json({ error: 'Appointment not found.' });
    if (apt.status !== 'APPROVED') {
      return res.status(400).json({ error: 'Only approved consultations can be marked as a no-show.' });
    }
    // Not before the appointment has actually started (Philippine time)
    if (Date.now() < manilaDate(apt.date, apt.time).getTime()) {
      return res.status(400).json({ error: 'This consultation has not started yet.' });
    }
    apt.status = 'MISSED (STUDENT)';
    apt.missedAt = new Date();
    await apt.save();

    await notify(await resolveStudentId(apt), {
      type: 'APPOINTMENT_UPDATE',
      title: 'Consultation missed',
      message: `You did not attend your consultation on ${fmtDate(apt.date)} at ${fmtTime(apt.time)}.`,
      appointmentId: apt._id,
    });
    res.json({ message: 'Marked as student no-show.', appointment: apt });
  } catch (error) {
    res.status(500).json({ error: 'Server error marking no-show.' });
  }
});

// Fetch a faculty member's consultation log (completed entries, oldest first like the paper form)
router.get('/consultation-log/:facultyId', requireAuth(['FACULTY','ADMIN','DEAN']), ownerOrStaff(r => r.params.facultyId), async (req, res) => {
  try {
    const log = await Appointment.find({ 
      facultyId: req.params.facultyId, 
      status: 'COMPLETED' 
    }).sort({ completedAt: 1 });
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


module.exports = router;
