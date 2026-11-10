// Day grouping for the faculty Consultation Log. Pure functions, no imports.

/** The calendar day of a timestamp in Manila time ("YYYY-MM-DD"); '' for old records that have no timestamp. */
export const manilaDay = (iso?: string | null): string =>
  iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }) : '';

export const dayHeading = (iso: string): string =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/**
 * Groups rows by day. Groups are ordered by day (newest first for 'desc', oldest first for 'asc'); rows without a day
 * always come last. Inside a day, rows keep the order of `orderOf` ascending (first one first).
 */
export function groupByDay<T>(rows: T[], dayOf: (r: T) => string, orderOf: (r: T) => string, dir: 'asc' | 'desc'): { day: string; rows: T[] }[] {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const d = dayOf(r);
    if (!map.has(d)) map.set(d, []);
    map.get(d)!.push(r);
  }
  const days = [...map.keys()].sort((a, b) => {
    if (a === b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    return dir === 'asc' ? a.localeCompare(b) : b.localeCompare(a);
  });
  return days.map(day => ({ day, rows: [...map.get(day)!].sort((x, y) => orderOf(x).localeCompare(orderOf(y))) }));
}
