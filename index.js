client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot) return;

    const content = message.content.trim().toLowerCase();

    // SERVER VERIFY CHANNEL
    if (message.guild && message.channel.id === VERIFY_CHANNEL_ID) {
      if (content !== VERIFY_WORD && content !== VERIFY_EMOJI) {
        await message.delete().catch(() => {});
        return;
      }

      const member = message.member;
      if (!member) return;

      if (verificationMode === 'manual') {
        await message.delete().catch(() => {});
        await message.channel.send(`${message.author}, verification is currently manual. Please wait for staff.`)
          .then(msg => setTimeout(() => msg.delete().catch(() => {}), 6000));
        return;
      }

      if (verificationMode === 'offline') {
        await message.delete().catch(() => {});
        await message.channel.send(`${message.author}, verification is currently offline. Please try again later.`)
          .then(msg => setTimeout(() => msg.delete().catch(() => {}), 6000));
        return;
      }

      await verifyMember(member);
      await message.delete().catch(() => {});

      await message.channel.send(`Ding! Welcome To Raphiel’s Lounge! 🥂 ${message.author}`)
        .then(msg => setTimeout(() => msg.delete().catch(() => {}), 6000));

      return;
    }

    // OWNER COMMANDS
    if (message.guild) {
      if (message.author.id !== OWNER_USER_ID) return;

      if (message.content === '!automated') {
        verificationMode = 'automated';
        await setStatus('🟢・Verification: Automated');
        await message.reply('Verification is now automated.');
        return;
      }

      if (message.content === '!manual') {
        verificationMode = 'manual';
        await setStatus('🟡・Verification: Manual');
        await message.reply('Verification is now manual.');
        return;
      }

      if (message.content === '!offline') {
        verificationMode = 'offline';
        await setStatus('🔴・Verification: Offline');
        await message.reply('Verification is now offline.');
        return;
      }

      return;
    }

    // DM VERIFY STILL WORKS TOO
    if (content !== VERIFY_WORD && content !== VERIFY_EMOJI) return;

    const guild = await client.guilds.fetch(GUILD_ID);
    const member = await guild.members.fetch(message.author.id).catch(() => null);

    if (!member) {
      await message.reply('I could not find you in the server.');
      return;
    }

    if (verificationMode === 'manual') {
      await message.reply('Verification is currently manual. Please wait for staff.');
      return;
    }

    if (verificationMode === 'offline') {
      await message.reply('Verification is currently offline. Please try again later.');
      return;
    }

    await verifyMember(member);
  } catch (err) {
    console.error('Message error:', err);
  }
});
