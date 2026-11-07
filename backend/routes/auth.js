const express = require('express');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const RosterEntry = require('../models/RosterEntry');
const { requireAuth } = require('../middleware/auth');
const { decideSignIn, parseList, isProfileComplete, audienceMismatch } = require('../utils/signInPolicy');
const { validateId } = require('../utils/idValidator');
const { isApprovedFacultyPosition } = require('../utils/facultyPositions');

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
  onboardingComplete: isProfileComplete(user)
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
      rosterRole: rosterEntry?.role || null
    });
    if (decision.action === 'DENY') return res.status(403).json({ error: decision.error });
    // Wrong tab? Stop before any account is created or changed.
    const resultingRole = decision.action === 'CREATE' ? decision.role : (decision.promoteTo || existingUser.role);
    const wrongTab = audienceMismatch(audience, resultingRole, decision.action === 'CREATE');
    if (wrongTab) return res.status(403).json({ error: wrongTab });

    let user = existingUser;
    if (decision.action === 'CREATE') {
      user = await User.create({
        role: decision.role,
        name: payload.name || email,
        email,
        googleSub: payload.sub,
        isVerified: true,
        accountStatus: 'ACTIVE',
        onboardingComplete: false
      });
    } else {
      if (user.googleSub && user.googleSub !== payload.sub) {
        return res.status(403).json({ error: 'This account is linked to a different Google account.' });
      }
      let changed = false;
      if (!user.googleSub) { user.googleSub = payload.sub; user.isVerified = true; changed = true; } // link an older account to its Google identity
      if (decision.promoteTo && user.role !== decision.promoteTo) { user.role = decision.promoteTo; changed = true; } // listed in ADMIN_EMAILS
      if (changed) await user.save();
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
      .select('name email role gender programPosition schoolId facultyId onboardingComplete privacyAcceptedAt');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
      name: user.name, email: user.email, role: user.role, gender: user.gender || '',
      programPosition: user.programPosition || '', schoolId: user.schoolId || '', facultyId: user.facultyId || '',
      privacyAcceptedAt: user.privacyAcceptedAt, profileComplete: isProfileComplete(user),
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
    if (isProfileComplete(user)) return res.status(400).json({ error: 'Profile is already complete.' });

    const { gender, programPosition, idValue, privacyAccepted } = req.body || {};
    if (privacyAccepted !== true) return res.status(400).json({ error: 'Please accept the Privacy Policy.' });
    if (!['Male', 'Female', 'Prefer not to say'].includes(gender)) return res.status(400).json({ error: 'Gender is required.' });
    if (!programPosition || !String(programPosition).trim()) {
      return res.status(400).json({ error: user.role === 'STUDENT' ? 'Program, year and section are required.' : 'Position is required.' });
    }
    if (user.role !== 'STUDENT' && !isApprovedFacultyPosition(programPosition)) {
      return res.status(400).json({ error: 'Please select one of the approved positions: Faculty, Librarian, Program Head (BS INFO), Program Head (BS COMSCI), Program Head (BLIS), or Dean.' });
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

    // The name stays as it came from the school Google account.
    user.gender = gender;
    user.programPosition = String(programPosition).trim();
    user.privacyAcceptedAt = new Date();
    user.noIdYet = false;
    user.onboardingComplete = true;
    await user.save(); // runs the model's validators
    res.json(sessionPayload(user));
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: 'That ID is already registered to another account.' });
    console.error('Onboarding error:', error.message);
    res.status(500).json({ error: 'Could not save your details.' });
  }
});

module.exports = router;
