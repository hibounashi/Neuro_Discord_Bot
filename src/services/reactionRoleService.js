const { EmbedBuilder } = require('discord.js');
const { aiFieldRoles } = require('../config/roles');
const { config } = require('../config');
const ReactionRoleState = require('../models/ReactionRoleState');
const roleLogService = require('./roleLogService');
const logger = require('../utils/logger');

class ReactionRoleService {
  constructor() {
    this.runtimeTrackedMessageByGuild = new Map();
  }

  setTrackedMessageId(guildId, messageId) {
    this.runtimeTrackedMessageByGuild.set(guildId, messageId);
  }

  async rememberPanelMessage(guildId, channelId, messageId) {
    this.setTrackedMessageId(guildId, messageId);

    await ReactionRoleState.findOneAndUpdate(
      { guildId },
      {
        $set: {
          panelChannelId: channelId,
          panelMessageId: messageId
        },
        $setOnInsert: { guildId }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  async rememberIntroMessage(guildId, channelId, messageId) {
    await ReactionRoleState.findOneAndUpdate(
      { guildId },
      {
        $set: {
          introChannelId: channelId,
          introMessageId: messageId
        },
        $setOnInsert: { guildId }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  getTrackedMessageId(guildId) {
    return this.runtimeTrackedMessageByGuild.get(guildId) || config.reactionRoles.messageId || null;
  }

  isPanelReactionRoleMessage(message) {
    return message?.embeds?.some((embed) => embed.title?.includes('Choose Your AI Field Roles')) || false;
  }

  isIntroReactionRoleMessage(message) {
    return message?.embeds?.some((embed) =>
      embed.fields?.some((field) => field.name?.includes('AI Specialty Roles'))
    ) || false;
  }

  buildReactionRoleEmbed() {
    const lines = aiFieldRoles.map((item) => `${item.emoji} — **${item.name}**`);

    return new EmbedBuilder()
      .setColor(0x6CD7E6)
      .setTitle('🎯 Choose Your AI Field Roles')
      .setDescription(
        '**Select the AI fields you\'re interested in!**\n\n' +
        lines.join('\n') +
        '\n\n**How to use:**\n' +
        '✅ React with an emoji to **add** that role\n' +
        '❌ Remove your reaction to **remove** the role\n' +
        '💡 You can select **multiple fields**!'
      )
      .setFooter({ text: 'Choose all that interest you! Roles help us know your expertise.' })
      .setTimestamp();
  }

  async postReactionRolePanel(channel) {
    const embed = this.buildReactionRoleEmbed();
    const panelMessage = await channel.send({ embeds: [embed] });

    for (const item of aiFieldRoles) {
      await panelMessage.react(item.emoji);
    }

    await this.rememberPanelMessage(channel.guild.id, channel.id, panelMessage.id);

    return panelMessage;
  }

  getRoleByEmoji(emojiIdentifier) {
    // Handle both custom emoji names and unicode emoji characters
    return aiFieldRoles.find((item) => 
      item.emoji === emojiIdentifier || item.name.includes(emojiIdentifier)
    ) || null;
  }

  async ensureReactionFetched(reaction) {
    if (reaction.partial) {
      await reaction.fetch();
    }

    if (reaction.message.partial) {
      await reaction.message.fetch();
    }
  }

  async applyReactionRole(guild, user, roleMapping, addRole, reason, source) {
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      return;
    }

    const role = guild.roles.cache.find((candidate) => candidate.name === roleMapping.name);
    if (!role) {
      logger.warn('Reaction role target not found', {
        guildId: guild.id,
        roleName: roleMapping.name
      });
      return;
    }

    if (addRole && !member.roles.cache.has(role.id)) {
      await member.roles.add(role, reason).catch(() => null);

      await roleLogService.logRoleChange(guild, {
        userId: member.id,
        roleName: role.name,
        action: 'assigned',
        reason,
        source
      });
    }

    if (!addRole && member.roles.cache.has(role.id)) {
      await member.roles.remove(role, reason).catch(() => null);

      await roleLogService.logRoleChange(guild, {
        userId: member.id,
        roleName: role.name,
        action: 'removed',
        reason,
        source
      });
    }
  }

  async handleReaction(reaction, user, addRole) {
    if (user.bot) {
      return;
    }

    await this.ensureReactionFetched(reaction).catch(() => null);

    const guild = reaction.message.guild;
    if (!guild) {
      return;
    }

    const trackedMessageId = this.getTrackedMessageId(guild.id);
    if (!trackedMessageId || reaction.message.id !== trackedMessageId) {
      return;
    }

    // Handle both custom emoji names and unicode emoji characters
    const emojiIdentifier = reaction.emoji.name || reaction.emoji.toString();
    const roleMapping = this.getRoleByEmoji(emojiIdentifier);
    if (!roleMapping) {
      return;
    }

    await this.applyReactionRole(
      guild,
      user,
      roleMapping,
      addRole,
      addRole ? 'Selected via reaction role panel' : 'Removed via reaction role panel',
      'reaction_roles'
    );
  }

  async replayReactionRoleMessage(message) {
    if (!message?.guild) {
      return;
    }

    await message.fetch().catch(() => null);

    for (const roleMapping of aiFieldRoles) {
      const reaction = message.reactions.cache.find((candidate) => {
        const emojiIdentifier = candidate.emoji.name || candidate.emoji.toString();
        return candidate.emoji.toString() === roleMapping.emoji || emojiIdentifier === roleMapping.emoji;
      });

      if (!reaction) {
        continue;
      }

      const users = await reaction.users.fetch().catch(() => null);
      if (!users) {
        continue;
      }

      for (const user of users.values()) {
        if (user.bot) {
          continue;
        }

        await this.applyReactionRole(
          message.guild,
          user,
          roleMapping,
          true,
          'Recovered from offline reaction role state',
          'reaction_roles_recovery'
        );
      }
    }
  }

  async recoverMissedReactionRoles(client) {
    const states = await ReactionRoleState.find({}).lean();

    for (const guild of client.guilds.cache.values()) {
      const state = states.find((entry) => entry.guildId === guild.id);
      const targets = [];
      const seenTargetMessageIds = new Set();

      const pushTarget = (target) => {
        if (!target?.messageId || seenTargetMessageIds.has(target.messageId)) {
          return;
        }

        seenTargetMessageIds.add(target.messageId);
        targets.push(target);
      };

      if (state?.panelChannelId && state?.panelMessageId) {
        this.setTrackedMessageId(guild.id, state.panelMessageId);

        pushTarget({
          type: 'panel',
          channelId: state.panelChannelId,
          messageId: state.panelMessageId
        });
      }

      if (state?.introChannelId && state?.introMessageId) {
        pushTarget({
          type: 'intro',
          channelId: state.introChannelId,
          messageId: state.introMessageId
        });
      }

      if (!state?.panelMessageId && config.reactionRoles.messageId) {
        const configuredPanelTarget = await this.resolveConfiguredTarget(
          guild,
          'panel',
          config.reactionRoles.messageId
        );

        if (configuredPanelTarget) {
          this.setTrackedMessageId(guild.id, configuredPanelTarget.messageId);
          pushTarget(configuredPanelTarget);
        }
      }

      if (!state?.introMessageId && config.reactionRoles.fieldMessageId) {
        const configuredIntroTarget = await this.resolveConfiguredTarget(
          guild,
          'intro',
          config.reactionRoles.fieldMessageId
        );

        if (configuredIntroTarget) {
          pushTarget(configuredIntroTarget);
        }
      }

      if (targets.length === 0) {
        const discoveredTargets = await this.discoverReactionRoleTargets(guild);
        for (const discoveredTarget of discoveredTargets) {
          pushTarget(discoveredTarget);
        }

        if (discoveredTargets.length > 0) {
          const discoveredPanel = discoveredTargets.find((entry) => entry.type === 'panel');
          if (discoveredPanel) {
            this.setTrackedMessageId(guild.id, discoveredPanel.messageId);
          }

          await ReactionRoleState.findOneAndUpdate(
            { guildId: guild.id },
            {
              $set: {
                guildId: guild.id,
                panelChannelId: discoveredPanel?.channelId || null,
                panelMessageId: discoveredPanel?.messageId || null,
                introChannelId: discoveredTargets.find((entry) => entry.type === 'intro')?.channelId || null,
                introMessageId: discoveredTargets.find((entry) => entry.type === 'intro')?.messageId || null,
                lastRecoveredAt: new Date()
              }
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );
        }
      }

      if (targets.length === 0) {
        logger.warn('No reaction role targets found for recovery', {
          guildId: guild.id,
          configuredPanelMessageId: config.reactionRoles.messageId,
          configuredIntroMessageId: config.reactionRoles.fieldMessageId
        });
        continue;
      }

      for (const target of targets) {
        const channel = await guild.channels.fetch(target.channelId).catch(() => null);
        if (!channel || !channel.isTextBased()) {
          continue;
        }

        const message = await channel.messages.fetch(target.messageId).catch(() => null);
        if (!message) {
          continue;
        }

        if (!this.isPanelReactionRoleMessage(message) && !this.isIntroReactionRoleMessage(message)) {
          continue;
        }

        await this.replayReactionRoleMessage(message);
      }

      if (targets.length > 0) {
        await ReactionRoleState.updateOne(
          { guildId: guild.id },
          { $set: { lastRecoveredAt: new Date() } },
          { upsert: true }
        );
      }
    }
  }

  async resolveConfiguredTarget(guild, type, messageId) {
    if (!messageId) {
      return null;
    }

    const channels = await guild.channels.fetch().catch(() => null);
    if (!channels) {
      return null;
    }

    for (const channel of channels.values()) {
      if (!channel || !channel.isTextBased() || !channel.messages) {
        continue;
      }

      const message = await channel.messages.fetch(messageId).catch(() => null);
      if (!message) {
        continue;
      }

      return {
        type,
        channelId: channel.id,
        messageId: message.id
      };
    }

    logger.warn('Configured reaction role message not found', {
      guildId: guild.id,
      type,
      messageId
    });

    return null;
  }

  async discoverReactionRoleTargets(guild) {
    const discovered = [];
    const channels = await guild.channels.fetch().catch(() => null);

    if (!channels) {
      return discovered;
    }

    for (const channel of channels.values()) {
      if (!channel || !channel.isTextBased() || !channel.messages) {
        continue;
      }

      const messages = await channel.messages.fetch({ limit: 25 }).catch(() => null);
      if (!messages) {
        continue;
      }

      for (const message of messages.values()) {
        if (this.isPanelReactionRoleMessage(message) && !discovered.some((entry) => entry.type === 'panel')) {
          discovered.push({ type: 'panel', channelId: channel.id, messageId: message.id });
        }

        if (this.isIntroReactionRoleMessage(message) && !discovered.some((entry) => entry.type === 'intro')) {
          discovered.push({ type: 'intro', channelId: channel.id, messageId: message.id });
        }

        if (discovered.length === 2) {
          return discovered;
        }
      }
    }

    return discovered;
  }
}

module.exports = new ReactionRoleService();
