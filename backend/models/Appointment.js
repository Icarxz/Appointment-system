const mongoose = require('mongoose');

const AppointmentSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // older records may not have this
  studentName: { type: String, required: true },
  studentSection: { type: String, required: true },
  facultyId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date: { type: String, required: true },
  time: { type: String, required: true },
  requestedTime: { type: String },             // set only when the faculty member approved a different start than the student asked for
  duration: { type: Number, default: 60 },     // consultation length in minutes
  reason: { type: String, required: true },
  status: { type: String, default: 'PENDING' }, // PENDING, APPROVED, REJECTED, COMPLETED, CANCELLED BY STUDENT / BY FACULTY, MISSED (STUDENT) / (FACULTY)
  cancelReason: { type: String, default: '' }, // why the faculty cancelled an approved consultation
  autoRejected: { type: Boolean },             // true when the system rejected an unanswered request at its start time
  missedAt: { type: Date },                    // when it was marked MISSED (STUDENT) / MISSED (FACULTY)
  reminderSent: { type: Boolean, default: false }, // has the 1-hour-before reminder already been sent to faculty?
  studentReminderSent: { type: Boolean, default: false }, // ...and to the student (in-app + email)?

  // An appeal after a missed or cancelled consultation: students appeal to the faculty member,
  // faculty appeal to the Dean. Appeals are a record of the reason only (no review). Older appeals may still carry PENDING/ACCEPTED/REJECTED.
  appeal: {
    by:          { type: String, enum: ['STUDENT', 'FACULTY'] },
    reason:      { type: String },
    status:      { type: String, enum: ['SUBMITTED', 'PENDING', 'ACCEPTED', 'REJECTED'] },
    submittedAt: { type: Date },
    reviewedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt:  { type: Date },
    reviewNote:  { type: String },
  },

  // === Consultation Log fields (VAA-FM-035), filled AFTER the consultation ===
  casePresented:     { type: String },
  interventionTaken: { type: String },
  remarks:           { type: String },
  completedAt:       { type: Date },
  isDemo:            { type: Boolean } // set only on records made by scripts/demoData.js
}, { timestamps: true });

module.exports = mongoose.model('Appointment', AppointmentSchema);
