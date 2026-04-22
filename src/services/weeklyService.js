const WeeklyStats = require('../models/WeeklyStats');
const { config } = require('../config');
const { weeklyRoles } = require('../config/roles');
const { getIsoWeekKey, getNextIsoWeekKey } = require('../utils/dateUtils');
const roleLogService = require('./roleLogService');
const logger = require('../utils/logger');

class WeeklyService {
  // Weekly metrics are stored by ISO week key for stable rotation and leaderboards.
  getCurrentWeekKey() {
    return getIsoWeekKey(new Date());
  }

  getPreviousWeekKey(date = new Date()) {
    const previous = new Date(date);
    previous.setUTCDate(previous.getUTCDate() - 7);
    return getIsoWeekKey(previous);
  }

  getNextWeekKey(weekKey) {
    return getNextIsoWeekKey(weekKey);
  }

  async incrementStats(payload) {
    const {
      guildId,
      userId,
      xpDelta = 0,
      messageDelta = 0,
      weekKey = this.getCurrentWeekKey()
    } = payload;

    if (xpDelta === 0 && messageDelta === 0) {
      return;
    }

    await WeeklyStats.findOneAndUpdate(
      { guildId, userId, weekKey },
      {
        $setOnInsert: { guildId, userId, weekKey },
        $inc: {
          xpGained: xpDelta,
          messageCount: messageDelta
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  async getWeeklyTop(guildId, weekKey = this.getCurrentWeekKey(), limit = config.xp.weeklyTopSize) {
    const [xpTop, messageTop] = await Promise.all([
      WeeklyStats.find({ guildId, weekKey })
        .sort({ xpGained: -1, messageCount: -1 })
        .limit(limit)
        .lean(),
      WeeklyStats.find({ guildId, weekKey })
        .sort({ messageCount: -1, xpGained: -1 })
        .limit(limit)
        .lean()
    ]);

    return {
      weekKey,
      xpTop,
      messageTop
    };
  }

  async clearWeeklyRoles(guild) {
    await guild.members.fetch();

    const roleNames = [weeklyRoles.neuronOfTheWeek, weeklyRoles.communitySpark];
    for (const roleName of roleNames) {
      const role = guild.roles.cache.find((candidate) => candidate.name === roleName);
      if (!role) {
        continue;
      }

      const membersWithRole = guild.members.cache.filter((member) => member.roles.cache.has(role.id));
      for (const member of membersWithRole.values()) {
        await member.roles.remove(role, 'Weekly role rotation').catch(() => null);

        await roleLogService.logRoleChange(guild, {
          userId: member.id,
          roleName: role.name,
          action: 'removed',
          reason: 'Weekly role expired (7-day rotation)',
          source: 'weekly_rotation'
        });
      }
    }
  }

  async assignWeeklyRole(guild, userId, roleName, reason) {
    const role = guild.roles.cache.find((candidate) => candidate.name === roleName);
    if (!role) {
      logger.warn('Weekly role not found in guild', { guildId: guild.id, roleName });
      return;
    }

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) {
      logger.warn('Weekly role target member not found', { guildId: guild.id, userId, roleName });
      return;
    }

    if (!member.roles.cache.has(role.id)) {
      await member.roles.add(role, 'Weekly role winner').catch(() => null);

      await roleLogService.logRoleChange(guild, {
        userId: member.id,
        roleName,
        action: 'assigned',
        reason,
        source: 'weekly_rotation'
      });
    }
  }

  async processWeeklyRoleRotationForWeek(client, weekKey = this.getPreviousWeekKey()) {
    // Weekly rotation job: expire old rotating roles, then assign new winners.

    for (const guild of client.guilds.cache.values()) {
      try {
        await this.clearWeeklyRoles(guild);

        const [topXpEntry, topMessageEntry] = await Promise.all([
          WeeklyStats.findOne({ guildId: guild.id, weekKey })
            .sort({ xpGained: -1, messageCount: -1 })
            .lean(),
          WeeklyStats.findOne({ guildId: guild.id, weekKey })
            .sort({ messageCount: -1, xpGained: -1 })
            .lean()
        ]);

        if (topXpEntry && topXpEntry.xpGained > 0) {
          await this.assignWeeklyRole(
            guild,
            topXpEntry.userId,
            weeklyRoles.neuronOfTheWeek,
            `Top XP performer for ${weekKey}`
          );
        }

        if (topMessageEntry && topMessageEntry.messageCount > 0) {
          await this.assignWeeklyRole(
            guild,
            topMessageEntry.userId,
            weeklyRoles.communitySpark,
            `Most messages for ${weekKey}`
          );
        }
      } catch (error) {
        logger.error('Weekly role rotation failed for guild', {
          guildId: guild.id,
          error: error.message
        });
      }
    }

    logger.info('Weekly role rotation completed', { weekKey });
  }

  async processWeeklyRoleRotation(client) {
    return this.processWeeklyRoleRotationForWeek(client);
  }
}

module.exports = new WeeklyService();
