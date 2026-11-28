const express = require('express');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const RosterEntry = require('../models/RosterEntry');
const { requireAuth } = require('../middleware/auth');
const { decideSignIn, parseList, isProfileComplete, requiresCredentialConfirmation, audienceMismatch, loginNeedsAccount } = require('../utils/signInPolicy');
const { validateId } = require('../utils/idValidator');
const { normalizePersonName } = require('../utils/personName');
const { isApprovedFacultyPosition } = require('../utils/facultyPositions');
const { isProgram, programOfPosition, effectiveProgram } = require('../utils/programs');
const { isEmploymentType } = require('../utils/employment');
const { isValidCohort, cohortLabel } = require('../utils/studentCohort');
const { appendHistoryEvent } = require('../utils/historyEvents');

const router = express.Router();

const googleLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 40,
  message: { error: 'Too many sign-in attempts. Please try again in a few minutes.' }
});

const signToken = (user) =>
  jwt.sign({ userId: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '8h' });

// Same shape the old password login returned, so the dashboards need no changes.
const sessionPayload = (user) => ({
  token: signToken(user),
  _id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  programPosition: user.programPosition || '',
  onboardingComplete: isProfileComplete(user),
  credentialConfirmationRequired: requiresCredentialConfirmation(user),
});

// POST /api/auth/google  { credential }  <- the ID token from Google's sign-in button
router.post('/google', googleLimiter, async (req, res) => {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) return res.status(500).json({ error: 'Google sign-in is not configured on the server.' });
    const { credential, audience } = req.body || {};
    if (!credential) return res.status(400).json({ error: 'Missing Google credential.' });

    let payload;
    try {
      const ticket = await new OAuth2Client(clientId).verifyIdToken({ idToken: credential, audience: clientId });
      payload = ticket.getPayload();
    } catch {
      return res.status(401).json({ error: 'Google sign-in could not be verified. Please try again.' });
    }

    const email = (payload.email || '').toLowerCase();
    const existingUser = await User.findOne({ email });
    const rosterEntry = existingUser ? null : await RosterEntry.findOne({ email });

    const decision = decideSignIn({
      payload,
      allowedDomains: parseList(process.env.ALLOWED_EMAIL_DOMAIN),
      adminEmails: parseList(process.env.ADMIN_EMAILS),
      existingUser,
      rosterRole: rosterEntry?.role || null,
      requireProvisionedAccounts: String(process.env.REQUIRE_PROVISIONED_ACCOUNTS || '').trim().toLowerCase() === 'true'
    });
    if (decision.action === 'DENY') return res.status(403).json({ error: decision.error });
    // Wrong tab? Stop before any account is created or changed.
    const resultingRole = decision.action === 'CREATE' ? decision.role : (decision.promoteTo || existingUser.role);
    const wrongTab = audienceMismatch(audience, resultingRole, decision.action === 'CREATE');
    if (wrongTab) return res.status(403).json({ error: wrongTab });
    const noAccount = loginNeedsAccount(audience, decision.action, resultingRole);
    if (noAccount) return res.status(403).json({ error: noAccount });

    let user = existingUser;
    if (decision.action === 'CREATE') {
      user = await User.create({
        role: decision.role,
        name: payload.name ? normalizePersonName(payload.name) : email,
        email,
        googleSub: payload.sub,
        isVerified: true,
        accountStatus: 'ACTIVE',
        onboardingComplete: false
      });
      await appendHistoryEvent({
        userId: user._id, eventType: 'ACCOUNT_ACTIVATED', actorRole: 'SYSTEM',
        details: { activatedAt: user.activatedAt },
      });
    } else {
      if (user.googleSub && user.googleSub !== payload.sub) {
        return res.status(403).json({ error: 'This account is linked to a different Google account.' });
      }
      let changed = false;
      const previousRole = user.role;
      const previousRoleDetails = {
        schoolId: user.schoolId || '',
        facultyId: user.facultyId || '',
        program: user.program || '',
        programPosition: user.programPosition || '',
        employmentType: user.employmentType || '',
      };
      if (!user.googleSub) { user.googleSub = payload.sub; user.isVerified = true; changed = true; } // link an older account to its Google identity
      if (decision.promoteTo && user.role !== decision.promoteTo) { user.role = decision.promoteTo; changed = true; } // listed in ADMIN_EMAILS
      if (changed) await user.save();
      if (previousRole !== user.role) {
        await appendHistoryEvent({
          userId: user._id, eventType: 'ROLE_CHANGED', actorRole: 'SYSTEM',
          details: { fromRole: previousRole, toRole: user.role, previousRoleDetails },
        });
      }
    }

    res.json(sessionPayload(user));
  } catch (error) {
    console.error('Google sign-in error:', error.message);
    res.status(500).json({ error: 'Sign-in failed. Please try again.' });
  }
});

// GET /api/auth/me — the logged-in person's own profile (never includes the password or tokens).
router.get('/me', requireAuth(['STUDENT', 'FACULTY', 'DEAN', 'ADMIN']), async (req, res) => {
  try {
    const user = await User.findById(req.user.userId)
      .select('name email role gender programPosition program employmentType schoolId facultyId onboardingComplete credentialsConfirmedAt privacyAcceptedAt +avatar');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
      name: user.name, email: user.email, role: user.role, gender: user.gender || '',
      programPosition: user.programPosition || '', schoolId: user.schoolId || '', facultyId: user.facultyId || '',
      program: user.role === 'FACULTY' ? effectiveProgram(user) : '', employmentType: user.employmentType || '',
      privacyAcceptedAt: user.privacyAcceptedAt, profileComplete: isProfileComplete(user), avatar: user.avatar || '',
      credentialConfirmationRequired: requiresCredentialConfirmation(user),
      credentialFieldsLocked: !!user.credentialsConfirmedAt,
    });
  } catch (error) {
    res.status(500).json({ error: 'Could not load your profile.' });
  }
});

// POST /api/auth/onboarding  — first-login details Google can't supply. The ID is mandatory.
// The role comes from the server (roster / ADMIN_EMAILS), never from the request.
router.post('/onboarding', requireAuth(['STUDENT', 'FACULTY', 'DEAN', 'ADMIN']), async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (requiresCredentialConfirmation(user)) {
      return res.status(409).json({ error: 'Review and confirm your account details from the Profile page.' });
    }
    if (isProfileComplete(user)) return res.status(400).json({ error: 'Profile is already complete.' });

    const { gender, programPosition, idValue, privacyAccepted, program } = req.body || {};
    if (privacyAccepted !== true) return res.status(400).json({ error: 'Please accept the Privacy Policy.' });
    // Gender is optional (analytics shows a blank as "Not provided"). When given it must be Male or Female ('Prefer not to say' was retired; old accounts keep it).
    const genderGiven = gender !== undefined && gender !== null && String(gender).trim() !== '';
    if (genderGiven && !['Male', 'Female'].includes(gender)) return res.status(400).json({ error: 'Choose Male or Female, or leave gender blank.' });

    // Admin-provisioned accounts already contain their identity and academic/employment details.
    // Privacy acceptance and optional gender are the only onboarding values these accounts need.
    const provisionedDetailsComplete =
      !!user.programPosition &&
      (user.role === 'STUDENT' ? !!user.schoolId : (['FACULTY', 'DEAN'].includes(user.role) ? !!user.facultyId : user.role === 'ADMIN'));
    if (provisionedDetailsComplete) {
      if (genderGiven) user.gender = gender;
      user.privacyAcceptedAt = new Date();
      user.noIdYet = false;
      user.onboardingComplete = true;
      await user.save();
      await appendHistoryEvent({
        userId: user._id, eventType: 'ACCOUNT_ONBOARDED', actorId: user._id, actorRole: user.role,
        details: { profileFields: genderGiven ? ['gender', 'privacyAcceptedAt'] : ['privacyAcceptedAt'] },
      });
      return res.json(sessionPayload(user));
    }

    if (!programPosition || !String(programPosition).trim()) {
      return res.status(400).json({ error: user.role === 'STUDENT' ? 'Program, year and section are required.' : 'Position is required.' });
    }
    if (user.role !== 'STUDENT' && !isApprovedFacultyPosition(programPosition)) {
      return res.status(400).json({ error: 'Please select one of the approved positions: Faculty, Librarian, Program Head (BS INFO), Program Head (BS COMSCI), Program Head (BLIS), or Dean.' });
    }

    // Faculty also say which program they belong to; a Program Head's is taken from the position. Nobody else has one.
    let facultyProgram = '';
    if (user.role === 'FACULTY') {
      facultyProgram = programOfPosition(String(programPosition).trim()) || (isProgram(program) ? program.trim() : ''); // a head's program comes from the position, whatever the client sent
      if (!facultyProgram) return res.status(400).json({ error: 'Please select your program (BS INFO, BS COMSCI or BLIS).' });
    }

    // Students use the student ID format; faculty and dean use the employee format. Admin has no ID.
    if (user.role !== 'ADMIN') {
      const check = validateId(idValue, user.role === 'STUDENT' ? 'STUDENT' : 'EMPLOYEE');
      if (!check.ok) return res.status(400).json({ error: check.error });
      const field = user.role === 'STUDENT' ? 'schoolId' : 'facultyId';
      const taken = await User.findOne({ [field]: check.id, _id: { $ne: user._id } });
      if (taken) return res.status(409).json({ error: 'That ID is already registered to another account.' });
      user[field] = check.id;
    }

    // Onboarding keeps the name normalized from the school Google account.
    if (genderGiven) user.gender = gender;
    user.programPosition = String(programPosition).trim();
    if (facultyProgram) user.program = facultyProgram;
    user.privacyAcceptedAt = new Date();
    user.noIdYet = false;
    user.onboardingComplete = true;
    await user.save(); // runs the model's validators
    await appendHistoryEvent({
      userId: user._id, eventType: 'ACCOUNT_ONBOARDED', actorId: user._id, actorRole: user.role,
      details: { profileFields: ['programPosition', ...(user.role === 'STUDENT' ? ['schoolId'] : ['facultyId']), 'privacyAcceptedAt'] },
    });
    res.json(sessionPayload(user));
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: 'That ID is already registered to another account.' });
    console.error('Onboarding error:', error.message);
    res.status(500).json({ error: 'Could not save your details.' });
  }
});

// PATCH /api/auth/profile — a user can correct account details before first-login confirmation.
// Once confirmed, only the profile photo remains editable; email and role remain Admin-managed.
// Send only changed fields. avatar: a data URL to set the photo, or null to remove it.
const AVATAR_DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_AVATAR_CHARS = 90000; // ~65 KB of image; the app resizes photos to 256x256 first (and stays under the default 100 KB JSON limit)

router.patch('/profile', requireAuth(['STUDENT', 'FACULTY', 'DEAN']), async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const body = req.body || {};
    const { name, gender, idValue, avatar, program, employmentType, programPosition, year, section } = body;
    const reviewingCredentials = requiresCredentialConfirmation(user);
    const credentialFields = ['name', 'gender', 'idValue', 'program', 'employmentType', 'programPosition', 'year', 'section'];
    const changesCredentials = credentialFields.some(field => body[field] !== undefined);
    if (user.credentialsConfirmedAt && changesCredentials) {
      return res.status(403).json({ error: 'Confirmed account details can no longer be changed. Contact the administrator if a correction is needed.' });
    }

    if (!reviewingCredentials && programPosition !== undefined) {
      return res.status(403).json({ error: 'Academic position can only be corrected before credential confirmation.' });
    }
    if (!reviewingCredentials && user.role === 'STUDENT' && (year !== undefined || section !== undefined)) {
      return res.status(403).json({ error: 'Student cohort can only be corrected before credential confirmation.' });
    }

    if (name !== undefined) {
      const clean = normalizePersonName(name);
      if (clean.length < 2 || clean.length > 100) return res.status(400).json({ error: 'Name must be 2 to 100 characters.' });
      user.name = clean;
    }

    if (gender !== undefined) {
      if (!['Male', 'Female'].includes(gender)) return res.status(400).json({ error: 'Choose Male or Female.' });
      user.gender = gender;
    }

    if (idValue !== undefined) {
      const isStudent = user.role === 'STUDENT';
      const check = validateId(idValue, isStudent ? 'STUDENT' : 'EMPLOYEE');
      if (!check.ok) return res.status(400).json({ error: check.error });
      const field = isStudent ? 'schoolId' : 'facultyId';
      const taken = await User.findOne({ [field]: check.id, _id: { $ne: user._id } }).select('_id');
      if (taken) return res.status(409).json({ error: 'That ID is already registered to another account.' });
      user[field] = check.id;
      user.noIdYet = false;
    }

    if (reviewingCredentials && user.role === 'STUDENT' && (program !== undefined || year !== undefined || section !== undefined)) {
      const cohortProgram = String(program ?? '').trim();
      const cohortYear = String(year ?? '').trim();
      const cohortSection = String(section ?? '').trim().toUpperCase();
      if (!isValidCohort(cohortProgram, cohortYear, cohortSection)) {
        return res.status(400).json({ error: 'Choose a valid program, year and section.' });
      }
      user.programPosition = cohortLabel(cohortProgram, cohortYear, cohortSection);
    }

    if (reviewingCredentials && ['FACULTY', 'DEAN'].includes(user.role) && programPosition !== undefined) {
      const cleanPosition = String(programPosition).trim();
      if (!isApprovedFacultyPosition(cleanPosition)) return res.status(400).json({ error: 'Choose an approved faculty or Dean position.' });
      user.programPosition = cleanPosition;
      const headProgram = programOfPosition(cleanPosition);
      if (headProgram) user.program = headProgram;
    }

    // Faculty also keep their program and employment type. A Program Head's program comes from the position.
    const studentCohortProgram = reviewingCredentials && user.role === 'STUDENT' && program !== undefined && employmentType === undefined;
    if ((program !== undefined || employmentType !== undefined) && !studentCohortProgram) {
      if (user.role !== 'FACULTY') return res.status(400).json({ error: 'Only faculty have a program and an employment type.' });
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

    if (avatar !== undefined) {
      if (avatar === null || avatar === '') {
        user.avatar = undefined; // remove the photo
      } else {
        if (typeof avatar !== 'string' || avatar.length > MAX_AVATAR_CHARS || !AVATAR_DATA_URL.test(avatar)) {
          return res.status(400).json({ error: 'Use a JPEG, PNG or WebP photo (it is resized automatically).' });
        }
        user.avatar = avatar;
      }
    }

    await user.save({ validateModifiedOnly: true });
    const changedFields = credentialFields.filter(field => body[field] !== undefined);
    if (avatar !== undefined) changedFields.push('avatar');
    if (changedFields.length) {
      await appendHistoryEvent({
        userId: user._id, eventType: 'PROFILE_UPDATED', actorId: user._id, actorRole: user.role,
        details: { fields: changedFields },
      });
    }
    res.json({
      message: 'Profile saved.',
      profile: {
        name: user.name, gender: user.gender || '', schoolId: user.schoolId || '', facultyId: user.facultyId || '',
        avatar: user.avatar || '', profileComplete: isProfileComplete(user),
        programPosition: user.programPosition || '',
        program: user.role === 'FACULTY' ? effectiveProgram(user) : '', employmentType: user.employmentType || '',
        credentialConfirmationRequired: requiresCredentialConfirmation(user),
      }
    });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: 'That ID is already registered to another account.' });
    console.error('Profile update error:', error.message);
    res.status(400).json({ error: error.message || 'Could not save your profile.' });
  }
});

router.post('/profile/confirm-credentials', requireAuth(['STUDENT', 'FACULTY', 'DEAN']), async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    if (!requiresCredentialConfirmation(user)) {
      return res.status(409).json({ error: 'This account does not have pending credential confirmation.' });
    }
    if (req.body?.privacyAccepted !== true) return res.status(400).json({ error: 'Please accept the Privacy Policy.' });
    const confirmedName = String(user.name || '').replace(/\s+/g, ' ').trim();
    if (confirmedName.length < 2 || confirmedName.length > 100 || !['Male', 'Female'].includes(user.gender)) {
      return res.status(400).json({ error: 'Please correct your name and choose Male or Female before confirming.' });
    }

    if (user.role === 'STUDENT') {
      const idCheck = validateId(user.schoolId, 'STUDENT');
      const match = String(user.programPosition || '').match(/^(.+)\s+(\d+)([A-Za-z])$/);
      if (!idCheck.ok) return res.status(400).json({ error: idCheck.error });
      if (!match || !isValidCohort(match[1], match[2], match[3].toUpperCase())) {
        return res.status(400).json({ error: 'Please correct your program, year and section before confirming.' });
      }
    } else {
      const idCheck = validateId(user.facultyId, 'EMPLOYEE');
      if (!idCheck.ok) return res.status(400).json({ error: idCheck.error });
      if (!isApprovedFacultyPosition(user.programPosition)) {
        return res.status(400).json({ error: 'Please correct your academic position before confirming.' });
      }
      if (user.role === 'FACULTY') {
        if (user.program && !isProgram(user.program)) return res.status(400).json({ error: 'Please correct your program before confirming.' });
        if (user.employmentType && !isEmploymentType(user.employmentType)) return res.status(400).json({ error: 'Please correct your employment type before confirming.' });
      }
    }

    user.privacyAcceptedAt = new Date();
    user.noIdYet = false;
    user.onboardingComplete = true;
    user.credentialsConfirmedAt = new Date();
    await user.save();
    await appendHistoryEvent({
      userId: user._id, eventType: 'ACCOUNT_DETAILS_CONFIRMED', actorId: user._id, actorRole: user.role,
      details: { confirmedAt: user.credentialsConfirmedAt },
    });
    res.json({
      message: 'Your credentials are confirmed.',
      profile: {
        name: user.name, programPosition: user.programPosition || '',
        profileComplete: isProfileComplete(user), credentialConfirmationRequired: false,
      },
    });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: 'That ID is already registered to another account.' });
    console.error('Credential confirmation error:', error.message);
    res.status(400).json({ error: error.message || 'Could not confirm your credentials.' });
  }
});

module.exports = router;
