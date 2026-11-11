const mongoose = require('mongoose');

// Extra WEEKLY consultation hours a faculty member adds in their vacant time, on top of the 4 official
// weekly hours (which live in ConsultationHours and are not affected by these). Recurs every week.
const AddedConsultationHoursSchema = new mongoose.Schema({
  facultyId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  dayOfWeek: { type: Number, required: true, min: 1, max: 5 }, // 1=Mon ... 5=Fri: no weekend consultation hours
  startTime: { type: String, required: true }, // "13:00"
  endTime:   { type: String, required: true }  // "15:00"
}, { timestamps: true });

AddedConsultationHoursSchema.index({ facultyId: 1, dayOfWeek: 1 });

module.exports = mongoose.model('AddedConsultationHours', AddedConsultationHoursSchema);
