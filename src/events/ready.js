const schedulerService = require('../services/schedulerService');
const reactionRoleService = require('../services/reactionRoleService');
const logger = require('../utils/logger');

module.exports = {
  name: 'clientReady',
  once: true,
  async execute(client) {
    logger.info('Bot is online', {
      tag: client.user.tag,
      id: client.user.id,
      guilds: client.guilds.cache.size
    });

    await schedulerService.start(client);

    try {
      await reactionRoleService.recoverMissedReactionRoles(client);
    } catch (error) {
      logger.error('Reaction role recovery failed', { error: error.message });
    }
  }
};
