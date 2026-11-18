// Links that notifications (and their email copies) point to.
//
// SECURITY: a link is NEVER built from anything a user typed. The server picks the dashboard from the
// recipient's role and the page from a fixed list; the only variable part is an appointment id, and it
// must be exactly 24 hex characters. isSafeLink() re-checks the whole string against the same allowlist
// (it is used when saving, when putting a link in an email, and mirrored on the client), so an
// "open redirect" to another website is impossible: every link is a path on this app, nothing else.

const ROOTS = {
  STUDENT: '/student-dashboard',
  FACULTY: '/faculty-dashboard',
  DEAN:    '/dean-dashboard',
  ADMIN:   '/admin-dashboard',
};

// Pages a link may open, per role (the same names the dashboards use for ?page=).
const PAGES = {
  STUDENT: ['home', 'appointments', 'requests', 'profile'],
  FACULTY: ['status', 'schedule', 'requests', 'log', 'analytics', 'profile'],
  DEAN:    ['broadcast', 'roster', 'reports', 'records', 'requests', 'log', 'analytics'], // the old 'appeals' page was removed
  ADMIN:   [], // the Admin dashboard has no mailbox, so there is nothing to open
};

// Where an appointment's details drawer opens for each role. The drawer itself is the same everywhere.
// A Dean opens his own request page (when he takes consultations) or the records table; both show the same details drawer.
const APPOINTMENT_PAGE = { STUDENT: 'requests', FACULTY: 'requests', DEAN: 'records' };

const OBJECT_ID = /^[0-9a-f]{24}$/; // ObjectId strings are always lower-case hex
const isObjectIdHex = (v) => typeof v === 'string' && OBJECT_ID.test(v);

// Returns a safe path such as "/student-dashboard?page=requests&apt=<id>", or null when there is nothing
// sensible to link to. `appointmentId` may be an ObjectId or a string.
function buildLink(role, { appointmentId, page } = {}) {
  const root = ROOTS[role];
  if (!root) return null;
  if (appointmentId) {
    const id = String(appointmentId);
    const pg = APPOINTMENT_PAGE[role];
    if (!pg || !isObjectIdHex(id)) return null;
    return `${root}?page=${pg}&apt=${id}`;
  }
  if (page && PAGES[role].includes(page)) return `${root}?page=${page}`;
  return null;
}

const LINK_SHAPE = /^\/(student|faculty|dean|admin)-dashboard(?:\?page=([a-z]+)(?:&apt=([0-9a-f]{24}))?)?$/;

// True only for a link this module could have built. Anything else (another site, "//evil.com",
// "javascript:", extra parameters, wrong page for the dashboard, a long or odd id) is rejected.
function isSafeLink(link) {
  if (typeof link !== 'string' || link.length > 120) return false;
  const m = LINK_SHAPE.exec(link);
  if (!m) return false;
  const role = m[1].toUpperCase();
  const page = m[2];
  const apt = m[3];
  if (page === undefined) return !apt;           // bare dashboard path
  if (apt) return APPOINTMENT_PAGE[role] === page;
  return PAGES[role].includes(page);
}

// First entry of FRONTEND_URL (it may be a comma-separated list), without a trailing slash.
const appUrl = () => (process.env.FRONTEND_URL || 'http://localhost:5173').split(',')[0].trim().replace(/\/+$/, '');

// Full address for an email: the app's address plus a safe link. Falls back to the app's home page.
const emailLink = (link) => (isSafeLink(link) ? `${appUrl()}${link}` : appUrl());

module.exports = { buildLink, isSafeLink, emailLink, appUrl, isObjectIdHex, ROOTS, PAGES, APPOINTMENT_PAGE };
