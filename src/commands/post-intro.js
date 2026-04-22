const { EmbedBuilder, SlashCommandBuilder, ChannelType, MessageFlags } = require('discord.js');
const { aiFieldRoles, levelRoles } = require('../config/roles');
const reactionRoleService = require('../services/reactionRoleService');
const permissionService = require('../services/permissionService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('post-intro')
    .setDescription('⚡ Admin: Post server introduction and AI field selector')
    .setDefaultMemberPermissions(0)
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('Channel to post introduction (leave blank for current)')
        .setRequired(false)
        .addChannelTypes(ChannelType.GuildText)
    ),

  async execute(interaction) {
    if (!(await permissionService.enforceAdmin(interaction))) {
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
    const guild = interaction.guild;

    // Get channel references by name
    const generalChannel = guild.channels.cache.find(c => c.name === 'general');
    const aiDiscussionChannel = guild.channels.cache.find(c => c.name === 'ai-discussion');
    const researchChannel = guild.channels.cache.find(c => c.name === 'research');
    const challengesChannel = guild.channels.cache.find(c => c.name === 'challenges');
    const offTopicChannel = guild.channels.cache.find(c => c.name === 'off-topic');
    const neuroMemberMention = '<@1478894166082715709>';

    const formatRoleMention = (roleName) => {
      const role = guild.roles.cache.find((cachedRole) => cachedRole.name === roleName);
      return role ? role.toString() : `**${roleName}**`;
    };

    const levelRolesText = levelRoles
      .map((role) => `Level ${role.minLevel}: ${formatRoleMention(role.name)}`)
      .join('\n');

    const fieldRolesText = aiFieldRoles
      .map((role) => formatRoleMention(role.name))
      .join('\n');

    // Create main intro embed
    const introEmbed = new EmbedBuilder()
      .setColor(0x6CD7E6)
      .setTitle('🧠 Welcome to SOAI Neuro World')
      .setDescription(`Hello ${formatRoleMention('NEURON')}!`)
      .addFields(
        {
          name: 'About SOAI Neuro Land',
          value: 'Welcome to **SOAI Neuro Land**, the official community of **School of AI Bejaia ESTIN** — a place where curious minds connect, learn, build, and explore Artificial Intelligence together.\n\nThis server is built to help you **learn AI**, **collaborate on projects**, **attend events**, and **meet other passionate students**.',
          inline: false
        },
        {
          name: `🧠 Who is Neuro`,
          value: `In this world, ${neuroMemberMention} is the brain of the community** — the spirit of innovation and intelligence that connects every member.\n\n**And you are a Neuron.** 🧬\n\nJust like neurons in a brain, each member contributes **knowledge, ideas, and energy** to make this network stronger.\n\n**Together we create a living AI ecosystem.**`,
          inline: false
        },
        {
          name: '🎯 Your Journey' ,
          value: '**Earn XP** by chatting and contributing → **Level Up** to unlock roles & features → **Complete Challenges** for extra rewards → **Pick Your AI Specialty** to show expertise!',
          inline: false
        },
        {
          name: '🎖 Level Roles',
          value: `${levelRolesText}\n\nUse \`/rank\` to track your XP progress.`,
          inline: false
        },
        {
          name: '🎓 AI Specialty Roles',
          value: `React with the emojis below to get your AI specialty role!\n\n${fieldRolesText}\n\nYou can pick multiple specialties to show your expertise!`,
          inline: false
        }
      )
      .setFooter({ text: '⬇️ React below to get your roles!' })
      .setTimestamp();

    try {
      const sentMessage = await targetChannel.send({
        embeds: [introEmbed],
        allowedMentions: { parse: [] }
      });

      // Add reactions for AI field selection
      for (const field of aiFieldRoles) {
        await sentMessage.react(field.emoji).catch(() => null);
      }

      await reactionRoleService.rememberIntroMessage(
        interaction.guildId,
        targetChannel.id,
        sentMessage.id
      );

      await interaction.editReply({
        content: `✅ Introduction posted to ${targetChannel}!\n📌 Message ID: \`${sentMessage.id}\`\n🎓 AI field reactions are active!`
      });
    } catch (error) {
      await interaction.editReply({
        content: `❌ Failed to post introduction: ${error.message}`
      });
    }
  }
};
