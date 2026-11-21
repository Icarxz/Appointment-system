// Pure sign-in rules (no database, no network) so they can be unit-tested.

// Comma-separated list from an env value. Tolerates stray quotes or <angle brackets> around entries.
const parseList = (v) => (v || '').split(',').map(s => s.replace(/[<>"']/g, '').trim().toLowerCase()).filter(Boolean);

// Google's verified ID-token payload + config + what we already know -> what to do.
// payload: { email, email_verified, hd }   existingUser: User doc or null   rosterRole: string|null
function decideSignIn({ payload, allowedDomains, adminEmails, existingUser, rosterRole, requireProvisionedAccounts = false }) {
  const email = (payload?.email || '').toLowerCase();
  if (!email || payload.email_verified !== true) {
    return { action: 'DENY', error: 'Your Google email is not verified.' };
  }
  const domain = email.split('@')[1];
  if (!allowedDomains.length || !allowedDomains.includes(domain)) {
    return { action: 'DENY', error: 'Please sign in with your school Google account.' };
  }
  if (existingUser) {
    if (['ARCHIVED', 'RESTRICTED', 'PENDING_APPROVAL'].includes(existingUser.accountStatus)) {
      return { action: 'DENY', error: 'This account is not active. Please contact the administrator.' };
    }
    // An address listed in ADMIN_EMAILS is always an Admin, even if the account was created earlier as something else.
    if (adminEmails.includes(email) && existingUser.role !== 'ADMIN') return { action: 'LOGIN', promoteTo: 'ADMIN' };
    return { action: 'LOGIN' };
  }
  const role = adminEmails.includes(email) ? 'ADMIN' : (rosterRole || null);
  if (requireProvisionedAccounts) {
    if (!role) {
      return { action: 'DENY', error: 'No account was found for this email. Please contact the System Administrator to create your account.' };
    }
  }
  return { action: 'CREATE', role: role || 'STUDENT' };
}

// A profile is complete once onboarding is done AND a student has an ID on file.
// (Older accounts created with "no ID yet" stay read-only until an Admin adds the ID.)
function isProfileComplete(user) {
  if (user.onboardingComplete === false) return false;
  if (user.role === 'STUDENT' && !user.schoolId) return false;
  return true;
}

// The sign-in screens say which door the person used. The server still decides the role (from the roster / ADMIN_EMAILS /
// the stored account); the audience only stops someone using the wrong door.
//   'STUDENT' : older Student sign-up client.   'STAFF' : older Faculty/Dean sign-in client.
//   'LOGIN'   : Log in: existing accounts only, nobody is created here (see loginNeedsAccount).
//   undefined : older clients, no check.
// Returns an error text or null.
function audienceMismatch(audience, role, isNewAccount = false) {
  if (audience !== 'STUDENT' && audience !== 'STAFF') return null;
  const isStaff = role === 'FACULTY' || role === 'DEAN' || role === 'ADMIN';
  if (audience === 'STUDENT' && isStaff) {
    return 'This is a faculty/staff account. Please go back and choose Faculty.';
  }
  if (audience === 'STAFF' && !isStaff) {
    return isNewAccount
      ? 'This email is not registered as faculty or staff. Please contact the System Administrator to create your account or assist your log in credentials. Students: go back and choose Student.'
      : 'This is a student account. Please go back and choose Student.';
  }
  return null;
}

// Log in never creates an account for a student. A first sign-in is allowed only when the roster / ADMIN_EMAILS already
// names the person as faculty, Dean or Admin (that is the administrator's way of creating their account).
function loginNeedsAccount(audience, action, role) {
  if (audience !== 'LOGIN') return null;
  if (action === 'CREATE' && role === 'STUDENT') {
    return 'No account was found for this email. New students: close this and choose Sign up. Faculty: please contact the System Administrator to create your account.';
  }
  return null;
}

module.exports = { decideSignIn, parseList, isProfileComplete, audienceMismatch, loginNeedsAccount };
