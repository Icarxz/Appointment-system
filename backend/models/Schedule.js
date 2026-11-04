const mongoose = require('mongoose');

const ScheduleSchema = new mongoose.Schema({
  facultyId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User',
    required: true 
  },
  subject: { type: String, required: true },
  room: { type: String, required: true },
  dayOfWeek: { type: Number, required: true },
  startTime: { type: String, required: true },
  endTime: { type: String, required: true },
  isDemo: { type: Boolean } // set only by scripts/demoData.js so demo rows can be removed
});

module.exports = mongoose.model('Schedule', ScheduleSchema);