// One-time migration: standardize existing faculty/dean programPosition values.
// Safe by default: preview changes only. Apply with: node scripts/migrateFacultyPositions.js --apply
// Run from the backend folder after configuring MONGO_URI in backend/.env.
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

const APPROVED = [
  'Faculty',
  'Librarian',
  'Program Head (BS INFO)',
  'Program Head (BS COMSCI)',
  'Program Head (BLIS)',
  'Dean',
];

function normalizePosition(value, role) {
  const raw = String(value || '').trim();
  const text = raw.toLowerCase().replace(/[._-]+/g, ' ').replace(/\\s+/g, ' ');

  // Role is authoritative for Dean accounts.
  if (role === 'DEAN' || /\\bdean\\b/.test(text)) return 'Dean';
  if (/\\blibrarian\\b|library librarian/.test(text)) return 'Librarian';

  if (/program\\s*head|program\\s*chair|chairperson/.test(text)) {
    if (/\\bblis\\b|library and information science/.test(text)) return 'Program Head (BLIS)';
    if (/\\b(bs\\s*)?comsci\\b|\\b(computer science|bscs)\\b/.test(text)) return 'Program Head (BS COMSCI)';
    if (/\\b(bs\\s*)?info\\b|\\bbsit\\b|information technology/.test(text)) return 'Program Head (BS INFO)';
    return null; // Program Head without a recognizable program: do not guess.
  }

  if (/\\bfaculty\\b|\\binstructor\\b|\\bteacher\\b/.test(text)) return 'Faculty';
  if (APPROVED.includes(raw)) return raw;
  return null;
}

(async () => {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is missing. Configure backend/.env first.');
  }

  const apply = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGO_URI);

  try {
    const users = await User.find({ role: { $in: ['FACULTY', 'DEAN'] } })
      .select('_id name email role programPosition')
      .lean();

    const changes = [];
    const skipped = [];

    for (const user of users) {
      const current = String(user.programPosition || '').trim();
      const normalized = normalizePosition(current, user.role);

      if (!normalized) {
        skipped.push({ name: user.name, position: current || '(empty)' });
      } else if (normalized !== current) {
        changes.push({ user, from: current || '(empty)', to: normalized });
      }
    }

    console.log(apply ? 'APPLY MODE' : 'DRY RUN — no database records changed');
    console.log(`Faculty/dean accounts scanned: ${users.length}`);
    console.log(`Positions to update: ${changes.length}`);
    for (const item of changes) {
      console.log(`  ${item.user.name} [${item.user.role}]: "${item.from}" -> "${item.to}"`);
    }

    console.log(`Unrecognized positions left unchanged: ${skipped.length}`);
    for (const item of skipped) {
      console.log(`  ${item.name}: "${item.position}"`);
    }

    if (apply && changes.length) {
      const operations = changes.map(({ user, to }) => ({
        updateOne: {
          filter: { _id: user._id, role: user.role, programPosition: user.programPosition },
          update: { $set: { programPosition: to } },
        },
      }));
      const result = await User.bulkWrite(operations, { ordered: false });
      console.log(`Migration complete. Modified ${result.modifiedCount} account(s).`);
    } else if (apply) {
      console.log('No updates were necessary.');
    } else {
      console.log('Review the preview, then rerun with --apply to save the changes.');
    }
  } finally {
    await mongoose.disconnect();
  }
})().catch(error => {
  console.error('Faculty position migration failed:', error);
  process.exitCode = 1;
});
