require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const User = require('../models/User');

async function backfillActivatedAt({ apply = false, createdAtIsActivation = false } = {}) {
  if (apply && !createdAtIsActivation) {
    throw new Error('Review the dry run and pass --created-at-is-activation to use createdAt as the legacy fallback.');
  }
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required.');

  await mongoose.connect(process.env.MONGO_URI);
  try {
    const candidates = await User.find({
      accountStatus: { $in: ['ACTIVE', 'RESTRICTED', 'ARCHIVED'] },
      $or: [{ activatedAt: null }, { activatedAt: { $exists: false } }],
    }).select('_id createdAt').lean();
    const usable = candidates.filter(user => user.createdAt instanceof Date && !Number.isNaN(user.createdAt.getTime()));
    console.log(`Accounts eligible for a legacy activation fallback: ${usable.length}.`);
    console.log('The original activation time cannot be reconstructed from current account data; createdAt is only a fallback.');

    if (!apply) {
      console.log('Dry run only. No account data was changed. Review before rerunning with --apply --created-at-is-activation.');
      return;
    }

    if (usable.length) {
      await User.bulkWrite(usable.map(user => ({
        updateOne: {
          filter: { _id: user._id, activatedAt: null },
          update: { $set: { activatedAt: user.createdAt } },
        },
      })));
    }
    console.log(`Backfilled ${usable.length} accounts using createdAt as the explicitly approved fallback.`);
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  backfillActivatedAt({
    apply: process.argv.includes('--apply'),
    createdAtIsActivation: process.argv.includes('--created-at-is-activation'),
  }).catch((error) => {
    console.error('Activation timestamp backfill failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { backfillActivatedAt };
