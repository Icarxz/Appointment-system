const jwt = require('jsonwebtoken');
const User = require('../models/User');

// A signed-in person whose account was disabled (RESTRICTED) or archived is cut off on their very
// next request, not only when their token expires.
const BLOCKED_STATUSES = ['ARCHIVED', 'RESTRICTED'];

function requireAuth(allowedRoles) {
  return async (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    if (!allowedRoles.includes(decoded.role)) return res.status(403).json({ error: 'Forbidden' });

    try {
      const account = await User.findById(decoded.userId).select('accountStatus role').lean();
      if (!account) return res.status(401).json({ error: 'Account not found' });
      // The Admin changed this person's role after they signed in: the old sign-in no longer counts, they sign in again.
      if (account.role && account.role !== decoded.role) {
        return res.status(401).json({ error: 'Your role was changed. Please sign in again.', code: 'ROLE_CHANGED' });
      }
      if (BLOCKED_STATUSES.includes(account.accountStatus)) {
        return res.status(401).json({ error: 'Your account has been disabled. Please contact the administrator.', code: 'ACCOUNT_DISABLED' });
      }
    } catch {
      return res.status(500).json({ error: 'Server error checking your account' });
    }

    req.user = decoded;
    next();
  };
}

module.exports = { requireAuth };
