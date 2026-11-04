// Pure generator for CHECKING-ONLY demo data (see scripts/demoData.js). No database access here.
// Deterministic: the same seed gives the same data, so test runs are repeatable.
// Faculty come from utils/demoSchedules.js (real class loads and consultation hours), so demo appointments never
// land on a class and the calendar shows the same hours a real student would see.

const { DEMO_FACULTY_SCHEDULES } = require('./demoSchedules');

const PROGRAMS = { 'BS INFO': { 1: 'ABCDE', 2: 'ABCD', 3: 'ABCD', 4: 'ABCD' }, 'BS COMSCI': { 1: 'AB', 2: 'AB', 3: 'AB', 4: 'AB' }, BLIS: { 1: 'AB', 2: 'AB', 3: 'AB', 4: 'AB' } };
const PURPOSES = ['Academic advising', 'Grade inquiry', 'Capstone / thesis consultation', 'Project guidance', 'Enrollment concerns', 'Personal concern'];
const STUDENT_APPEAL_REASONS = ['Medical / Health Emergency', 'Family Emergency', 'Academic Conflict', 'Transportation / Weather Issues', 'Connectivity / Technical Problem'];
const FIRST = ['Ana', 'Ben', 'Carla', 'Dan', 'Ella', 'Finn', 'Gina', 'Hugo', 'Iris', 'Jon', 'Kara', 'Leo', 'Mia', 'Nico', 'Ola', 'Paz', 'Quin', 'Rey', 'Sol', 'Tess', 'Uma', 'Vic', 'Wen', 'Xia'];
const LAST = ['Demo', 'Sample', 'Test'];

function rngFrom(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (rng, list) => list[Math.floor(rng() * list.length)];
const pad = (n, w) => String(n).padStart(w, '0');
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dowOf = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();

// today: "YYYY-MM-DD" (Manila). Returns plain objects; the script assigns real ids when inserting.
function buildDemoData({ today, seed = 2026, weeks = 8 }) {
  const rng = rngFrom(seed);
  const faculty = DEMO_FACULTY_SCHEDULES.map((f, i) => ({
    key: f.key, name: `Demo ${f.label}`, email: `demo.${f.key}@demo.invalid`, facultyId: `2025S-9${pad(i + 1, 4)}`,
  }));
  const hours = DEMO_FACULTY_SCHEDULES.flatMap(f => f.hours.map(h => ({ facultyKey: f.key, ...h })));
  const classes = DEMO_FACULTY_SCHEDULES.flatMap(f => f.classes.map(c => ({ facultyKey: f.key, ...c })));

  // Whole hours (8 AM to 4 PM starts) on a weekday where the faculty has no class, consultation hours first.
  const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const freeHours = (key, dow) => {
    const sched = DEMO_FACULTY_SCHEDULES.find(f => f.key === key);
    const busy = sched.classes.filter(c => c.dayOfWeek === dow);
    const consult = sched.hours.filter(h => h.dayOfWeek === dow);
    const free = [];
    for (let h = 8; h <= 16; h++) {
      if (busy.some(c => toMin(c.startTime) < (h + 1) * 60 && h * 60 < toMin(c.endTime))) continue;
      const inConsult = consult.some(c => toMin(c.startTime) <= h * 60 && (h + 1) * 60 <= toMin(c.endTime));
      free.push({ hour: h, inConsult });
    }
    const preferred = free.filter(x => x.inConsult);
    return (preferred.length ? preferred : free).map(x => x.hour);
  };

  const students = [];
  let n = 0;
  for (const [program, years] of Object.entries(PROGRAMS)) {
    for (const [year, sections] of Object.entries(years)) {
      for (const sec of sections.slice(0, 2)) { // two demo students per cohort section keeps counts readable
        n += 1;
        students.push({
          key: `S${n}`, name: `${pick(rng, FIRST)} ${pick(rng, LAST)} ${n}`, email: `demo.student${n}@demo.invalid`,
          schoolId: `2025-S9${pad(n, 4)}`, programPosition: `${program} ${year}${sec}`, gender: pick(rng, ['Male', 'Female', 'Prefer not to say']),
        });
      }
    }
  }

  const appointments = [];
  const start = addDays(today, -weeks * 7);
  for (let day = start; day < today; day = addDays(day, 1)) {
    const dow = dowOf(day);
    if (dow === 0 || dow === 6) continue; // demo appointments are Monday to Friday only
    const count = 1 + Math.floor(rng() * 4); // 1..4 per day
    for (let k = 0; k < count; k++) {
      const f = pick(rng, faculty), s = pick(rng, students);
      const open = freeHours(f.key, dow);
      if (!open.length) continue;
      const hour = pick(rng, open);
      const roll = rng();
      const status = roll < 0.55 ? 'COMPLETED' : roll < 0.72 ? 'MISSED (STUDENT)' : roll < 0.78 ? 'MISSED (FACULTY)' : roll < 0.86 ? 'CANCELLED BY STUDENT' : roll < 0.92 ? 'CANCELLED BY FACULTY' : 'REJECTED';
      const apt = { facultyKey: f.key, studentKey: s.key, date: day, time: `${pad(hour, 2)}:00`, duration: 60, reason: pick(rng, PURPOSES), status };
      if (status === 'MISSED (STUDENT)' && rng() < 0.6) {
        apt.appeal = { by: 'STUDENT', reason: rng() < 0.12 ? 'Some other personal matter' : pick(rng, STUDENT_APPEAL_REASONS), status: 'SUBMITTED' };
      }
      appointments.push(apt);
    }
  }
  return { faculty, hours, classes, students, appointments };
}

module.exports = { buildDemoData, PROGRAMS };
