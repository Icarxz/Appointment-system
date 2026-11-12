const mongoose = require('mongoose');

// One confirmed Faculty Schedule PDF import: who did it, what the file was, exactly what was applied and what it replaced.
// The scanned PDF itself is NOT stored (it carries signatures); only its SHA-256 hash and the reviewed rows are.
const Row = { _id: false, dayOfWeek: Number, startTime: String, endTime: String, subject: String, room: String };
const Hour = { _id: false, dayOfWeek: Number, startTime: String, endTime: String };

const ScheduleImportSchema = new mongoose.Schema({
  facultyId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  uploaderRole: { type: String, enum: ['FACULTY', 'ADMIN'], required: true },
  fileHash: { type: String, default: '' },
  parserVersion: { type: String, default: '' },
  term: { type: String, default: '' },
  academicYear: { type: String, default: '' },
  effectivityDate: { type: String, required: true }, // YYYY-MM-DD, Manila calendar date
  identityConfirmedByReviewer: { type: Boolean, default: false },
  classes: [Row],
  consultationHours: [Hour],
  warnings: [{ _id: false, code: String, message: String }],
  baseFingerprint: { type: String, default: '' },      // schedule the reviewer saw when previewing
  previousSnapshot: { classes: [Row], hours: [Hour] }, // what this import replaced (set when it is applied)
  status: { type: String, enum: ['SCHEDULED', 'APPLYING', 'ACTIVE', 'SUPERSEDED', 'ROLLED_BACK', 'CANCELLED', 'FAILED'], required: true, index: true },
  failureReason: { type: String, default: '' },
  confirmedAt: { type: Date, default: Date.now },
  activatedAt: { type: Date },
}, { timestamps: true });

module.exports = mongoose.model('ScheduleImport', ScheduleImportSchema);
