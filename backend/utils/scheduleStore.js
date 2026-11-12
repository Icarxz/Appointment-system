// Mongo-backed store for utils/scheduleSwap.js. Only Schedule and ConsultationHours: added consultation hours, notes and appointments are not touched.
const mongoose = require('mongoose');
const Schedule = require('../models/Schedule');
const ConsultationHours = require('../models/ConsultationHours');

const mongoStore = {
  async load(facultyId) {
    const [classes, hours] = await Promise.all([Schedule.find({ facultyId }).lean(), ConsultationHours.find({ facultyId }).lean()]);
    return { classes, hours };
  },
  // Ids are made here first so a failed insert can be undone exactly (insertMany may stop half way).
  async insert(facultyId, classes, hours) {
    const classDocs = classes.map(c => ({ ...c, facultyId, _id: new mongoose.Types.ObjectId() }));
    const hourDocs = hours.map(h => ({ ...h, facultyId, _id: new mongoose.Types.ObjectId() }));
    const created = { classIds: classDocs.map(d => d._id), hourIds: hourDocs.map(d => d._id) };
    try {
      if (classDocs.length) await Schedule.insertMany(classDocs);
      if (hourDocs.length) await ConsultationHours.insertMany(hourDocs);
    } catch (e) {
      await Schedule.deleteMany({ _id: { $in: created.classIds } }).catch(() => {});
      await ConsultationHours.deleteMany({ _id: { $in: created.hourIds } }).catch(() => {});
      throw e;
    }
    return created;
  },
  async remove({ classIds = [], hourIds = [] }) {
    if (classIds.length) await Schedule.deleteMany({ _id: { $in: classIds } });
    if (hourIds.length) await ConsultationHours.deleteMany({ _id: { $in: hourIds } });
  },
};

module.exports = { mongoStore };
