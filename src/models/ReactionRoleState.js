const mongoose = require('mongoose');

const reactionRoleStateSchema = new mongoose.Schema(
  {
    guildId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    panelChannelId: {
      type: String,
      default: null
    },
    panelMessageId: {
      type: String,
      default: null
    },
    introChannelId: {
      type: String,
      default: null
    },
    introMessageId: {
      type: String,
      default: null
    },
    lastRecoveredAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('ReactionRoleState', reactionRoleStateSchema);