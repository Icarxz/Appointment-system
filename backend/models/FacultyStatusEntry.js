const mongoose = require('mongoose');
const { MANUAL_STATUSES } = require('../utils/facultyStatus');

// One manual status or advance notice. A notice for next Monday is simply an entry
// whose startAt has not arrived yet; it becomes the status by itself.
const FacultyStatusEntrySchema = new mongoose.Schema({
  facultyId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type:        { type: String, enum: MANUAL_STATUSES, required: true },
  reason:      { type: String, default: '' },
  reasonOther: { type: String, default: '', maxlength: 120 },
  makeUpInfo:  { type: String, default: '', maxlength: 300 },
  location:    { type: String, default: '' }, // LEGACY: kept only so old records still load. The status workflow ignores it.
  startAt:     { type: Date, required: true },
  endAt:       { type: Date, required: true, index: true },
  isNotice:    { type: Boolean, default: false }, // posted from Post a Notice (meeting / leave) rather than set quickly in My Status
  isDemo:      { type: Boolean },
}, { timestamps: true });

module.exports = mongoose.model('FacultyStatusEntry', FacultyStatusEntrySchema);
