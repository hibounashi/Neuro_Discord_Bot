const mongoose = require('mongoose');

const schedulerStateSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    lastProcessedWeekKey: {
      type: String,
      default: null
    },
    lastProcessedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('SchedulerState', schedulerStateSchema);