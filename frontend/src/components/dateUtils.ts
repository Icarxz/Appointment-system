// dateUtils.ts — single source of truth for date display across all dashboards.
// Change the format here once and every dashboard updates automatically.
//
// WHY T00:00:00 on date-only strings?
//   "2026-10-09" without a time is parsed as UTC midnight.
//   In Philippines (UTC+8) that shifts the displayed day back by 8 hours.
//   Appending T00:00:00 forces it to be read as LOCAL midnight instead.

const LOCALE = 'en-PH';

/**
 * "YYYY-MM-DD" or any ISO string → "Fri, Oct 9, 2026"
 */
export const formatDate = (val: string | null | undefined): string => {
  if (!val) return '—';
  const iso = val.includes('T') ? val : `${val}T00:00:00`;
  return new Date(iso).toLocaleDateString(LOCALE, {
    weekday: 'short',
    month:   'short',
    day:     'numeric',
    year:    'numeric',
  });
};

/**
 * Full ISO datetime string or Date object → "Fri, Oct 9, 2026, 2:30 PM"
 * Use for completedAt / generated-at timestamps.
 */
export const formatDateTime = (val: string | Date | null | undefined): string => {
  if (!val) return '—';
  return new Date(val).toLocaleString(LOCALE, {
    weekday: 'short',
    month:   'short',
    day:     'numeric',
    year:    'numeric',
    hour:    'numeric',
    minute:  '2-digit',
    hour12:  true,
  });
};

/** "13:20" -> "1:20 PM" */
export const formatTime = (timeStr: string | null | undefined): string => {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  if (Number.isNaN(h)) return timeStr;
  return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};
