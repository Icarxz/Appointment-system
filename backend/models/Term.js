const mongoose = require('mongoose');

const TermSchema = new mongoose.Schema({
  academicYear: { type: String, required: true },
  name: { type: String, required: true, trim: true, maxlength: 60 },
  startDate: { type: String, required: true },
  endDate: { type: String, required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
}, { timestamps: true });

module.exports = mongoose.model('Term', TermSchema);
