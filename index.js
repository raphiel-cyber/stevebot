require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  PermissionsBitField
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

// ==========================
// CONFIG
// ==========================
const GUILD_ID = process.env.GUILD_ID;
const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID;
const UNVERIFIED_ROLE_ID = process.env.UNVERIFIED_ROLE_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;
const DM_LOG_CHANNEL_ID = process.env.DM_LOG_CHANNEL_ID;
const VERIFY_NOTICE_CHANNEL_ID = process.env.VERIFY_NOTICE_CHANNEL_ID;

const VERIFY_EMOJI = '🛎️';
const OWNER_USER_ID = '1463645435397668992';

// Anti-spam settings
const SPAM_TIME_WINDOW_MS = 10000;
const MAX_MESSAGES_IN_WINDOW = 5;
const REPEATED_TEXT_LIMIT = 3;
const REPEATED_ATTACHMENT_LIMIT = 3;
const REPEATED_LINK_LIMIT = 3;
const NORMAL_TIMEOUT_MS = 5 * 60 * 1000;
const EVERYONE_TIMEOUT_MS = 30 * 60 * 1000;
const WARNING_RESET_MS = 30 * 60 * 1000;
const JOIN_ACCOUNT_MIN_AGE_MS = 24 * 60 * 60 * 1000;

// ==========================
// MEMORY
// ==========================
const pendingVerifications = new Set();
const userMessageMap = new Map();
const warningMap = new Map();

// ==========================
// READY
// ==========================
client.once(Events.ClientReady, () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// ==========================
// HELPERS
// ==========================
function isStaff(member) {
  if (!member) return false;

  return (
    member.permissions.has(PermissionsBitField.Flags.Administrator) ||
    member.permissions.has(PermissionsBitField.Flags.ManageGuild) ||
    member.permissions.has(PermissionsBitField.Flags.ManageMessages) ||
    member.permissions.has(PermissionsBitField.Flags.ModerateMembers)
  );
}

function normalizeContent(content) {
  return (content || '').trim().toLowerCase();
}

function getAttachmentSignature(message) {
  if (!message.attachments.size) return '';

  return [...message.attachments.values()]
    .map(att => `${att.name || 'file'}|${att.contentType || 'unknown'}|${att.url}`)
    .sort()
    .join(',');
}

function getLinksFromContent(content) {
  const matches = content.match(/https?:\/\/\S+/gi);
  return matches || [];
}

function cleanupOldEntries(userId, now) {
  const entries = userMessageMap.get(userId) || [];
  const filtered = entries.filter(entry => now - entry.time <= SPAM_TIME_WINDOW_MS);
  userMessageMap.set(userId, filtered);
  return filtered;
}

async function sendLog(guild, content) {
  try {
    if (!LOG_CHANNEL_ID) return;
    const channel = guild.channels.cache.get(LOG_CHANNEL_ID);
    if (!channel) return;
    await channel.send(content);
  } catch (error) {
    console.error('Log send error:', error);
  }
}

async function sendDmLog(guild, content) {
  try {
    if (!DM_LOG_CHANNEL_ID) return;
    const channel = guild.channels.cache.get(DM_LOG_CHANNEL_ID);
    if (!channel) return;
    await channel.send(content);
  } catch (error) {
    console.error('DM log send error:', error);
  }
}

async function sendVerifyNotice(guild, content) {
  try {
    if (!VERIFY_NOTICE_CHANNEL_ID) return;
    const channel = guild.channels.cache.get(VERIFY_NOTICE_CHANNEL_ID);
    if (!channel) return;
    await channel.send({
      content,
      allowedMentions: { roles: [UNVERIFIED_ROLE_ID] }
    });
  } catch (error) {
    console.error('Verify notice send error:', error);
  }
}

function getWarningData(userId) {
  const data = warningMap.get(userId);

  if (!data) {
    return { count: 0, lastWarning: 0 };
  }

  if (Date.now() - data.lastWarning > WARNING_RESET_MS) {
    warningMap.delete(userId);
    return { count: 0, lastWarning: 0 };
  }

  return data;
}

function addWarning(userId) {
  const current = getWarningData(userId);
  const updated = {
    count: current.count + 1,
    lastWarning: Date.now()
  };
  warningMap.set(userId, updated);
  return updated.count;
}

function resetWarnings(userId) {
  warningMap.delete(userId);
}

async function shortReply(channel, content, deleteAfterMs = 5000) {
  try {
    const msg = await channel.send(content);
    setTimeout(() => {
      msg.delete().catch(() => {});
    }, deleteAfterMs);
  } catch (error) {
    console.error('shortReply error:', error);
  }
}

function formatSpamType(spamType) {
  switch (spamType) {
    case 'text':
      return 'Text';
    case 'links':
      return 'Links';
    case 'attachments':
      return 'GIFs/Attachments';
    case 'everyone_here':
      return '@everyone/@here';
    case 'message_rate':
      return 'Message Spam';
    default:
      return 'Unknown';
  }
}

async function verifyMember(member, sourceLabel = 'unknown') {
  if (!member) return false;

  if (member.roles.cache.has(UNVERIFIED_ROLE_ID)) {
    await member.roles.remove(UNVERIFIED_ROLE_ID).catch(() => {});
  }

  if (!member.roles.cache.has(VERIFIED_ROLE_ID)) {
    await member.roles.add(VERIFIED_ROLE_ID).catch(() => {});
  }

  pendingVerifications.delete(member.id);

  await sendLog(
    member.guild,
    `✅ ${member} (${member.user.tag}) verified successfully through ${sourceLabel}`
  );

  return true;
}

async function handleNormalSpamPunishment(message, spamType, matchedContent = '') {
  const userId = message.author.id;
  const warningCount = addWarning(userId);

  await message.delete().catch(() => {});

  if (warningCount === 1) {
    await shortReply(
      message.channel,
      `${message.author} please don’t spam that much.`,
      5000
    );

    await sendLog(
      message.guild,
      `⚠️ ${message.author} warned (1/3) | Type: ${formatSpamType(spamType)}${matchedContent ? ` | Content: ${matchedContent}` : ''}`
    );
    return;
  }

  if (warningCount === 2) {
    await shortReply(
      message.channel,
      `Again, ${message.author} stop with the spam.`,
      5000
    );

    await sendLog(
      message.guild,
      `⚠️ ${message.author} warned (2/3) | Type: ${formatSpamType(spamType)}${matchedContent ? ` | Content: ${matchedContent}` : ''}`
    );
    return;
  }

  if (message.member && message.member.moderatable) {
    await message.member.timeout(
      NORMAL_TIMEOUT_MS,
      `Spam detected: ${formatSpamType(spamType)}`
    ).catch(() => {});

    await shortReply(
      message.channel,
      `${message.author} has been timed out for spamming.`,
      6000
    );

    await sendLog(
      message.guild,
      `⛔ ${message.author} timed out for 5 minutes | Type: ${formatSpamType(spamType)}${matchedContent ? ` | Content: ${matchedContent}` : ''}`
    );
  } else {
    await sendLog(
      message.guild,
      `⚠️ Could not timeout ${message.author} | Type: ${formatSpamType(spamType)}${matchedContent ? ` | Content: ${matchedContent}` : ''}`
    );
  }

  resetWarnings(userId);
}

async function handleEveryoneHereAbuse(message) {
  await message.delete().catch(() => {});

  if (message.member && message.member.moderatable) {
    await message.member.timeout(
      EVERYONE_TIMEOUT_MS,
      'Used @everyone or @here'
    ).catch(() => {});

    await shortReply(
      message.channel,
      `WOAH! ${message.author} don’t know what you trying to do but you better have a reason to do that.`,
      7000
    );

    await sendLog(
      message.guild,
      `🚨 ${message.author} instantly timed out for 30 minutes | Type: @everyone/@here | Content: ${message.content}`
    );
  } else {
    await sendLog(
      message.guild,
      `🚨 Could not timeout ${message.author} for @everyone/@here | Content: ${message.content}`
    );
  }
}

// ==========================
// JOIN -> DM VERIFY
// ==========================
client.on(Events.GuildMemberAdd, async (member) => {
  try {
    pendingVerifications.add(member.id);

    await member.send(
      `Welcome ${member}, before you enter, send ${VERIFY_EMOJI} to prove you’re actually human and not one of those weird bot accounts, then you will be verified! 👋`
    );

    await sendDmLog(
      member.guild,
      `📨 Sent verification DM to ${member} (${member.user.tag})`
    );
  } catch (error) {
    console.log(`Could not DM ${member.user.tag}. Their DMs may be closed.`);

    await sendDmLog(
      member.guild,
      `⚠️ Could not DM ${member} (${member.user.tag}). Their DMs may be turned off.`
    );

    await sendVerifyNotice(
      member.guild,
      `<@&${UNVERIFIED_ROLE_ID}> here, be sure to check your DMs to see the message I sent to get verified. If you don't see it, please DM the bot "Verify" to receive the verification. Thank you! :)`
    );
  }
});

// ==========================
// MAIN MESSAGE HANDLER
// ==========================
client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot) return;

    // ==========================
    // DM VERIFY
    // ==========================
    if (!message.guild) {
      const normalizedDm = normalizeContent(message.content);

      if (normalizedDm !== normalizeContent(VERIFY_EMOJI) && normalizedDm !== 'verify') {
        return;
      }

      const guild = await client.guilds.fetch(GUILD_ID);
      const member = await guild.members.fetch(message.author.id).catch(() => null);

      if (!member) {
        await message.reply('I could not find you in the server anymore.');
        pendingVerifications.delete(message.author.id);
        return;
      }

      const accountAge = Date.now() - message.author.createdTimestamp;
      if (accountAge < JOIN_ACCOUNT_MIN_AGE_MS) {
        await message.reply(
          'Your account is too new to verify right now. Please wait a bit and try again later.'
        );
        await sendLog(
          guild,
          `🚫 ${member || message.author.tag} failed verification because the account is too new`
        );
        return;
      }

      await verifyMember(member, 'DM');
      await message.reply('Ding! Welcome To Raphiel’s Lounge! 🥂');
      return;
    }

    // ==========================
    // OWNER COMMAND: SEND VERIFY INFO
    // ==========================
    if (message.content === '!sendverifyinfo') {
      if (message.author.id !== OWNER_USER_ID) return;

      await message.channel.send({
        content: `<@&${UNVERIFIED_ROLE_ID}> here, be sure to check your DMs to see the message I sent to get verified. If you don't see it, please DM the bot "Verify" to receive the verification. Thank you! :)`,
        allowedMentions: { roles: [UNVERIFIED_ROLE_ID] }
      });

      await message.delete().catch(() => {});
      return;
    }

    // ==========================
    // SERVER MESSAGE CHECKS
    // ==========================
    if (!message.member) return;
    if (isStaff(message.member)) return;

    const content = message.content || '';

    if (content.includes('@everyone') || content.includes('@here')) {
      await handleEveryoneHereAbuse(message);
      return;
    }

    const userId = message.author.id;
    const now = Date.now();

    const normalizedContent = normalizeContent(content);
    const attachmentSignature = getAttachmentSignature(message);
    const links = getLinksFromContent(content);
    const linkSignature = links.join('|').toLowerCase();

    const entries = cleanupOldEntries(userId, now);

    entries.push({
      content: normalizedContent,
      attachmentSignature,
      linkSignature,
      time: now
    });

    userMessageMap.set(userId, entries);

    const recentMessageCount = entries.length;

    const repeatedTextCount = normalizedContent
      ? entries.filter(entry => entry.content === normalizedContent).length
      : 0;

    const repeatedAttachmentCount = attachmentSignature
      ? entries.filter(entry => entry.attachmentSignature === attachmentSignature).length
      : 0;

    const repeatedLinkCount = linkSignature
      ? entries.filter(entry => entry.linkSignature === linkSignature).length
      : 0;

    if (repeatedLinkCount >= REPEATED_LINK_LIMIT) {
      await handleNormalSpamPunishment(message, 'links', content);
      return;
    }

    if (repeatedAttachmentCount >= REPEATED_ATTACHMENT_LIMIT) {
      await handleNormalSpamPunishment(message, 'attachments', attachmentSignature);
      return;
    }

    if (repeatedTextCount >= REPEATED_TEXT_LIMIT) {
      await handleNormalSpamPunishment(message, 'text', content);
      return;
    }

    if (recentMessageCount >= MAX_MESSAGES_IN_WINDOW) {
      await handleNormalSpamPunishment(message, 'message_rate', content);
      return;
    }
  } catch (error) {
    console.error('Message handler error:', error);
  }
});

client.login(process.env.TOKEN);
