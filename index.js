require('dotenv').config();

const http = require('http');

const {
  Client,
  GatewayIntentBits,
  Partials,
  Events
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

// =========================
// CONFIG
// =========================

const GUILD_ID = process.env.GUILD_ID;
const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID;
const UNVERIFIED_ROLE_ID = process.env.UNVERIFIED_ROLE_ID;
const DM_LOG_CHANNEL_ID = process.env.DM_LOG_CHANNEL_ID;
const STATUS_VOICE_CHANNEL_ID = process.env.STATUS_VOICE_CHANNEL_ID;

const OWNER_USER_ID = '1463645435397668992';

const VERIFY_EMOJI = '🛎️';
const VERIFY_WORD = 'verify';

const VERIFY_TIME = 24 * 60 * 60 * 1000;

let verificationMode = 'automated';

const kickTimers = new Map();

// =========================
// KEEP RENDER ONLINE
// =========================

http.createServer((req, res) => {
  res.writeHead(200);
  res.end('SteveBot running');
}).listen(process.env.PORT || 3000);

// =========================
// STATUS VC
// =========================

async function setStatus(name) {
  try {
    const channel = await client.channels.fetch(
      STATUS_VOICE_CHANNEL_ID
    );

    if (!channel) return;

    await channel.setName(name);
  } catch (err) {
    console.error(err);
  }
}

// =========================
// DM LOG
// =========================

async function sendLog(guild, message) {
  try {
    const channel = guild.channels.cache.get(
      DM_LOG_CHANNEL_ID
    );

    if (!channel) return;

    await channel.send(message);
  } catch (err) {
    console.error(err);
  }
}

// =========================
// VERIFY MEMBER
// =========================

async function verifyMember(member) {
  try {
    if (
      member.roles.cache.has(UNVERIFIED_ROLE_ID)
    ) {
      await member.roles.remove(
        UNVERIFIED_ROLE_ID
      );
    }

    if (
      !member.roles.cache.has(VERIFIED_ROLE_ID)
    ) {
      await member.roles.add(
        VERIFIED_ROLE_ID
      );
    }

    if (kickTimers.has(member.id)) {
      clearTimeout(kickTimers.get(member.id));
      kickTimers.delete(member.id);
    }

    await member.send(
      'Ding! Welcome To Raphiel’s Lounge! 🥂'
    );

    await sendLog(
      member.guild,
      `✅ ${member} has been verified.`
    );
  } catch (err) {
    console.error(err);
  }
}

// =========================
// KICK TIMER
// =========================

function startKickTimer(member) {
  const timer = setTimeout(async () => {
    try {
      const freshMember =
        await member.guild.members.fetch(
          member.id
        );

      if (
        freshMember.roles.cache.has(
          UNVERIFIED_ROLE_ID
        ) &&
        !freshMember.roles.cache.has(
          VERIFIED_ROLE_ID
        )
      ) {
        await freshMember.kick(
          'Did not verify in time.'
        );

        await sendLog(
          member.guild,
          `⏰ ${freshMember.user.tag} was kicked for not verifying within 24 hours.`
        );
      }
    } catch (err) {
      console.error(err);
    }
  }, VERIFY_TIME);

  kickTimers.set(member.id, timer);
}

// =========================
// READY
// =========================

client.once(Events.ClientReady, async () => {
  console.log(
    `Logged in as ${client.user.tag}`
  );

  await setStatus(
    '🟢・Verification: Automated'
  );
});

// =========================
// MEMBER JOIN
// =========================

client.on(
  Events.GuildMemberAdd,
  async (member) => {
    try {
      if (member.user.bot) return;

      await member.roles.add(
        UNVERIFIED_ROLE_ID
      );

      startKickTimer(member);

      try {
        await member.send(
          `Welcome ${member}, before you enter, send ${VERIFY_EMOJI} or "Verify" to prove you’re actually human and not one of those weird bot accounts. You have 24 hours to verify or you will be kicked. 👋`
        );
      } catch (err) {
        console.log('DMs disabled');
      }

      await sendLog(
        member.guild,
        `<@&1077007056613150763>, be sure to check your DMs to see the message sent by <@1463645435397668992> to get verified. If you don't see it, please DM the bot "Verify" to receive the verification. Also if you don’t verify in the next 24 hours you will be kicked from the server. Thank you! 🙂`
      );
    } catch (err) {
      console.error(err);
    }
  }
);

// =========================
// MESSAGE CREATE
// =========================

client.on(
  Events.MessageCreate,
  async (message) => {
    try {
      if (message.author.bot) return;

      // OWNER COMMANDS
      if (message.guild) {
        if (
          message.author.id !== OWNER_USER_ID
        )
          return;

        if (
          message.content === '!automated'
        ) {
          verificationMode = 'automated';

          await setStatus(
            '🟢・Verification: Automated'
          );

          await message.reply(
            'Verification is now automated.'
          );

          return;
        }

        if (
          message.content === '!manual'
        ) {
          verificationMode = 'manual';

          await setStatus(
            '🟡・Verification: Manual'
          );

          await message.reply(
            'Verification is now manual.'
          );

          return;
        }

        if (
          message.content === '!offline'
        ) {
          verificationMode = 'offline';

          await setStatus(
            '🔴・Verification: Offline'
          );

          await message.reply(
            'Verification is now offline.'
          );

          return;
        }

        return;
      }

      // DM VERIFY
      const content =
        message.content.toLowerCase();

      if (
        content !== VERIFY_WORD &&
        content !== VERIFY_EMOJI
      )
        return;

      const guild =
        await client.guilds.fetch(GUILD_ID);

      const member =
        await guild.members
          .fetch(message.author.id)
          .catch(() => null);

      if (!member) {
        await message.reply(
          'I could not find you in the server.'
        );

        return;
      }

      if (
        verificationMode === 'manual'
      ) {
        await message.reply(
          'Verification is currently manual. Please wait for staff.'
        );

        return;
      }

      if (
        verificationMode === 'offline'
      ) {
        await message.reply(
          'Verification is currently offline. Please try again later.'
        );

        return;
      }

      await verifyMember(member);
    } catch (err) {
      console.error(
        'Message error:',
        err
      );
    }
  }
);

client.login(process.env.TOKEN);
