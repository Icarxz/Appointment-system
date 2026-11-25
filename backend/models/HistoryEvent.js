const mongoose = require('mongoose');

const HistoryEventSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, immutable: true },
  actorRole: { type: String, default: 'SYSTEM', immutable: true },
  eventType: { type: String, required: true, immutable: true },
  occurredAt: { type: Date, default: Date.now, immutable: true },
  details: { type: mongoose.Schema.Types.Mixed, default: {}, immutable: true },
}, { versionKey: false });

HistoryEventSchema.index({ userId: 1, occurredAt: -1 });
HistoryEventSchema.pre('save', function () {
  if (!this.isNew) throw new Error('History events are append-only.');
});
['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete'].forEach((operation) => {
  HistoryEventSchema.pre(operation, function () {
    throw new Error('History events are append-only.');
  });
});
HistoryEventSchema.pre('deleteOne', { document: true, query: false }, function () {
  throw new Error('History events are append-only.');
});

module.exports = mongoose.model('HistoryEvent', HistoryEventSchema);
