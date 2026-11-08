// When a consultation counts as ended or missed. Mirrors backend/utils/consultationEnd.js, which is the real check:
// the buttons here only hint at what the server will accept. All dates "YYYY-MM-DD" and times "HH:MM" are Manila time.

export const MISSED_AFTER_START_HOURS = 2;
const startMs = (a: { date: string; time: string }) => new Date(`${a.date}T${a.time}:00+08:00`).getTime();

/** The moment the consultation ends (start + length, 60 minutes when unknown). */
export const endMs = (a: { date: string; time: string; duration?: number }) => startMs(a) + (a.duration || 60) * 60000;
/** From this moment "Mark Missed" is allowed (2 hours after the start). */
export const missedFromMs = (a: { date: string; time: string }) => startMs(a) + MISSED_AFTER_START_HOURS * 3600000;

export const hasEnded = (a: { date: string; time: string; duration?: number }, now = Date.now()) => now >= endMs(a);
export const canMarkMissed = (a: { date: string; time: string }, now = Date.now()) => now >= missedFromMs(a);

const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila' });
/** "Available when the consultation ends at 3:00 PM" */
export const endHint = (a: { date: string; time: string; duration?: number }) => `Available when the consultation ends at ${clock(endMs(a))}`;
export const missedHint = (a: { date: string; time: string }) => `Available from ${clock(missedFromMs(a))} (2 hours after the start)`;
