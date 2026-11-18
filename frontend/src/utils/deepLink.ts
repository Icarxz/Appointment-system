// Client-side twin of backend/utils/notifyLink.js. The server builds every notification link, but the
// browser never trusts a link just because it came from the server (or from sessionStorage): it only
// navigates to a path that matches this allowlist exactly, so a link can never leave this app.
// Keep the page lists in step with the backend file (its tests cover the same cases).

const PAGES: Record<string, readonly string[]> = {
  student: ['home', 'appointments', 'requests', 'profile'],
  faculty: ['status', 'schedule', 'requests', 'log', 'analytics', 'profile'],
  dean:    ['broadcast', 'roster', 'reports', 'records', 'requests', 'log', 'analytics', 'schedule', 'hours', 'status'], // 'appeals' (Faculty Reasons) was removed
  admin:   [],
};

// The page behind the appointment details drawer, per dashboard.
const APPOINTMENT_PAGE: Record<string, string> = { student: 'requests', faculty: 'requests', dean: 'requests' };

const SHAPE = /^\/(student|faculty|dean|admin)-dashboard(?:\?page=([a-z]+)(?:&apt=([0-9a-f]{24}))?)?$/;

/** An appointment id as the server writes it: exactly 24 lower-case hex characters. */
export const APT_ID = /^[0-9a-f]{24}$/;

/** True only for an allowlisted path on this app, e.g. "/student-dashboard?page=requests&apt=<id>". */
export function isSafeAppLink(link: unknown): link is string {
  if (typeof link !== 'string' || link.length > 120) return false;
  const m = SHAPE.exec(link);
  if (!m) return false;
  const [, who, page, apt] = m;
  if (page === undefined) return true;
  if (apt) return APPOINTMENT_PAGE[who] === page;
  return PAGES[who].includes(page);
}

/** True when the (already safe) link is on the dashboard that belongs to this role, e.g. STUDENT -> /student-dashboard. */
export const linkMatchesRole = (link: string, role: string | null): boolean =>
  !!role && link.startsWith(`/${role.toLowerCase()}-dashboard`);
