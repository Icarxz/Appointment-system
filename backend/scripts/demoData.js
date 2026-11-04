// CHECKING-ONLY demo data for the analytics reports. NEVER for the defense database.
//
//   DEMO_MONGO_URI="mongodb+srv://.../ccis_demo" node scripts/demoData.js add
//   DEMO_MONGO_URI="mongodb+srv://.../ccis_demo" node scripts/demoData.js remove
//
// Safety rules (the script refuses to run if any is broken):
//   - it reads DEMO_MONGO_URI, never MONGO_URI, and the two must differ;
//   - the database name in the URI must contain "demo";
//   - it only ever adds records flagged isDemo and removes only records flagged isDemo.
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Appointment = require('../models/Appointment');
const ConsultationHours = require('../models/ConsultationHours');
const Schedule = require('../models/Schedule');
const { buildDemoData } = require('../utils/demoData');
const { manilaNow } = require('../utils/manilaTime');

function dbNameOf(uri) {
  try { return decodeURIComponent(new URL(uri).pathname.replace(/^\//, '')); } catch { return ''; }
}

async function main() {
  const mode = process.argv[2];
  const uri = process.env.DEMO_MONGO_URI;
  if (!['add', 'remove'].includes(mode)) throw new Error('Usage: node scripts/demoData.js add|remove');
  if (!uri) throw new Error('Set DEMO_MONGO_URI to a SEPARATE demo database (its name must contain "demo").');
  if (uri === process.env.MONGO_URI) throw new Error('DEMO_MONGO_URI is the same as MONGO_URI. Refusing to touch the real database.');
  if (!/demo/i.test(dbNameOf(uri))) throw new Error('The database name must contain "demo" (e.g. ccis_demo). Refusing.');

  await mongoose.connect(uri);
  console.log(`Connected to database "${mongoose.connection.name}".`);

  if (mode === 'remove') {
    const [a, h, c, u] = [await Appointment.deleteMany({ isDemo: true }), await ConsultationHours.deleteMany({ isDemo: true }), await Schedule.deleteMany({ isDemo: true }), await User.deleteMany({ isDemo: true })];
    console.log(`Removed ${a.deletedCount} appointments, ${h.deletedCount} consultation-hour rows, ${c.deletedCount} class rows, ${u.deletedCount} users (demo only).`);
    return;
  }

  if (await User.countDocuments({ isDemo: true })) throw new Error('Demo data is already there. Run "remove" first.');
  const data = buildDemoData({ today: manilaNow().dateStr });
  const base = { isDemo: true, accountStatus: 'ACTIVE', isVerified: true, onboardingComplete: true, privacyAcceptedAt: new Date() };

  const facultyDocs = await User.insertMany(data.faculty.map(f => ({ ...base, role: 'FACULTY', name: f.name, email: f.email, facultyId: f.facultyId, programPosition: 'Instructor', gender: 'Prefer not to say' })));
  const studentDocs = await User.insertMany(data.students.map(s => ({ ...base, role: 'STUDENT', name: s.name, email: s.email, schoolId: s.schoolId, programPosition: s.programPosition, gender: s.gender })));
  const fId = Object.fromEntries(data.faculty.map((f, i) => [f.key, facultyDocs[i]._id]));
  const sDoc = Object.fromEntries(data.students.map((s, i) => [s.key, studentDocs[i]]));

  await ConsultationHours.insertMany(data.hours.map(h => ({ isDemo: true, facultyId: fId[h.facultyKey], dayOfWeek: h.dayOfWeek, startTime: h.startTime, endTime: h.endTime })));
  await Schedule.insertMany(data.classes.map(c => ({ isDemo: true, facultyId: fId[c.facultyKey], subject: c.subject, room: c.room, dayOfWeek: c.dayOfWeek, startTime: c.startTime, endTime: c.endTime })));
  await Appointment.insertMany(data.appointments.map(a => ({
    isDemo: true, studentId: sDoc[a.studentKey]._id, studentName: sDoc[a.studentKey].name, studentSection: sDoc[a.studentKey].programPosition,
    facultyId: fId[a.facultyKey], date: a.date, time: a.time, duration: a.duration, reason: a.reason, status: a.status,
    ...(a.appeal ? { appeal: { ...a.appeal, submittedAt: new Date() } } : {}),
  })));
  console.log(`Added ${facultyDocs.length} faculty, ${studentDocs.length} students, ${data.hours.length} consultation-hour rows, ${data.classes.length} class rows, ${data.appointments.length} appointments (all flagged isDemo).`);
}

main().catch(e => { console.error('Stopped:', e.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
