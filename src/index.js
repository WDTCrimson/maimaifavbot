import { AttachmentBuilder, Client, Events, GatewayIntentBits } from 'discord.js';
import { config, limits } from './config.js';
import { createInstallMessage, createPayloadMessage } from './bookmarklet.js';
import { LoadoutStore } from './store.js';

const store = new LoadoutStore(config.dataFile, limits);
await store.ensureReady();

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'loadout') {
    return;
  }

  try {
    await handleLoadoutCommand(interaction);
  } catch (error) {
    await replySafely(interaction, `Error: ${error.message}`);
  }
});

async function handleLoadoutCommand(interaction) {
  const subcommand = interaction.options.getSubcommand();
  const userId = interaction.user.id;

  switch (subcommand) {
    case 'create': {
      const name = interaction.options.getString('name', true);
      const loadout = await store.createLoadout(userId, name);
      await replySafely(interaction, `Created loadout **${loadout.name}**.`);
      return;
    }

    case 'delete': {
      const name = interaction.options.getString('name', true);
      const loadout = await store.deleteLoadout(userId, name);
      await replySafely(interaction, `Deleted loadout **${loadout.name}**.`);
      return;
    }

    case 'list': {
      const loadouts = store.listLoadouts(userId);
      if (!loadouts.length) {
        await replySafely(interaction, 'You have no loadouts yet. Use `/loadout create` first.');
        return;
      }

      const lines = loadouts.map((loadout) => `- ${loadout.name} (${loadout.songs.length}/30)`);
      await replySafely(interaction, `Your loadouts:\n${lines.join('\n')}`);
      return;
    }

    case 'show': {
      const name = interaction.options.getString('name', true);
      const loadout = store.getLoadout(userId, name);
      const songs = loadout.songs.length ? loadout.songs.join(', ') : '(empty)';
      await replySafely(
        interaction,
        `**${loadout.name}** (${loadout.songs.length}/30)\nSong IDs: ${songs}`
      );
      return;
    }

    case 'add': {
      const name = interaction.options.getString('name', true);
      const songId = interaction.options.getString('song_id', true);
      const loadout = await store.addSong(userId, name, songId);
      await replySafely(
        interaction,
        `Added song ID **${songId}** to **${loadout.name}** (${loadout.songs.length}/30).`
      );
      return;
    }

    case 'remove': {
      const name = interaction.options.getString('name', true);
      const songId = interaction.options.getString('song_id', true);
      const loadout = await store.removeSong(userId, name, songId);
      await replySafely(
        interaction,
        `Removed song ID **${songId}** from **${loadout.name}** (${loadout.songs.length}/30).`
      );
      return;
    }

    case 'payload': {
      const name = interaction.options.getString('name', true);
      const loadout = store.getLoadout(userId, name);
      const message = createPayloadMessage(loadout);
      await replySafely(interaction, message);
      return;
    }

    case 'bookmarklet': {
      const message = createInstallMessage();
      const attachment = new AttachmentBuilder(Buffer.from(`${message}\n`, 'utf8'), {
        name: 'maimai-bookmarklet.txt'
      });

      await interaction.reply({
        content: 'Install steps are in the attached `maimai-bookmarklet.txt` file.',
        files: [attachment],
        ephemeral: true
      });
      return;
    }

    default:
      await replySafely(interaction, `Unknown subcommand: ${subcommand}`);
  }
}

async function replySafely(interaction, content) {
  if (content.length > 1900) {
    const attachment = new AttachmentBuilder(Buffer.from(`${content}\n`, 'utf8'), {
      name: 'loadout-response.txt'
    });

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({
        content: 'Response was too long, so it was attached as `loadout-response.txt`.',
        files: [attachment],
        ephemeral: true
      });
      return;
    }

    await interaction.reply({
      content: 'Response was too long, so it was attached as `loadout-response.txt`.',
      files: [attachment],
      ephemeral: true
    });
    return;
  }

  if (interaction.deferred || interaction.replied) {
    await interaction.followUp({ content, ephemeral: true });
    return;
  }

  await interaction.reply({ content, ephemeral: true });
}

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

await client.login(config.token);
